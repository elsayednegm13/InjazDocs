/**
 * A PAGE'S OWN CALLS, JOINED TO THE ROUTES THEY REACH — with no app code.
 *
 * Until this module, the browser kit produced a traced action only when the
 * app routed a call through `traceFetch` by hand, so in practice no browser
 * install ever sent one and no web project could show a line from a page to
 * the route it called. The kit was already standing inside every `fetch` and
 * XHR the page made (`callWatch.ts`); it simply never said who was calling.
 *
 * What happens now, for each call the page makes:
 *
 *  - The DESTINATION decides whether anything is attached at all. A call to
 *    the page's own origin is joined by default: CORS does not apply to it, so
 *    the three trace headers cost no preflight and cannot get the call
 *    refused. A call to any other host is joined ONLY when the developer named
 *    that host in `tracePropagateTo` — a custom header on a cross-origin call
 *    forces a preflight, and a host that does not allow the headers makes the
 *    browser refuse the call, so that is the developer's decision, never a
 *    default. There is no wildcard and no "every host".
 *  - The kit's gates decide it next: nothing is attached, and nothing is
 *    recorded, unless the kit is live for this visit — sharing authorized (a
 *    span submitter is wired), not switched off, not inert, and this visit
 *    measured. A header that announced a step the page will never upload
 *    would leave the server's step pointing at a parent that never arrives.
 *  - A call that already carries `x-boosthis-trace` — `traceFetch`, or the
 *    app's own `traceHeaders()` — is left exactly as it is. One boundary, one
 *    step: the explicit call wins and this module stands down.
 *
 * The step this module records is labelled with the PAGE's route label (the
 * same normalized label the page map and every sample use), so on the map the
 * page is one box and each server route it called is a line out of it. It is
 * a fresh trace whose root is this call, so its offset is 0 by construction.
 * Nothing new is stored on the visitor's device: the step rides the span
 * buffer and upload the kit already has.
 */

import { isOwnEndpointReply } from "./edgeCache";
import { normalizeRouteLabel } from "./partName";
import { routerNamesScreens, screenLabelNow } from "./screenLabel";
import { isBoosthisDisabled } from "./runtimeFlags";
import { visitMeasured } from "./uploadPacing";
import { PARENT_HEADER, beginSpan } from "./spanScope";
import { ELAPSED_HEADER, TRACE_HEADER, sanitizeTraceId } from "./trace";
import { outcomeForStatus } from "./spanWork";
import { installPressWatch, tieCallToPress, uninstallPressWatch } from "./pressTrace";
import type { SpanRating, TraceSpan } from "./spanEmitter";

/**
 * WHAT THIS MODULE BORROWS FROM THE SPAN EMITTER AND THE KILL SWITCH ARRIVES
 * BOUND, NOT IMPORTED. Both of those modules sit in the browser kit's one
 * recorded module cycle (lib/kit-module-cycles.json), and callWatch.ts, also
 * in it, imports this module: a static import back into either would add
 * this module to that cycle. callWatch.ts binds them as it is evaluated,
 * which is before any wrapped call can reach beginPageCall(). Unbound,
 * nothing is joined: no headers and no step.
 */
export interface PageCallPorts {
  /** spanEmitter.spanSubmitterWired */
  readonly submitterWired: () => boolean;
  /** killSwitch.isRuntimeInert */
  readonly runtimeInert: () => boolean;
  /** spanEmitter.enqueueSpan */
  readonly enqueue: (span: TraceSpan) => void;
  /** spanEmitter.rateSpanDuration */
  readonly rate: (durationMs: number) => SpanRating;
  /** controlCensus.controlCensusEnabled — a press's control handle travels
   *  only while the census is on (pressTrace.ts). */
  readonly censusOn: () => boolean;
}

let ports: PageCallPorts | null = null;

/** Called once, by callWatch.ts, as it is evaluated. */
export function bindPageCallPorts(bound: PageCallPorts): void {
  ports = bound;
}

/** The span emitter's own enqueue, reached through the bound port. */
function enqueueSpan(span: TraceSpan): void {
  ports?.enqueue(span);
}

