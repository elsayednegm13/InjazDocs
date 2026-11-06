/** Whether this isolate may run — the lock rule (docs/kit-lock-rule.md) in a
 *  place with no disk, no timer and no memory between wakes.
 *
 * WHERE THE ANSWER COMES FROM. An isolate makes no separate check-in: a second
 * round trip in front of a cold request would be the workload, not overhead
 * (docs/decisions/verdict-hand-over.md). The registration it already makes —
 * after the first response of every isolate, and again every six hours while
 * the isolate lives — carries the check-in's whole answer back. That reply is
 * the only thing that can make this kit run.
 *
 * THE ANSWERS, here:
 *   active     measure and upload, for at most the answer's grace (never more
 *              than seven days) without a fresh `active`.
 *   locked     every other word, a word this kit does not know, an `active`
 *              whose grace ran out, or a send refused by name (401, 402, 403).
 *              Measuring stops, the watch on the app's outgoing calls and its
 *              error log comes off, everything held — including what waited
 *              for the first answer — is thrown away, and nothing is sent. It
 *              asks again no sooner than the answer's recheckAfterSeconds, and
 *              never sooner than six hours.
 *   dissolved  the same, and also forget this install. Everything this isolate
 *              holds is in its memory (it has no disk), so that is the whole
 *              local erase. It asks nothing more in this isolate.
 *
 * NO WORD IS NOT AN ANSWER. A reply without a word, a reply that never came,
 * or a refusal of the kit's own payload leaves the state where it was: before
 * the first word the isolate measures into memory only. A reply without a
 * word is asked again in a minute; a reply that never came is tried again on
 * the failure schedule every back-end kit shares (registration.ts). A
 * successful upload is never an answer either: rows landing says nothing
 * about whether this project may run.
 *
 * RESTARTS. A new isolate IS the restart, and it starts with no word: the
 * server is the only memory this kit has. So a locked or dissolved project is
 * told so again by the first ask of every new isolate, before anything it
 * measured has left.
 */

export type EntitlementState =
  /** No word yet in this isolate: measure into memory, send nothing. */
  | "unknown"
  /** The server's exact `active`, still inside its grace. */
  | "active"
  /** Locked: any other word, an unknown word, a send refused by name, or an
   *  `active` whose grace ran out. Nothing measured, nothing held, nothing
   *  sent but the next ask. */
  | "refused"
  /** The project stayed locked past its owner's delay: erased, unhooked, and
   *  silent until the next isolate. */
  | "dissolved";

export interface EntitlementView {
  state: EntitlementState;
  /** The last word the server sent, exactly as it came. Null before any word,
   *  and when the stop came from a refusal by name or an expired grace. */
  word: string | null;
  /** Why this isolate is not running, in the server's words where it gave
   *  any. Null while unknown or active. */
  reason: string | null;
  /** How many times this isolate has stopped. A notice is said once per stop,
   *  never once per ask. */
  lockEpoch: number;
  /** Seconds until this isolate asks again; 0 when an ask is due; null when it
   *  never will (dissolved). */
  asksAgainInSeconds: number | null;
}

/** What this kit does when the answer stops it. Supplied by the module that
 *  owns the held data and the watch (index.ts): this one decides, that one
 *  acts, and neither imports the other's state. */
export interface LockHandlers {
  /** Throw away everything this isolate holds: rows, spans, crashes, counts,
   *  and what waited for the first answer. */
  clearSamples: () => void;
  /** Take the kit's watch off the app's outgoing calls and its error log. */
  unhook: () => void;
  /** Forget this install. Only ever this isolate's own memory: never the
   *  project's history on our server. */
  removeLocal: () => void;
}

/** The only word that lets this kit run. */
const ACTIVE = "active";
/** The words this kit knows beyond `active`, sent on every registration so the
 *  server may tell it `dissolved` rather than a plain lock. */
