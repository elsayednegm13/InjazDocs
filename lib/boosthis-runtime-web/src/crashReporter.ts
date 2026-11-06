/* ─── Boosthis: privacy-safe crash reporter (Web) ────────────────────
 *
 * Faithful port of `lib/boosthis-runtime-node/src/crashReporter.ts`, adapting
 * ONLY the install layer to the browser. Captures REAL uncaught crashes from
 * the host page and turns each one into a tiny, scrubbed fingerprint that is
 * safe to send off-device. This is NOT a perf checklist rule — it is a separate
 * always-on channel (for registered apps) that installs once from
 * `enableTelemetry` and reports on its own. Nothing here runs as an import
 * side-effect; `installCrashHandlers()` must be called explicitly.
 *
 * INSTALL LAYER — browser-specific, guest-code-safe:
 * We register PASSIVE listeners on `window`:
 *   - `"error"`            → kind `"uncaught"`  (reads `event.error`)
 *   - `"unhandledrejection"` → kind `"unhandledRejection"` (reads `event.reason`)
 * Both listeners NEVER call `preventDefault()`, so the browser's own default
 * behavior (logging the error/rejection to the console, dev-tools breakpoints)
 * is completely unchanged — a drop-in library must not alter host behavior.
 * Resource-load failures (a broken <img>/<script>) also fire `"error"` on
 * window but carry no `error` object and no message; those are IGNORED (they
 * are not exceptions). The module no-ops entirely outside a browser
 * (`typeof window === "undefined"`), e.g. SSR, tests, the Node-side MCP
 * entrypoint.
 *
 * PRIVACY: the DEFAULT payload carries only the error type, a hashed signature,
 * a redacted top frame, and a bucketed count — never source, values, or PII.
 * OPT-IN detailed mode (per app) additionally carries a PII-scrubbed first
 * message line (`summary`) and sanitized stack `frames` (function + file
 * BASENAME + line/col — absolute paths, URLs, query strings and arguments are
 * stripped in-process). `summary` and any frame that trips the PII guard are
 * dropped individually so the rest of the crash still reports. The field names
 * deliberately avoid the PII denylist (no `message`/`text`/`body`).
 *
 * Crash-safety: every entry point is wrapped in try/catch so a bug in the
 * reporter itself can never crash the host page. Persistence is synchronous
 * (`localStorage` via storage) so a crash that immediately unloads the page is
 * still reported on the next launch.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
import { currentAction } from "./spanScope";
import {
  currentFailurePart,
  type FailurePartUnknown,
} from "./failurePart";
import { checkNoPII } from "./no-pii";
import { crashCause, CRASH_INLINE_PAGE_FILE, type CrashCauseFields } from "./crashCause";
import { crashCodeOwner, firstCodeAddress, isInlinePage, rememberCrashStartPage } from "./crashCodeOwner";
import { storage } from "./storage";
import { configureCrashDelivery, keepCrash, keepCaught, takeBackCaught, flushCaught, offerCrashes, restartCrashRetries, touchCrashHistory, crashHistory, resetCrashDelivery, noteSetAside, type CrashBatch } from "./crashDelivery";
import {
  judgePageErrorOrigin,
  rawStackOf,
  isBrowserNotice,
  isHiddenDetailsError,
  HIDDEN_DETAILS_ERROR_NAME,
  HIDDEN_DETAILS_MESSAGE,
} from "./pageErrorOrigin";
import { outsideAngular } from "./zoneSafe";
import { inServerRender } from "./browserPage";
import { noteCaughtError, noteCrashedError, wasRecordedAsCrash } from "./swallowedErrors";
import { EARLY_ERRORS_GLOBAL } from "./hostedScript";

/** Persisted-pending crash buffer key. Mirrors the RN/Node store key. */
const STORAGE_KEY = "crash-pending:v2";
/** Bound the in-memory + persisted crash set so a pathological app that throws
 *  a unique error class on every tick can never grow memory/storage without
 *  limit. Distinct crash SIGNATURES (not crash frequency) are what counts. */
const MAX_CRASHES = 200;
/** Server caps a batch at 50 reports (CrashBatch.maxItems). */
const MAX_BATCH = 50;
/** Server caps a single signature's occurrences at 100000. */
const MAX_OCCURRENCES = 100000;
/** Server caps detailed frames at 20 (CrashReport.frames.maxItems). */
const MAX_FRAMES = 20;

/** `caughtByPage` is an error the app's OWN code caught (a framework error
 *  hook, an error boundary) and handed to `reportCaughtError`. It travels with
 *  the same privacy-safe shape as a crash and is never one: it never moves
 *  the crash count or the crash-free reading, and Boosthis lists it apart
 *  from crashes on every surface. Appended last, as on the shared list. */
export type CrashKind = "uncaught" | "unhandledRejection" | "render" | "caughtByPage";

