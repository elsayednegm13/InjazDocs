/**
 * Who may see the bubble on a live site: a browser switched on through an
 * OWNER LINK (owner decision, 4–5 Oct 2026 — "no one sees the bubble or its
 * readings except the project's owners").
 *
 * The owner presses "Show the bubble on my site" on their project's page on
 * Boosthis and opens the link it gives them: the site's address plus
 * `?boosthis=<proof>`. On that page load this module
 *
 *   1. takes the proof out of the address bar at once (whatever happens next,
 *      nothing Boosthis-related stays there to be copied),
 *   2. swaps it with Boosthis for an owner pass (one use, one project, minutes
 *      to live — a copied link is already spent), and keeps the pass in this
 *      browser for about 30 days,
 *   3. and on every later page load asks Boosthis whether the pass still holds
 *      before the bubble is drawn.
 *
 * Nothing typed by hand switches a browser on: `?boosthis=on`, `#boosthis=on`
 * and a value set in the browser's storage are not proofs, and a stored pass
 * draws nothing until Boosthis has confirmed it on this page. If Boosthis
 * cannot be reached, nothing is switched on and the page carries on as normal.
 * `?boosthis=off` and the switch-off control in the bubble forget the pass.
 *
 * A visitor's page load never talks to Boosthis here: with no proof in the
 * address and no pass in the browser there is nothing to ask about.
 *
 * Guest code inside a host page: nothing here throws into the host.
 */

import { storage, deviceStorageSealed as isDissolvedThisRun, onDeviceErase } from "./storage";
import { readAnswerJson } from "./answerRead";
import { checkNoPII, checkNoPIIInUrl } from "./no-pii";
// A type import is erased before anything runs, so it is no edge in the kit's
// module graph — see linkOwnerPassSources below for why that matters here.
import type { TelemetryClient } from "./telemetry";
import { kitTimeout, outsideAngular } from "./zoneSafe";

/** The address key an owner link uses. */
export const OWNER_LINK_PARAM = "boosthis";

/** What Boosthis mints (lib/ownerBubbleLink on the server). Anything else in
 *  the address — `on`, a guess, a look-alike — is not a proof. */
const PROOF_SHAPE = /^op_[0-9a-f]{64}$/;
const PASS_SHAPE = /^bp1\.[0-9a-z]{1,11}\.[0-9a-f]{32}\.[0-9a-f]{64}$/;

/** The one entry this module keeps in the browser: the pass and its expiry. */
export const OWNER_PASS_STORAGE_KEY = "bubble-owner-pass:v1";
/** The flag older kits kept for `?boosthis=on`. It switches nothing on any
 *  more, so it is removed rather than left behind. */
const LEGACY_DEVICE_KEY = "bubble-owner-device:v1";

/** A page load moments after registration may not hold its credential yet. */
const CREDENTIAL_WAIT_MS = 60_000;
const CREDENTIAL_POLL_MS = 500;
const CALL_TIMEOUT_MS = 8_000;
/** An owner-pass answer is a few hundred bytes; the same 64 KB ceiling every
 *  other kit reads it under. */
const OWNER_ANSWER_MAX_BYTES = 65_536;
/** A page left open keeps asking, so "drawn only while confirmed" stays true. */
export const OWNER_PASS_RECONFIRM_MS = 60 * 60 * 1000;

/** True loopback only: `localhost` and loopback IP addresses. A preview host,
 *  a `.local` name or a name that merely starts with "127." is a site other
 *  people can open, so it is not one of these. */
export function isLoopbackHost(hostname?: string): boolean {
  try {
    const raw =
      hostname ??
      (typeof location !== "undefined" ? location.hostname : "");
    const h = String(raw).trim().toLowerCase().replace(/\.$/, "");
    if (!h) return false;
    if (h === "localhost") return true;
    if (h === "::1" || h === "[::1]") return true;
    const v4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    return !!v4 && v4.slice(1).every((o) => Number(o) <= 255);
  } catch {
    return false;
  }
}