export const UNDERSTANDS: readonly string[] = Object.freeze(["dissolved"]);
/** When a dissolved isolate asks again: never; the next isolate asks once. */
export const ASK_AGAIN = "after-restart";
/** The shared cap on grace, whatever an answer states. */
export const MAX_GRACE_SECONDS = 7 * 24 * 60 * 60;
/** How often a live isolate asks while active, and the least wait after a
 *  lock or a refusal by name. */
export const ASK_EVERY_SECONDS = 6 * 60 * 60;
/** How soon to ask again when the reply carried no word or never came. */
export const NO_ANSWER_RETRY_SECONDS = 60;
/** The most of the server's own words this kit will hold for a notice. */
const MAX_REASON_CHARS = 500;

let state: EntitlementState = "unknown";
let word: string | null = null;
let reason: string | null = null;
/** When the last `active` arrived (wall clock), and how long it lasts. */
let answeredAtMs = 0;
let graceSeconds = 0;
/** When the next ask is due. 0 = at the next pass after a response. */
let nextAskAtMs = 0;
let lockEpoch = 0;
/** Moves every time held data is thrown away. A request that began under an
 *  earlier generation records nothing when it ends (see index.ts). */
let generation = 0;
let handlers: LockHandlers | null = null;

/** Hand this module what to do on a stop. Called once, at import. */
export function setLockHandlers(h: LockHandlers): void {
  handlers = h;
}

/** Read the current answer. Cheap, synchronous, per-isolate. */
export function entitlement(): EntitlementView {
  return {
    state,
    word,
    reason,
    lockEpoch,
    asksAgainInSeconds:
      state === "dissolved"
        ? null
        : Math.max(0, Math.ceil((nextAskAtMs - Date.now()) / 1000)),
  };
}

/** May this isolate measure? Before the first word, yes — into memory only,
 *  thrown away unless the word is exactly active. After it, only while
 *  active. */
export function mayMeasure(): boolean {
  settleGrace();
  return state === "unknown" || isActive();
}

/** May anything go on the wire besides the ask itself? Only on an exact
 *  `active`, inside its grace. */
export function mayUpload(): boolean {
  settleGrace();
  return isActive();
}

/** The exact word `active`, inside its grace. */
export function isActive(): boolean {
  return state === ACTIVE && !graceRanOut(Date.now());
}

export function isDissolved(): boolean {
  return state === "dissolved";
}

/** Is an ask due? Never once dissolved: the next isolate asks. */
export function askDue(now: number = Date.now()): boolean {
  return state !== "dissolved" && now >= nextAskAtMs;
}

/** The held-data generation (see `generation`). */
export function heldGeneration(): number {
  return generation;
}

/** Hear the answer a registration reply carried. False when it carried no
 *  word: that is no answer — never a lock, never active — and the next ask
 *  comes in a minute. */
export function learnAnswer(body: unknown): boolean {
  const e = objectField(body, "entitlement");
  const answer = e ? e.status : undefined;
  if (!e || typeof answer !== "string" || answer.length === 0) {
    noWord();
    return false;
  }
  const message = boundedText(e.message);
  const grace = cappedGrace(e.graceSeconds);
  store(answer, message, grace, answer === ACTIVE, e.recheckAfterSeconds);
  return true;
}

/** The reply carried no word: ask again in a minute. The reply never came:
 *  ask again at `retryAtMs`, the time the shared failure schedule gives the
 *  registration (registration.ts). An `active` already held stays active
 *  inside its grace; nothing else moves. */
export function noWord(retryAtMs?: number): void {
  if (state === "dissolved") return;
  nextAskAtMs = retryAtMs ?? Date.now() + NO_ANSWER_RETRY_SECONDS * 1000;
}

/** A send refused by name — 401, 402 or 403 — stops this isolate, on the
 *  registration and on any upload alike. True when it was one. */
export function learnRefusal(status: number | null, body: unknown): boolean {
  if (status !== 401 && status !== 402 && status !== 403) return false;
  lock(null, readReason(body) ?? `refused with ${status}`, ASK_EVERY_SECONDS);
  return true;
}