/** The most destinations `tracePropagateTo` keeps. Past it, entries are
 *  dropped and counted, never silently honoured. */
export const MAX_PROPAGATE_TO = 32;

/**
 * THE JOIN HAS A BUDGET: up to PAGE_CALL_BURST calls at once, then one more
 * every PAGE_CALL_REFILL_MS. A call that arrives while the budget is spent
 * goes out exactly as the page wrote it and records nothing.
 *
 * Why: the span buffer keeps 50 steps per 15-second send, shared with every
 * other step the page records. A page polling its own server hundreds of
 * times a second would otherwise pay for hundreds of joins a second (measured:
 * 17% of the page's throughput in its first half-minute) for steps the buffer
 * then throws away, and every thrown-away step would leave the server's step
 * pointing at a page step that never arrives. The budget is asked BEFORE any
 * address is parsed, so a call past it costs one clock read.
 */
export const PAGE_CALL_BURST = 20;
export const PAGE_CALL_REFILL_MS = 1_000;

let budget = PAGE_CALL_BURST;
let budgetClock: number | null = null;

function clockMs(): number {
  try {
    const p = (globalThis as { performance?: { now?: unknown } }).performance;
    if (p && typeof p.now === "function") return (p.now as () => number)();
  } catch {
    /* fall through to the wall clock */
  }
  return Date.now();
}

/** Top the budget up for the time that has passed; true while one is left. */
function budgetLeft(now: number): boolean {
  // First use, or a clock that went backwards: start counting from now.
  if (budgetClock === null || now < budgetClock) budgetClock = now;
  const earned = Math.floor((now - budgetClock) / PAGE_CALL_REFILL_MS);
  if (earned > 0) {
    budget = Math.min(PAGE_CALL_BURST, budget + earned);
    budgetClock =
      budget === PAGE_CALL_BURST ? now : budgetClock + earned * PAGE_CALL_REFILL_MS;
  }
  return budget > 0;
}

export interface PageCallTraceSettings {
  /** Join calls to the page's own origin (`traceSameOrigin`, default true). */
  readonly sameOrigin: boolean;
  /** Hosts named in `tracePropagateTo`, exact. */
  readonly hosts: readonly string[];
  /** `.example.com` entries: the host itself and every host under it. */
  readonly suffixes: readonly string[];
  /** Entries refused because they are not a host name (scheme, path, port,
   *  wildcard, numeric address, space). */
  readonly refused: readonly string[];
  /** Entries past MAX_PROPAGATE_TO. */
  readonly dropped: number;
}

const DEFAULT_SETTINGS: PageCallTraceSettings = Object.freeze({
  sameOrigin: true,
  hosts: Object.freeze([]) as readonly string[],
  suffixes: Object.freeze([]) as readonly string[],
  refused: Object.freeze([]) as readonly string[],
  dropped: 0,
});

let settings: PageCallTraceSettings = DEFAULT_SETTINGS;

/** Letters, digits, dots and hyphens — no scheme, slash, port, space,
 *  wildcard or credentials. */
function looksLikeHost(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(value)) return false;
  if (value.startsWith("-") || value.endsWith("-")) return false;
  if (value.startsWith(".") || value.endsWith(".")) return false;
  if (value.includes("..")) return false;
  // A number is not a name: naming a destination means naming it.
  if (value.split(".").every((p) => /^[0-9]+$/.test(p))) return false;
  return true;
}

/** Read `traceSameOrigin` + `tracePropagateTo` as `enableTelemetry` was given
 *  them. Anything that is not a list of host names joins nothing. */