/** One sanitized stack frame (opt-in detailed mode only). */
export interface CrashFrameData {
  func: string;
  file: string;
  line?: number;
  column?: number;
}

/** Privacy-safe crash fingerprint. Shape matches the OpenAPI `CrashReport`
 *  schema (camelCase on the wire). NEVER carries source code, user values, or
 *  PII. */
export interface CrashReportPayload extends CrashCauseFields {
  occurredAt: number;
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  countBucket: string;
  occurrences: number;
  /** OPT-IN ONLY. PII-scrubbed first message line. */
  summary?: string;
  /** OPT-IN ONLY. Sanitized stack frames. */
  frames?: CrashFrameData[];
  /** The ACTION this crash happened in: the 32-hex trace id, and the 16-hex
   *  id of the call that was open. Both are omitted when the kit held no
   *  action at that moment — an omitted key means "no action recorded", which
   *  is not the same as "happened outside any action", and the server never
   *  invents one. Neither is screen-bearing: both are random correlation tags
   *  and neither can carry a value from the page. */
  traceId?: string;
  spanId?: string;
  /** WHERE it happened — the screen the document was on, through the one
   *  part-name rule. Exactly one of these two is ever set: the part when the
   *  kit could name it, the term when it looked and could not. The two ids
   *  above answer a different question and never stand in for either. See
   *  `failurePart.ts`. */
  routeLabel?: string;
  partUnknown?: FailurePartUnknown;
}

/** Network submitter wired by the telemetry client (→ `transmitCrashes`).
 *  Registered on `enableTelemetry`, cleared on `forget()`. */
export type CrashSubmitter = (
  crashes: readonly CrashReportPayload[],
  batch?: CrashBatch,
  keepalive?: boolean,
) => Promise<number>;

interface CrashEntry extends CrashCauseFields {
  mergeKey: string;
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  summary?: string;
  frames?: CrashFrameData[];
  /** The action the LAST occurrence of this signature happened in, when one
   *  was open. Absent means no occurrence has been able to name one. */
  traceId?: string;
  spanId?: string;
  /** Where the LAST occurrence of this signature happened. One or the other,
   *  never both, and a later occurrence that could name a screen replaces a
   *  term an earlier one left. */
  routeLabel?: string;
  partUnknown?: FailurePartUnknown;
  /** Lifetime occurrences observed (across restored sessions); drives the
   *  bucketed count. */
  sessionTotal: number;
  /** Occurrences not yet acknowledged by the server (the delta the process
   *  sends; the server ADDS it to the row's lifetime total). */
  unsent: number;
  lastSeen: number;
}

let active = false;
let detailedMode = false;
let errorListener: ((event: Event) => void) | null = null;
let rejectionListener: ((event: Event) => void) | null = null;
let stopEntitlement: (() => void) | undefined;
/** Count of crashes captured this session (uncaught / unhandledRejection /
 *  render). Read by the crashFree meter axis; zeroed on forget()/reset. */
let crashTotal = 0;
let testCrashCount: number | undefined;

const pending = new Map<string, CrashEntry>();

/* ─── Errors the page caught: what the reporter holds ───────────────── */
/** Hand-overs that arrived before the reporter was installed — the kit had
 *  not started yet, or its gate had not opened — held in MEMORY only, with
 *  the moment, action and place read at the hand-over, and replayed once the
 *  reporter installs. Nothing about them is written to the visitor's device
 *  until then. */
interface CaughtBeforeStart {
  error: unknown;
  at: number;
  action: { traceId: string; spanId: string } | null;
  where: ReturnType<typeof currentFailurePart>;
}
const caughtBeforeStart: CaughtBeforeStart[] = [];
const MAX_CAUGHT_BEFORE_START = 20;
/** Caught errors redacted and kept this page run. Past the cap, a hand-over
 *  is still counted once as a near miss (swallowedErrors.ts) but no longer
 *  redacted or kept, so an app catching an error on every frame costs the
 *  page a bounded amount of work. */
let caughtThisPage = 0;
const MAX_CAUGHT_PER_PAGE = 500;
/** The early line keeps at most this many errors (hostedScript.ts); the kit
 *  reads no more than that from a queue the page itself could have replaced. */
const EARLY_ERRORS_READ_MAX = 50;
/** Every error object already handed over: one object is one report, however
 *  many hooks pass it on (a Next.js error page's effect runs twice in
 *  development). Identity only; holds nothing alive. */
let caughtSeen: WeakSet<object> = new WeakSet();
const isObjectLike = (v: unknown): v is object =>
  v !== null && (typeof v === "object" || typeof v === "function");

/** Register the crash auto-submitter. Pass `null` to clear (on opt-out). */
export function setCrashSubmitter(submitter: CrashSubmitter | null, installId?: () => string): void {
  configureCrashDelivery(submitter, installId);
}

/* ─── Redaction helpers ──────────────────────────────────────────── */