/** The kit could not send its own registration (it failed the kit's own
 *  checks). No answer can ever arrive in this isolate, so it stops rather than
 *  measuring into memory for nothing, and tries again in six hours. */
export function refuseOwnAsk(why: string): void {
  lock(null, why, ASK_EVERY_SECONDS);
}

/** The server no longer has this install on file (an upload answered 404):
 *  ask before anything else goes. */
export function askNow(): void {
  if (state === "dissolved") return;
  nextAskAtMs = 0;
}

/** Keep the word exactly as it came, and act on it. Only `active` runs. */
function store(
  answer: string,
  message: string | null,
  grace: number,
  success: boolean,
  recheckAfterSeconds: unknown,
): void {
  // Dissolved is final in this isolate: only the next isolate asks again.
  if (state === "dissolved") return;
  if (success) {
    state = ACTIVE;
    word = answer;
    reason = null;
    graceSeconds = grace;
    answeredAtMs = Date.now();
    nextAskAtMs = answeredAtMs + ASK_EVERY_SECONDS * 1000;
    return;
  }
  if (answer === "dissolved") {
    dissolve(message);
    return;
  }
  // Every other word — `paused`, `unpaid`, `revoked`, `tampered`, a word
  // invented next year — is a lock.
  lock(answer, message ?? answer, Math.max(waitSeconds(recheckAfterSeconds), ASK_EVERY_SECONDS));
}

function lock(answer: string | null, why: string | null, waitForSeconds: number): void {
  if (state === "dissolved") return;
  const wasRunning = state !== "refused";
  state = "refused";
  word = answer;
  reason = why;
  graceSeconds = 0;
  nextAskAtMs = Date.now() + waitForSeconds * 1000;
  if (!wasRunning) return; // already stopped: nothing held, nothing hooked
  lockEpoch += 1;
  generation += 1;
  const h = handlers;
  if (!h) return;
  runStep(() => h.unhook());
  runStep(() => h.clearSamples());
}

function dissolve(message: string | null): void {
  state = "dissolved";
  word = "dissolved";
  reason = message;
  graceSeconds = 0;
  nextAskAtMs = Number.POSITIVE_INFINITY;
  lockEpoch += 1;
  generation += 1;
  const h = handlers;
  if (!h) return;
  runStep(() => h.unhook());
  runStep(() => h.clearSamples());
  runStep(() => h.removeLocal());
}

/** An `active` whose grace ran out is a lock, noticed the moment anything
 *  asks: there is no timer here to notice it sooner. The next ask is due at
 *  once. */
function settleGrace(): void {
  if (state !== ACTIVE || !graceRanOut(Date.now())) return;
  lock(null, "Boosthis has not confirmed this project within its grace", 0);
}

function graceRanOut(now: number): boolean {
  return now - answeredAtMs > graceSeconds * 1000;
}

function cappedGrace(value: unknown): number {
  const grace =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : MAX_GRACE_SECONDS;
  return Math.min(grace, MAX_GRACE_SECONDS);
}

function waitSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A failing step must not stop the others: an unhook that throws still
 *  leaves the held data to be thrown away. */
function runStep(step: () => void): void {
  try {
    step();
  } catch {
    /* the next step still runs */
  }
}

function objectField(body: unknown, key: string): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const v = (body as Record<string, unknown>)[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function boundedText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, MAX_REASON_CHARS) : null;
}

function readReason(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  for (const k of ["reason", "code", "error", "detail", "message"]) {
    const v = b[k];
    if (typeof v === "string" && v.length > 0 && v.length <= 200) return v;
  }
  return null;
}

/** Test seam. Isolates start clean; a test process does not. The handlers
 *  stay: they are wired once, at import, as in a real isolate. */
export function _resetEntitlementForTests(): void {
  state = "unknown";
  word = null;
  reason = null;
  answeredAtMs = 0;
  graceSeconds = 0;
  nextAskAtMs = 0;
  lockEpoch = 0;
  generation = 0;
}