export function configurePageCallTrace(opts: {
  sameOrigin?: unknown;
  propagateTo?: unknown;
}): PageCallTraceSettings {
  const sameOrigin = opts.sameOrigin !== false;
  const raw = Array.isArray(opts.propagateTo) ? opts.propagateTo : [];
  const hosts: string[] = [];
  const suffixes: string[] = [];
  const refused: string[] = [];
  let dropped = 0;
  for (const item of raw) {
    const entry = String(item ?? "").trim().toLowerCase();
    if (entry === "") continue;
    if (hosts.length + suffixes.length >= MAX_PROPAGATE_TO) {
      dropped += 1;
      continue;
    }
    const isSuffix = entry.startsWith(".");
    const host = isSuffix ? entry.slice(1) : entry;
    if (!looksLikeHost(host)) {
      if (refused.length < MAX_PROPAGATE_TO) refused.push(entry.slice(0, 80));
      continue;
    }
    const into = isSuffix ? suffixes : hosts;
    if (!into.includes(host)) into.push(host);
  }
  settings = Object.freeze({
    sameOrigin,
    hosts: Object.freeze(hosts),
    suffixes: Object.freeze(suffixes),
    refused: Object.freeze(refused),
    dropped,
  });
  return settings;
}

export function pageCallTraceSettings(): PageCallTraceSettings {
  return settings;
}

export function resetPageCallTrace(): void {
  settings = DEFAULT_SETTINGS;
  budget = PAGE_CALL_BURST;
  budgetClock = null;
}

/** The page's route label right now: the router's screen name when a
 *  handed-over router names screens, the page's own address otherwise. The
 *  one resolver every call — and every press (pressTrace.ts) — is named by. */
function pageRouteLabelNow(): string | null {
  const page = pageLocation();
  if (!page) return null;
  return (routerNamesScreens() ? screenLabelNow() : null) ?? normalizeRouteLabel(page.pathname);
}

/**
 * Watch the visitor's presses, so a call a press caused is drawn under it
 * (pressTrace.ts). Installed and removed with the call watch: without the
 * wrappers no call can be placed under a press, and a press with no call
 * sends nothing. Unbound ports: nothing is watched.
 */
export function installPagePresses(): void {
  const bound = ports;
  if (bound === null) return;
  installPressWatch(pageRouteLabelNow, {
    enqueue: (span) => bound.enqueue(span),
    rate: (ms) => bound.rate(ms),
    censusOn: () => bound.censusOn(),
  });
}

export function uninstallPagePresses(): void {
  uninstallPressWatch();
}

type Where = "same-origin" | "named-host" | null;

function pageLocation(): { origin: string; href: string; pathname: string } | null {
  try {
    const loc = (globalThis as { location?: Location }).location;
    if (!loc || typeof loc.origin !== "string" || typeof loc.href !== "string") {
      return null;
    }
    return { origin: loc.origin, href: loc.href, pathname: loc.pathname };
  } catch {
    return null;
  }
}

/** Which rule, if any, lets this destination carry the trace headers. */
export function pageCallDestination(target: unknown, pageHref?: string): Where {
  const page = pageLocation();
  const base = pageHref ?? page?.href;
  if (!base) return null;
  let url: URL;
  try {
    const raw =
      typeof target === "string"
        ? target
        : target instanceof URL
          ? target.href
          : typeof (target as { url?: unknown } | null)?.url === "string"
            ? (target as { url: string }).url
            : null;
    if (raw === null) return null;
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // OUR OWN ENDPOINT IS NEVER ONE OF THE APP'S CALLS. Some of the kit's own
  // sends go out through the page's fetch. On a page served from the same
  // origin as the endpoint (our own site, or an app that proxies the endpoint
  // through its own domain) they would otherwise be drawn as the app's
  // page → route lines, and carry our trace headers to ourselves. Matched on
  // the endpoint's path, so the app's other calls to that origin still join.
  if (isOwnEndpointReply(url.href)) return null;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return null;
  }
  if (url.origin === origin) return settings.sameOrigin ? "same-origin" : null;
  const host = url.hostname.toLowerCase();
  if (settings.hosts.includes(host)) return "named-host";
  if (settings.suffixes.some((s) => host === s || host.endsWith(`.${s}`))) {
    return "named-host";
  }
  return null;
}

/** Does a header source already carry the trace id? */
export function carriesTraceHeader(headers: unknown): boolean {
  if (headers === undefined || headers === null) return false;
  try {
    const h = headers as {
      has?: (k: string) => boolean;
    };
    if (typeof h.has === "function") return h.has(TRACE_HEADER) === true;
    if (Array.isArray(headers)) {
      return headers.some(
        (pair) =>
          Array.isArray(pair) && String(pair[0]).toLowerCase() === TRACE_HEADER,
      );
    }
    if (typeof headers === "object") {
      return Object.keys(headers as object).some(
        (k) => k.toLowerCase() === TRACE_HEADER,
      );
    }
  } catch {
    // unreadable headers: treat as carrying one, so nothing is added
    return true;
  }
  return false;
}