type OwnerParam = { kind: "proof"; proof: string } | { kind: "off" } | { kind: "other" };

function readOwnerParam(): OwnerParam | null {
  try {
    const search = (globalThis as { location?: { search?: unknown } }).location?.search;
    if (typeof search !== "string" || !search) return null;
    const raw = new URLSearchParams(search.replace(/^\?/, "")).get(OWNER_LINK_PARAM);
    if (raw === null) return null;
    const value = raw.trim();
    if (value.toLowerCase() === "off") return { kind: "off" };
    if (PROOF_SHAPE.test(value)) return { kind: "proof", proof: value };
    return { kind: "other" };
  } catch {
    return null;
  }
}

/** Take the owner key out of the address bar, keeping the rest of the address
 *  and the page's own history state exactly as they were. */
function stripOwnerParamFromAddress(): void {
  try {
    const g = globalThis as {
      location?: { pathname?: unknown; search?: unknown; hash?: unknown };
      history?: { state?: unknown; replaceState?: unknown };
    };
    const loc = g.location;
    const hist = g.history;
    if (!loc || !hist || typeof hist.replaceState !== "function") return;
    const search = typeof loc.search === "string" ? loc.search : "";
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    if (!params.has(OWNER_LINK_PARAM)) return;
    params.delete(OWNER_LINK_PARAM);
    const rest = params.toString();
    const path = typeof loc.pathname === "string" ? loc.pathname : "";
    const hash = typeof loc.hash === "string" ? loc.hash : "";
    (hist.replaceState as (s: unknown, t: string, u: string) => void).call(
      hist,
      hist.state,
      "",
      `${path}${rest ? `?${rest}` : ""}${hash}`,
    );
  } catch {
    // Leaving the address as it was is the only other outcome.
  }
}

type StoredPass = { pass: string; expiresAt: number };

function readStoredPass(): StoredPass | null {
  try {
    const raw = storage.get(OWNER_PASS_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { p?: unknown; e?: unknown };
    if (typeof v.p !== "string" || !PASS_SHAPE.test(v.p)) return null;
    if (typeof v.e !== "number" || !Number.isFinite(v.e)) return null;
    return { pass: v.p, expiresAt: v.e };
  } catch {
    return null;
  }
}

function saveStoredPass(pass: string, expiresAt: number): void {
  try {
    storage.set(OWNER_PASS_STORAGE_KEY, JSON.stringify({ p: pass, e: expiresAt }));
  } catch {
    // This page still draws; the next one will need a new link.
  }
}

type CallContext = { endpoint: string; installId: string; token: string };

/**
 * Where the pass's two questions find the registered install and the fetch
 * they are sent with. The bubble, this module's only importer, links both when
 * it loads, so this module imports nothing from the browser kit's big module
 * cycle: that tangle is recorded with its exact membership and may only shrink
 * (lib/kit-module-cycles.json). Unlinked, there is no install to ask about, so
 * nothing is switched on: the same answer as an install that has not
 * registered yet.
 */
type OwnerPassSources = {
  client: () => TelemetryClient | null;
  fetch: () => typeof fetch | null;
};
let sources: OwnerPassSources | null = null;

/** @internal Called once, by bubble.ts, when it loads. */
export function linkOwnerPassSources(next: OwnerPassSources): void {
  sources = next;
}

function activeContext(): CallContext | null {
  if (contextForTests) return contextForTests();
  const client = sources ? sources.client() : null;
  if (!client) return null;
  const token = client.deleteToken ?? client.readToken;
  if (!token || !client.installId || !client.endpoint) return null;
  return { endpoint: client.endpoint, installId: client.installId, token };
}

async function waitForContext(): Promise<CallContext | null> {
  const deadline = Date.now() + CREDENTIAL_WAIT_MS;
  for (;;) {
    if (isDissolvedThisRun()) return null;
    const ctx = activeContext();
    if (ctx) return ctx;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => kitTimeout(r, CREDENTIAL_POLL_MS));
  }
}