/** Cheap stable djb2 hash. Input is already redacted/non-reversible content;
 *  the output is used purely to GROUP identical crash classes — it carries no
 *  recoverable user data. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** Coarse, privacy-safe occurrence bucket. Always <= 12 chars (server cap). */
function bucketCount(n: number): string {
  if (n <= 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  if (n <= 100) return "21-100";
  return "100+";
}

/** Reduce a possibly-non-Error throw to an Error-like shape. */
function toError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (error && typeof error === "object") {
    const o = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof o.name === "string" ? o.name : "Error",
      message: typeof o.message === "string" ? o.message : String(error),
      stack: typeof o.stack === "string" ? o.stack : undefined,
    };
  }
  return {
    name: "Error",
    message: typeof error === "string" ? error : String(error),
  };
}

/** Keep only identifier characters so an error NAME can never carry an
 *  email/path/URL/value. Class names are code-defined; anything else is
 *  collapsed to "Error". */
function sanitizeErrorName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "").slice(0, 80);
  return cleaned.length > 0 ? cleaned : "Error";
}

/** Reduce a file path/URL to its bare basename, dropping directories, URL
 *  scheme/host, query strings, and fragments. */
function fileBasename(raw: string): string {
  let s = raw;
  const q = s.search(/[?#]/);
  if (q >= 0) s = s.slice(0, q);
  // Normalize both separators, take the last segment.
  const segs = s.split(/[\\/]/);
  s = segs[segs.length - 1] ?? "";
  s = s.trim().slice(0, 120);
  return s.length > 0 ? s : "<unknown>";
}

interface RawFrame {
  func: string;
  file: string;
  line?: number;
  column?: number;
}

/** Parse a JS error stack into frames, handling both the V8/Chromium
 *  ("at fn (file:line:col)" / "at file:line:col") and JSC/Safari/Firefox
 *  ("fn@file:line:col") formats. File paths are reduced to basenames here so
 *  no absolute path or URL ever survives parsing. */
function parseStack(stack: string | undefined): RawFrame[] {
  if (!stack || typeof stack !== "string") return [];
  const frames: RawFrame[] = [];
  const lines = stack.split("\n");
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    let func = "<anonymous>";
    let loc = "";
    const v8 = line.match(/^at\s+(.*?)\s+\((.*)\)$/);
    if (v8) {
      func = v8[1] ?? "<anonymous>";
      loc = v8[2] ?? "";
    } else {
      const v8NoFn = line.match(/^at\s+(.*)$/);
      const jsc = line.match(/^(.*?)@(.*)$/);
      if (v8NoFn) {
        loc = v8NoFn[1] ?? "";
      } else if (jsc) {
        func = jsc[1] && jsc[1].length > 0 ? jsc[1] : "<anonymous>";
        loc = jsc[2] ?? "";
      } else {
        continue;
      }
    }
    // loc is "<path>:<line>:<col>" — split trailing :line:col off the path.
    let file = loc;
    let lineNo: number | undefined;
    let colNo: number | undefined;
    const m = loc.match(/^(.*):(\d+):(\d+)$/) ?? loc.match(/^(.*):(\d+)$/);
    if (m) {
      file = m[1] ?? loc;
      lineNo = clampInt(m[2]!);
      colNo = m[3] !== undefined ? clampInt(m[3]) : undefined;
    }
    func = func
      .replace(/[^A-Za-z0-9_$.<>\s]/g, "")
      .trim()
      .slice(0, 120);
    if (func.length === 0) func = "<anonymous>";
    frames.push({ func, file: isInlinePage(file) ? CRASH_INLINE_PAGE_FILE : fileBasename(file), line: lineNo, column: colNo });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

function clampInt(s: string): number | undefined {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n, 100_000_000);
}

function formatRedactedFrame(top: RawFrame | undefined): string {
  if (!top) return "<unknown>";
  const lineSuffix = top.line !== undefined ? `:${top.line}` : "";
  return `${top.func} (${top.file}${lineSuffix})`.slice(0, 160);
}

/** First line of the error message, scrubbed: dropped entirely if it trips the
 *  PII guard (email/JWT/bearer/IP/phone). Returns undefined when there is
 *  nothing safe to keep. */
function sanitizeSummary(message: string): string | undefined {
  const first = message.split(/\r?\n/)[0]?.trim().slice(0, 300);
  if (!first) return undefined;
  if (checkNoPII(first) !== null) return undefined;
  return first;
}

interface RedactedCrash extends CrashCauseFields {
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  summary?: string;
  frames?: CrashFrameData[];
}

/** Turn a raw throw into the closed, PII-safe crash shape. Detailed fields are
 *  added only when `detailedMode` is on and they pass the PII guard. */
function redactError(error: unknown, kind: CrashKind, event?: { filename?: unknown; lineno?: unknown; colno?: unknown }): RedactedCrash {
  const err = toError(error);
  const errorName = sanitizeErrorName(err.name);
  const frames = parseStack(err.stack);
  if (!frames.length && typeof event?.filename === "string" && event.filename) {
    frames.push({ func: "<anonymous>", file: isInlinePage(event.filename) ? CRASH_INLINE_PAGE_FILE : fileBasename(event.filename),
      line: typeof event.lineno === "number" ? clampInt(String(event.lineno)) : undefined,
      column: typeof event.colno === "number" ? clampInt(String(event.colno)) : undefined });
  }
  const top = frames[0];
  const redactedFrame = formatRedactedFrame(top);
  // The signature is ALWAYS sent (even in default mode), so its basis must never
  // contain user values. A redacted top frame is code-defined (function + file
  // basename + line) and safe; when there is NO frame (stackless Error or a
  // non-Error throw) we fall back to ONLY code-defined tokens — the sanitized
  // error name, the crash kind, and a constant marker — and NEVER the raw error
  // message, which could carry an email/token/user value that would otherwise
  // leave the device as a deterministic hash.
  const basis = top ? (top.file === CRASH_INLINE_PAGE_FILE ? formatRedactedFrame({ ...top, line: undefined, column: undefined }) : redactedFrame) : `${errorName}|${kind}|<no-frame>`;
  // A caught error and a crash at the same line are two different rows: the
  // server keeps one row per signature, so the kind is part of the basis.
  const signature = `${errorName}:${hash(kind === "caughtByPage" ? `caughtByPage|${basis}` : basis)}`.slice(0, 120);
  const out: RedactedCrash = { signature, errorName, kind, redactedFrame,
    ...crashCause(err.name, err.message), ...crashCodeOwner(firstCodeAddress(err.stack, event?.filename)) };
  if (detailedMode) {
    const summary = sanitizeSummary(err.message);
    if (summary) out.summary = summary;
    // Drop any individual frame that trips the PII guard rather than the whole
    // crash; func/file are sanitized above, so this is belt-and-braces.
    const safeFrames = frames
      .slice(0, MAX_FRAMES)
      .filter((f) => checkNoPII(f) === null)
      .map((f) => {
        const fr: CrashFrameData = { func: f.func, file: f.file };
        if (f.line !== undefined) fr.line = f.line;
        if (f.column !== undefined) fr.column = f.column;
        return fr;
      });
    if (safeFrames.length > 0) out.frames = safeFrames;
  }
  return out;
}

/* ─── Capture + flush ────────────────────────────────────────────── */

/** Count one error SET ASIDE rather than recorded (see pageErrorOrigin.ts).
 *  Same gates as capture(): inert until installed, silent under the
 *  kill-switch. Only the count survives; the error itself is dropped here,
 *  before anything about it is redacted, kept or sent. */
function setAside(reason: "extension" | "notice"): void {
  try {
    if (!active || isBoosthisDisabled()) return;
    noteSetAside(reason);
  } catch {
    // never disturb the page
  }
}

/** Record one crash. Idempotent-safe and never throws (fully guarded). No-op
 *  until `installCrashHandlers()` has run, so the reporter has zero effect on
 *  apps that never enabled telemetry, and a no-op under the kill-switch. */
function capture(error: unknown, kind: CrashKind, event?: { filename?: unknown; lineno?: unknown; colno?: unknown }, occurredAt?: number): void {
  try {
    if (!active || isBoosthisDisabled() || kind === "render" || kind === "caughtByPage") return;
    // A crash is not a near miss: the console line an app's own error
    // handler logs for this same error is not counted again, and a near miss
    // it was already counted as is taken back (swallowedErrors.ts).
    noteCrashedError(error);
    // Nor is it ALSO an error the page caught: Angular 20 hands the window's
    // uncaught errors to its ErrorHandler, which can reach the kit first. A
    // caught report for this same object still waiting in memory is taken
    // back, so one error is one report — the crash.
    takeBackCaught(error);
    crashTotal += 1;
    const r = redactError(error, kind, event);
    // The moment it happened. An error kept by the page's early line (see
    // drainEarlyErrors) happened before the kit started, and says when.
    const now = occurredAt !== undefined && Number.isFinite(occurredAt) && occurredAt <= Date.now() ? Math.trunc(occurredAt) : Date.now();
    // WHICH ACTION THIS HAPPENED IN, when the kit actually holds one. Read
    // from the ambient span scope, which is synchronous by design, so it can
    // only ever name a call genuinely open on this stack — `window.onerror`
    // fires on the throwing stack, so a throw inside a scoped action is
    // placed. A rejection surfacing later has no scope open and this is null:
    // reported as "no action recorded", never guessed at from whatever fetch
    // happened to be in flight.
    const at = currentAction();
    // WHERE this crash happened, read NOW, on the same synchronous path as
    // the action above. `at` names an operation and never a place; this names
    // the place and never an operation. Both travel, neither substitutes.
    const where = currentFailurePart();
    const mergeKey = JSON.stringify([r.signature, where.routeLabel, where.partUnknown, r.mistake, r.codeName, r.codeNameState, r.codeOwner, r.codeService]);
    const existing = pending.get(mergeKey);
    if (existing) {
      existing.sessionTotal = Math.min(
        existing.sessionTotal + 1,
        MAX_OCCURRENCES,
      );
      existing.unsent = Math.min(existing.unsent + 1, MAX_OCCURRENCES);
      existing.kind = r.kind;
      existing.errorName = r.errorName;
      existing.redactedFrame = r.redactedFrame;
      existing.lastSeen = now;
      if (r.summary !== undefined) existing.summary = r.summary;
      if (r.frames !== undefined) existing.frames = r.frames;
      // A later occurrence that DOES know its action names it; one that does
      // not leaves the last known action alone rather than wiping it. Same
      // rule the server applies when it merges reports of one signature.
      if (at !== null) {
        existing.traceId = at.traceId;
        existing.spanId = at.spanId;
      }
      // WHERE, read at this occurrence's own moment of capture — never the
      // screen an earlier occurrence was on. A named screen replaces whatever
      // stood before it; a term replaces only another term, so one crash the
      // kit could place is not overwritten by a later one it could not.
      if (where.routeLabel !== undefined) {
        existing.routeLabel = where.routeLabel;
        existing.partUnknown = undefined;
      } else if (existing.routeLabel === undefined) {
        existing.partUnknown = where.partUnknown;
      }
    } else {
      pending.set(mergeKey, {
        ...r,
        mergeKey,
        signature: r.signature,
        errorName: r.errorName,
        kind: r.kind,
        redactedFrame: r.redactedFrame,
        summary: r.summary,
        frames: r.frames,
        sessionTotal: 1,
        unsent: 1,
        lastSeen: now,
        ...(at !== null ? { traceId: at.traceId, spanId: at.spanId } : {}),
        ...where,
      });
      evictIfNeeded();
    }
    // Persist SYNCHRONOUSLY so a crash that immediately unloads the page before
    // the network flush completes is still reported on the next launch.
    keepCrash({ ...r, occurrences: 1, countBucket: "1", occurredAt: now,
      ...(at !== null ? { traceId: at.traceId, spanId: at.spanId } : {}), ...where });
  } catch {
    // The reporter must NEVER throw — a bug here can't be allowed to crash the
    // host page.
  }
}

/**
 * Keep one error the app handed over as caught, as a report of its own kind
 * (`caughtByPage`). Same shape and the same privacy rules as a crash — error
 * type, signature, redacted top frame, the first frame of the app's own code,
 * the page, a count; the message only for a project that opted into detailed
 * reports — and NEVER a crash: the crash count, the crash history and the
 * crash-free reading are not touched.
 *
 * Skipped, in order: the kill-switch; before the reporter is installed (held
 * in memory and replayed at install); an error already recorded as a crash;
 * an object already handed over; past the page's cap. An error whose stack is
 * entirely a browser extension's is set aside on the device, as a crash is.
 */
function captureCaught(error: unknown, held?: CaughtBeforeStart): void {
  try {
    if (isBoosthisDisabled()) return;
    if (!active) {
      // Not a browser (a server render, the Node-side tools): nothing to hold.
      if (typeof window === "undefined" || caughtBeforeStart.length >= MAX_CAUGHT_BEFORE_START) return;
      caughtBeforeStart.push({ error, at: Date.now(), action: currentAction(), where: currentFailurePart() });
      return;
    }
    if (wasRecordedAsCrash(error)) return;
    if (isObjectLike(error)) {
      if (caughtSeen.has(error)) return;
      caughtSeen.add(error);
    }
    if (caughtThisPage >= MAX_CAUGHT_PER_PAGE) return;
    caughtThisPage += 1;
    // WHOSE ERROR: no file address travels with a hand-over, so the error's
    // own stack is the only evidence — the same rule a rejection gets.
    if (judgePageErrorOrigin(undefined, rawStackOf(error)) === "extension") {
      setAside("extension");
      return;
    }
    const r = redactError(error, "caughtByPage");
    const at = held ? held.action : currentAction();
    const where = held ? held.where : currentFailurePart();
    keepCaught(
      {
        ...r,
        occurrences: 1,
        countBucket: "1",
        occurredAt: held ? held.at : Date.now(),
        ...(at !== null ? { traceId: at.traceId, spanId: at.spanId } : {}),
        ...where,
      },
      isObjectLike(error) ? error : undefined,
    );
  } catch {
    // The reporter must NEVER throw into the host page.
  }
}

/**
 * The app's own code caught this error — a React error boundary, a Next.js
 * error page, Vue's `app.config.errorHandler`, SvelteKit's `handleError`, a
 * Svelte boundary, an Angular ErrorHandler — and hands it to the kit. One
 * call, from the framework's own error hook; the app's own handling, and what
 * the visitor sees, do not change.
 *
 * The error is sent, named, as a report of its own kind ("caught by the
 * page"), never as a crash. It is counted ONCE among the page's caught
 * errors, and the `console.error` the app's own handler logs for the same
 * error is not counted again (swallowedErrors.ts). Handed over before the kit
 * has started, it is held in memory and sent once the kit starts.
 *
 * Does nothing while a page renders on the server (browserPage.ts), runs
 * outside an Angular app's zone, and never throws.
 */
export function reportCaughtError(error: unknown): void {
  try {
    if (inServerRender() || isBoosthisDisabled()) return;
    outsideAngular(() => {
      noteCaughtError(error);
      captureCaught(error);
    });
  } catch {
    // a hand-off must never break the host page
  }
}

/**
 * The name the Angular guide has always wired (`kit.reportRenderError(error)`
 * in an ErrorHandler). Exactly `reportCaughtError`: an Angular app that
 * followed the guide sends the errors its ErrorHandler catches with no change
 * to its code.
 */
export function reportRenderError(error: unknown): void {
  reportCaughtError(error);
}

/** Keep the crash set bounded: evict the least-recently-seen entries that have
 *  nothing left to send. */
function evictIfNeeded(): void {
  if (pending.size <= MAX_CRASHES) return;
  const sortable = [...pending.values()].sort((a, b) => a.lastSeen - b.lastSeen);
  for (const e of sortable) {
    if (pending.size <= MAX_CRASHES) break;
    if (e.unsent <= 0) pending.delete(e.mergeKey);
  }
  // If everything still has unsent work, drop oldest regardless to honor the cap.
  while (pending.size > MAX_CRASHES) {
    const oldest = sortable.shift();
    if (!oldest) break;
    pending.delete(oldest.mergeKey);
  }
}

function scheduleFlush(): void {
  void flush().catch(() => {
    // flush() is self-guarded; this is belt-and-braces so a rejected promise
    // never becomes an unhandled rejection.
  });
}

function buildBatch(): CrashReportPayload[] {
  const batch: CrashReportPayload[] = [];
  for (const e of pending.values()) {
    if (e.unsent <= 0) continue;
    const item: CrashReportPayload = {
      occurredAt: e.lastSeen,
      signature: e.signature,
      errorName: e.errorName,
      kind: e.kind,
      redactedFrame: e.redactedFrame,
      countBucket: bucketCount(e.sessionTotal),
      occurrences: Math.min(e.unsent, MAX_OCCURRENCES),
    };
    if (e.summary !== undefined) item.summary = e.summary;
    if (e.frames !== undefined) item.frames = e.frames;
    for (const key of ["mistake", "codeName", "codeNameState", "codeOwner", "codeService"] as const) {
      if (e[key] !== undefined) Object.assign(item, { [key]: e[key] });
    }
    // Added only when present: a crash the kit could not place in an action
    // sends the keys it always did, and the server reads that as "no action
    // recorded" rather than as an action of its own.
    if (e.traceId !== undefined) item.traceId = e.traceId;
    if (e.spanId !== undefined) item.spanId = e.spanId;
    // WHERE, beside them and never instead of them. One of the two, never
    // both: a named screen and a term saying we could not name one are
    // answers to the same question and the name is the better one.
    if (e.routeLabel !== undefined) item.routeLabel = e.routeLabel;
    else if (e.partUnknown !== undefined) item.partUnknown = e.partUnknown;
    batch.push(item);
    if (batch.length >= MAX_BATCH) break;
  }
  return batch;
}

/** Flush pending crashes through the registered submitter. Always-on for
 *  registered apps (not gated by enable/disable) — only `BOOSTHIS_DISABLED`,
 *  `forget()`, or a missing submitter stop it. Never throws. */
async function flush(): Promise<void> {
  if (!isBoosthisDisabled()) await offerCrashes();
}

/* ─── Install / uninstall ────────────────────────────────────────── */
function exitCrashOffer(): void {
  try { flushCaught(false); touchCrashHistory(false, true); void offerCrashes(true); } catch { /* guest */ }
}
function hiddenCrashHistory(): void {
  try {
    if (document.visibilityState !== "hidden") return;
    // Caught errors still in memory are written down — and offered — while
    // the page can still write: a hidden page may never run again. Kept
    // first, so an offer the browser cuts short is offered again later under
    // the same delivery id.
    flushCaught();
    touchCrashHistory(false, true);
  } catch { /* guest */ }
}

/** The fields of a window `error` event the reporter reads. */
interface WindowErrorLike {
  error?: unknown;
  message?: unknown;
  filename?: unknown;
  lineno?: unknown;
  colno?: unknown;
}

/** Judge one window `error` event — a live one, or one the page's early line
 *  kept before the kit started (`occurredAt` is then when it happened). The
 *  same rules either way. Never throws. */
function judgeWindowError(e: WindowErrorLike, occurredAt?: number): void {
  try {
    // The browser's own ResizeObserver notice: no error object, exact
    // wording. Nothing broke, so it is counted apart and never a crash.
    if (isBrowserNotice(e.error, e.message)) {
      setAside("notice");
      return;
    }
    // WHOSE ERROR, decided HERE from the raw file address and raw stack —
    // before capture() cuts every address down to a file name, after which
    // `content.js` from an extension and from the app look the same.
    // Resource-load errors (broken <img>/<script>) also fire "error" but
    // carry no error object and no message — those are NOT exceptions.
    if (e.error !== undefined && e.error !== null) {
      if (judgePageErrorOrigin(e.filename, rawStackOf(e.error)) === "extension") {
        setAside("extension");
        return;
      }
      capture(e.error, "uncaught", e, occurredAt);
      return;
    }
    const msg = typeof e.message === "string" ? e.message : "";
    if (!msg) return;
    if (judgePageErrorOrigin(e.filename, undefined) === "extension") {
      setAside("extension");
      return;
    }
    // The browser hid a cross-origin script's error. Still counted — it
    // may be the app's own code on a CDN — but under a closed name the
    // server recognises, so the row can say why it is blank and what
    // makes it readable (see HIDDEN_DETAILS_ERROR_NAME).
    if (isHiddenDetailsError(e.error, msg)) {
      capture(
        { name: HIDDEN_DETAILS_ERROR_NAME, message: HIDDEN_DETAILS_MESSAGE },
        "uncaught",
        e,
        occurredAt,
      );
      return;
    }
    capture(msg, "uncaught", e, occurredAt);
  } catch {
    // swallow — never disturb the host's error handling
  }
}

/** Judge one unhandled rejection's reason, live or kept by the early line. */
function judgeRejection(reason: unknown, occurredAt?: number): void {
  try {
    // A rejection names no file; the reason's own stack is the only
    // evidence. No stack (a string, undefined) stays counted.
    if (judgePageErrorOrigin(undefined, rawStackOf(reason)) === "extension") {
      setAside("extension");
      return;
    }
    capture(reason, "unhandledRejection", undefined, occurredAt);
  } catch {
    // swallow
  }
}

/**
 * Hand over what the page's OPTIONAL early line kept (hostedScript.ts,
 * EARLY_ERRORS_SCRIPT_BODY): errors and rejections the window saw before the
 * kit's own listeners existed. Called once, synchronously, right after those
 * listeners are added, so no error is judged twice or missed. Each is judged
 * exactly as a live one, at the moment it was kept. The early listeners are
 * then removed and the queue let go: it lived in memory only, and nothing of
 * it was ever written to the visitor's device.
 *
 * A page without the line — or whose security policy blocked it — has no
 * queue, and nothing changes. Never throws.
 */
function drainEarlyErrors(): void {
  try {
    const w = window as unknown as Record<string, unknown>;
    const early = w[EARLY_ERRORS_GLOBAL] as { q?: unknown; stop?: unknown } | null | undefined;
    if (!early || typeof early !== "object") return;
    try {
      if (typeof early.stop === "function") (early.stop as () => void)();
    } catch {
      /* the page's own line; never let it break the kit's start */
    }
    try {
      delete w[EARLY_ERRORS_GLOBAL];
    } catch {
      w[EARLY_ERRORS_GLOBAL] = undefined;
    }
    const queue = Array.isArray(early.q) ? early.q.slice(0, EARLY_ERRORS_READ_MAX) : [];
    if (Array.isArray(early.q)) early.q.length = 0;
    for (const item of queue) {
      if (!Array.isArray(item)) continue;
      const [k, t, value, message, filename, lineno, colno] = item as unknown[];
      const at = typeof t === "number" ? t : undefined;
      if (k === "r") judgeRejection(value, at);
      else if (k === "e") judgeWindowError({ error: value, message, filename, lineno, colno }, at);
    }
  } catch {
    // a queue we cannot read is a page without the line
  }
}

/**
 * Install the global crash handler. Called once from `enableTelemetry`.
 * Idempotent: calling again only updates `detailed` and never re-registers the
 * window listeners (which would otherwise double-report). No-op outside a
 * browser (SSR / tests / the Node-side MCP entrypoint).
 *
 * Guest-code invariant: the listeners are PASSIVE and never `preventDefault()`,
 * so the browser's default error/rejection handling (console logging, dev-tools
 * pause) is completely unchanged.
 */
export function installCrashHandlers(opts: {
  detailed: boolean;
  /** The kit's entitlement feed, handed in by the caller so this module stays
   *  out of the gate's import graph: when the gate re-opens, kept crashes are
   *  offered again. Omitted, crashes are still offered at start-up and when a
   *  credential arrives. */
  subscribeEntitlement?: (listener: () => void) => () => void;
}): void {
  try {
    detailedMode = opts.detailed === true;
    if (active) return;
    if (
      typeof window === "undefined" ||
      typeof window.addEventListener !== "function"
    ) {
      // Not a browser — nothing to hook. Leave `active` false so capture()
      // stays inert.
      return;
    }
    active = true;
    rememberCrashStartPage();
    stopEntitlement = opts.subscribeEntitlement?.(() => { void offerCrashes(); });

    errorListener = (event: Event) => {
      // Never throws; a bug here must not break the page's error flow.
      judgeWindowError(event as WindowErrorLike);
    };

    rejectionListener = (event: Event) => {
      judgeRejection((event as { reason?: unknown }).reason);
    };

    // Passive listeners only — never preventDefault(), so host behavior is
    // unchanged.
    const onError = errorListener;
    const onRejection = rejectionListener;
    outsideAngular(() => window.addEventListener("error", onError));
    outsideAngular(() => window.addEventListener("unhandledrejection", onRejection));
    outsideAngular(() => window.addEventListener("pagehide", exitCrashOffer));
    outsideAngular(() => window.addEventListener("visibilitychange", hiddenCrashHistory));

    // What happened before the listeners above existed: errors the page's
    // optional early line kept, then errors the app handed over as caught
    // before the kit started. Synchronously, so none is seen twice or missed.
    drainEarlyErrors();
    for (const held of caughtBeforeStart.splice(0)) captureCaught(held.error, held);

    // Restore any crashes persisted from a previous session and flush them now
    // that a submitter is registered.
    try {
      touchCrashHistory(false, true);
      restartCrashRetries();
      scheduleFlush();
    } catch {
      // Best-effort restore — a corrupt store just starts clean.
    }
  } catch {
    // installation must never throw into the host's enableTelemetry call.
  }
}

/**
 * Tear down the handlers and clear all pending crash state, including the
 * persisted store. Called by `telemetry.forget()` so nothing Boosthis-shaped is
 * left in the page or in storage. Removes ONLY the listeners we added.
 */
export async function uninstallCrashHandlers(): Promise<void> {
  stopEntitlement?.();
  stopEntitlement = undefined;
  resetCrashDelivery(true);
  active = false;
  detailedMode = false;
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      if (errorListener) window.removeEventListener("error", errorListener);
      if (rejectionListener) {
        window.removeEventListener("unhandledrejection", rejectionListener);
      }
      window.removeEventListener("pagehide", exitCrashOffer);
      window.removeEventListener("visibilitychange", hiddenCrashHistory);
    }
  } catch {
    // Best-effort.
  }
  errorListener = null;
  rejectionListener = null;
  pending.clear();
  crashTotal = 0;
  resetCaughtState();
  try {
    storage.remove(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

/** Forget every caught error held in memory and the page's caught tallies. */
function resetCaughtState(): void {
  caughtBeforeStart.length = 0;
  caughtThisPage = 0;
  caughtSeen = new WeakSet();
}

/* ─── Test/debug helpers ─────────────────────────────────────────── */

/** Errors set aside in the crash window: extension-only errors and browser
 *  notices. Counts only. The crash-free reading carries both beside `crashes`. */
export function setAsideCounts(): { extension: number; notice: number } {
  const h = crashHistory();
  return { extension: h.setAsideExtension, notice: h.setAsideNotice };
}

/** Crashes captured since telemetry started (crashFree axis input). */
export function crashCount(): number {
  return testCrashCount ?? crashHistory().crashes;
}

export const _crashInternals = {
  STORAGE_KEY,
  MAX_CRASHES,
  MAX_BATCH,
  redactError,
  parseStack,
  fileBasename,
  sanitizeErrorName,
  sanitizeSummary,
  bucketCount,
  capture,
  captureCaught,
  drainEarlyErrors,
  MAX_CAUGHT_PER_PAGE,
  MAX_CAUGHT_BEFORE_START,
  EARLY_ERRORS_READ_MAX,
  caughtBeforeStartSize: () => caughtBeforeStart.length,
  flush,
  buildBatch,
  isActive: () => active,
  isDetailed: () => detailedMode,
  pendingSize: () => pending.size,
  getPending: () => [...pending.values()].map((e) => ({ ...e })),
  getErrorListener: () => errorListener,
  getRejectionListener: () => rejectionListener,
  reset: () => {
    stopEntitlement?.();
    stopEntitlement = undefined;
    resetCrashDelivery(true);
    testCrashCount = undefined;
    pending.clear();
    active = false;
    detailedMode = false;
    errorListener = null;
    rejectionListener = null;
    crashTotal = 0;
    resetCaughtState();
  },
  setDetailedForTests: (d: boolean) => {
    detailedMode = d;
  },
  setActiveForTests: (a: boolean) => {
    active = a;
  },
  setCrashCountForTests: (n: number) => {
    testCrashCount = n;
  },
};