export interface PageCallTrace {
  /** The three headers to put on the call, in order. */
  readonly headers: ReadonlyArray<readonly [string, string]>;
  /** Record the step once the call has an answer (or never got one). Only the
   *  first settlement counts. `wait` marks a call the developer declared as
   *  waiting on purpose: it still appears, and is never rated as slow. */
  settle(status: number | null, threw: boolean, wait?: "declared"): void;
}

/**
 * Decide whether this call is joined to the page and, when it is, mint the
 * trace context. Null means: attach nothing, record nothing.
 */
export function beginPageCall(target: unknown): PageCallTrace | null {
  try {
    const bound = ports;
    if (
      bound === null ||
      !bound.submitterWired() ||
      isBoosthisDisabled() ||
      bound.runtimeInert()
    ) {
      return null;
    }
    // Asked before anything is parsed; spent only by a call that is joined.
    if (!budgetLeft(clockMs())) return null;
    if (pageCallDestination(target) === null) return null;
    // The page's screen label from the one resolver (screenLabel.ts) when a
    // handed-over router names screens; the page's own address otherwise.
    const routeLabel = pageRouteLabelNow();
    if (routeLabel === null) return null;
    if (!visitMeasured()) return null;
    // Caused by a press the visitor is making right now? Then the call joins
    // that press's action, at its distance from the press (pressTrace.ts),
    // and the press is paid for out of this same budget. Otherwise — or when
    // the budget cannot pay for the press too — the call is the root of a
    // trace of its own, exactly as before.
    const tie = tieCallToPress(budget, (n) => {
      budget -= n;
    });
    if (tie === null) budget -= 1;
    const traceId = tie !== null ? tie.traceId : sanitizeTraceId(undefined);
    const span = beginSpan();
    const offsetMs = tie !== null ? tie.offsetMs : 0;
    const startedAt = Date.now();
    let settled = false;
    return {
      headers: [
        [TRACE_HEADER, traceId],
        [PARENT_HEADER, span.spanId],
        // The call's distance from the start of its action: 0 when it is the
        // root of the trace it mints, its distance from the press otherwise.
        [ELAPSED_HEADER, String(offsetMs)],
      ],
      settle(status: number | null, threw: boolean, wait?: "declared"): void {
        if (settled) return;
        settled = true;
        try {
          const durationMs = Math.max(0, Date.now() - startedAt);
          enqueueSpan({
            traceId,
            layer: "web",
            routeLabel,
            durationMs,
            startOffsetMs: offsetMs,
            rating: bound.rate(durationMs),
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            kind: "http",
            outcome: outcomeForStatus(status, threw),
            ...(wait === "declared" ? { wait } : {}),
          });
        } catch {
          // never break the page
        } finally {
          tie?.settled(wait === "declared");
        }
      },
    };
  } catch {
    return null;
  }
}

/** The policy in words, for the kit's own status surfaces. */
export function pageCallTraceSummary(): string {
  const s = settings;
  const named = [...s.hosts, ...s.suffixes.map((x) => `.${x}`)];
  const own = s.sameOrigin
    ? "calls to this page's own origin"
    : "nothing on this page's own origin (traceSameOrigin: false)";
  const others =
    named.length === 0
      ? "no other host (none named in tracePropagateTo)"
      : `${named.slice(0, 4).join(", ")}${named.length > 4 ? ` and ${named.length - 4} more` : ""} (named in tracePropagateTo)`;
  const refused =
    s.refused.length > 0
      ? `; ignored, not a host name: ${s.refused.slice(0, 4).join(", ")}`
      : "";
  const budgetWords =
    s.sameOrigin || named.length > 0
      ? `; up to ${PAGE_CALL_BURST} calls at once, then one a second`
      : "";
  return `Trace passed on to: ${own}; ${others}${refused}${budgetWords}.`;
}