/** `blocked`: the kit's own privacy check stopped the question on this device,
 *  so nothing was sent. It is not Boosthis's answer, and never "unreachable". */
type Answer =
  | { kind: "yes"; body: Record<string, unknown> }
  | { kind: "refused" }
  | { kind: "unanswered" }
  | { kind: "blocked" };

async function ask(
  ctx: CallContext,
  path: "/owner-bubble/redeem" | "/owner-bubble/confirm",
  body: Record<string, string>,
): Promise<Answer> {
  if (isDissolvedThisRun()) return { kind: "unanswered" };
  const f =
    fetchForTests ??
    // Our own question is not one of the app's backend calls.
    (sources ? sources.fetch() : null) ??
    (typeof fetch === "function" ? (fetch as typeof fetch) : null);
  if (!f) return { kind: "unanswered" };
  const url = `${ctx.endpoint.replace(/\/$/, "")}${path}`;
  // The kit's own privacy check, on the body and on the address, before
  // anything is sent. The body is the install id and Boosthis's own proof or
  // pass; the credential rides the Authorization header.
  if (checkNoPII(body) || checkNoPIIInUrl(url)) return { kind: "blocked" };
  const timeout = new Promise<null>((resolve) => {
    kitTimeout(() => resolve(null), CALL_TIMEOUT_MS);
  });
  // Sent outside an Angular app's zone (zoneSafe.ts): the kit's own request.
  const call = Promise.resolve()
    .then(() =>
      outsideAngular(() =>
        f(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.token}`,
          },
          body: JSON.stringify(body),
        }),
      ),
    )
    .catch(() => null);
  const res = await Promise.race([call, timeout]);
  if (!res) return { kind: "unanswered" };
  // Only Boosthis's own "no" withdraws anything. A busy server, a credential
  // problem or a proxy error is not an answer about the pass.
  if (res.status === 403) return { kind: "refused" };
  if (!res.ok) return { kind: "unanswered" };
  try {
    // Bounded while reading: too large, too slow or not JSON is unanswered.
    const parsed = await readAnswerJson(res, {
      maxBytes: OWNER_ANSWER_MAX_BYTES,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === true) {
      return { kind: "yes", body: parsed as Record<string, unknown> };
    }
  } catch {
    /* an unreadable yes is not a yes */
  }
  return { kind: "unanswered" };
}

/** Said when the kit's own privacy check stopped the owner-link question. */
const OWNER_LINK_BLOCKED_LINE =
  "This owner link was not checked: the kit's own privacy check stopped the request on this device, so nothing was sent and nothing was switched on.";

function say(line: string): void {
  try {
    console.info(`[boosthis] ${line}`);
  } catch {
    /* nothing more can be said */
  }
}

let confirmed = false;
onDeviceErase(() => forgetOwnerPass());
let flight: Promise<boolean> | null = null;
let reconfirmTimer: ReturnType<typeof setTimeout> | null = null;
let withdrawnListener: (() => void) | null = null;

/** Has Boosthis confirmed, on THIS page, that this browser holds an owner
 *  pass for this project? False until it has said so. */
export function ownerPassConfirmed(): boolean {
  return confirmed;
}

/** Told when a confirmed pass is withdrawn while the page is open. */
export function onOwnerPassWithdrawn(fn: (() => void) | null): void {
  withdrawnListener = fn;
}

/** Switch this browser off: forget the pass (and the old flag). */
export function forgetOwnerPass(): void {
  confirmed = false;
  if (reconfirmTimer !== null) {
    clearTimeout(reconfirmTimer);
    reconfirmTimer = null;
  }
  try {
    storage.remove(OWNER_PASS_STORAGE_KEY);
    storage.remove(LEGACY_DEVICE_KEY);
  } catch {
    /* storage that cannot be reached holds nothing we could remove */
  }
}

function armReconfirm(): void {
  if (isDissolvedThisRun()) return;
  if (reconfirmTimer !== null) clearTimeout(reconfirmTimer);
  reconfirmTimer = kitTimeout(() => {
    reconfirmTimer = null;
    void reconfirm().catch(() => undefined);
  }, OWNER_PASS_RECONFIRM_MS);
}

async function reconfirm(): Promise<void> {
  if (!confirmed) return;
  const stored = readStoredPass();
  const ctx = activeContext();
  if (!stored || stored.expiresAt <= Date.now()) {
    forgetOwnerPass();
    withdrawnListener?.();
    return;
  }
  if (!ctx) {
    armReconfirm();
    return;
  }
  const answer = await ask(ctx, "/owner-bubble/confirm", {
    installId: ctx.installId,
    pass: stored.pass,
  });
  if (answer.kind === "refused") {
    forgetOwnerPass();
    withdrawnListener?.();
    return;
  }
  armReconfirm();
}

/**
 * Settle this page load's owner question once: apply a proof or a switch-off
 * from the address, then confirm a kept pass. Resolves true only when
 * Boosthis said yes. Never rejects.
 */
export function settleOwnerPass(): Promise<boolean> {
  if (!flight) flight = settle().catch(() => false);
  return flight;
}

async function settle(): Promise<boolean> {
  try {
    storage.remove(LEGACY_DEVICE_KEY);
  } catch {
    /* nothing to tidy */
  }
  const param = readOwnerParam();
  if (param && param.kind !== "other") stripOwnerParamFromAddress();
  if (param?.kind === "off") {
    forgetOwnerPass();
    return false;
  }
  if (param?.kind === "proof") {
    const ctx = await waitForContext();
    if (!ctx) {
      say(
        "This owner link could not be checked: this browser has not registered with Boosthis yet, so nothing was switched on.",
      );
    } else {
      const answer = await ask(ctx, "/owner-bubble/redeem", {
        installId: ctx.installId,
        proof: param.proof,
      });
      if (isDissolvedThisRun()) return false;
      const pass = answer.kind === "yes" ? answer.body["pass"] : null;
      const until = answer.kind === "yes" ? Date.parse(String(answer.body["passExpiresAt"])) : NaN;
      if (typeof pass === "string" && PASS_SHAPE.test(pass) && Number.isFinite(until)) {
        saveStoredPass(pass, until);
        confirmed = true;
        armReconfirm();
        return true;
      }
      say(
        answer.kind === "refused"
          ? "This owner link was not accepted: it was used already, has expired or belongs to another project. Open a new one from your project's page on Boosthis."
          : answer.kind === "blocked"
            ? OWNER_LINK_BLOCKED_LINE
            : "Boosthis could not be reached to check this owner link, so nothing was switched on.",
      );
    }
    // A link that did not work leaves a pass this browser already holds alone.
  }
  const stored = readStoredPass();
  if (!stored) return false;
  if (stored.expiresAt <= Date.now()) {
    forgetOwnerPass();
    return false;
  }
  const ctx = await waitForContext();
  if (!ctx) return false;
  const answer = await ask(ctx, "/owner-bubble/confirm", {
    installId: ctx.installId,
    pass: stored.pass,
  });
  if (isDissolvedThisRun()) return false;
  if (answer.kind === "refused") {
    forgetOwnerPass();
    return false;
  }
  if (answer.kind !== "yes") return false;
  confirmed = true;
  armReconfirm();
  return true;
}

let contextForTests: (() => CallContext | null) | null = null;
let fetchForTests: typeof fetch | null = null;

/** @internal test hooks: stand in for the registered install and the network. */
export function _setOwnerPassTransportForTests(
  t: { context: () => CallContext | null; fetch: typeof fetch } | null,
): void {
  contextForTests = t ? t.context : null;
  fetchForTests = t ? t.fetch : null;
}

/** @internal */
export function _resetOwnerPassForTests(): void {
  forgetOwnerPass();
  flight = null;
  withdrawnListener = null;
  contextForTests = null;
  fetchForTests = null;
}
