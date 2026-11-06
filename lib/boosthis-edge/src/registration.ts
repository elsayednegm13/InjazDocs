/** Filing this function as a project — and hearing, on the same reply, whether
 *  it may run (entitlement.ts, docs/kit-lock-rule.md).
 *
 * The registration says "this install exists, it is an edge isolate, it
 * belongs to this key", and it is the lock rule's ask: its reply carries the
 * check-in's whole answer. It asks for no credential back and keeps nothing,
 * because there is nowhere to keep it and because a hundred isolates asking
 * for credentials at once would spend their time invalidating each other's.
 *
 * WHEN IT ASKS is decided by entitlement.ts: after the first response of
 * every isolate; every six hours while active; after a lock, no sooner than
 * the answer's wait and never sooner than six hours; a minute after a reply
 * with no word; at once when the server no longer has this install on file;
 * never again in an isolate told `dissolved`. Never on the customer's request
 * path: it runs in the work handed to the host after the response.
 *
 * A failure that is not an answer (no answer, a timeout, a 5xx, a 404, a 429)
 * is tried again by THIS isolate, on the schedule every back-end kit shares:
 * after about 15 s, 45 s, 2 min and 5 min, then every 5 min, each wait spread
 * a little so a fleet restarted together does not retry in step. An isolate
 * keeps no timers, so nothing is armed: the first response flushed after the
 * wait is over makes the attempt. The next isolate still starts from scratch.
 * Rule: docs/kit-entitlement-checkin.md, "When a call to us fails".
 */

import {
  learnAnswer,
  learnRefusal,
  noWord,
  refuseOwnAsk,
  UNDERSTANDS,
} from "./entitlement";
import { send } from "./transmit";
import { RUNTIME_TAG, RUNTIME_VERSION } from "./version";
import { hostingFacts, type EdgePlatform } from "./platform";
import type { CoverageInventory } from "./watchableSurfaces";

export type RegistrationState =
  /** Not filed in this isolate yet, or forgotten (dissolved). */
  | "unregistered"
  /** The server has this install on file. Whether it may run is the answer's
   *  business (entitlement.ts), never this state's. */
  | "registered"
  /** The server said no by name, or the kit refused its own payload. */
  | "refused"
  /** No answer: no network, a timeout, a 5xx, a 404 from routing in front of
   *  us, a 429. Not a verdict: this isolate tries again on the shared
   *  schedule, and so does the next isolate. */
  | "unreachable";

let state: RegistrationState = "unregistered";
let inFlight: Promise<RegistrationState> | null = null;
let lastReason: string | null = null;

/** The waits between attempts after a registration failed for a temporary
 *  reason, in milliseconds. The last one repeats. Shared by every back-end
 *  kit, and read out of this line by the cross-kit guard. */
export const REGISTRATION_RETRY_SCHEDULE_MS = [15_000, 45_000, 120_000, 300_000] as const;

/** Failed attempts in the current run of failures; a success resets it. */
let failedAttempts = 0;
/** No attempt before this time (epoch ms). 0 means "whenever asked". */
let nextAttemptAt = 0;
let clock: () => number = () => Date.now();
let random: () => number = () => Math.random();
/** Test seam: multiplies every wait. Shipped value 1, never changed. */
let waitScale = 1;

/** The wait before the next attempt, after `failed` failures in a row. A 429
 *  waits at least as long as the server asked, never less; every other wait
 *  is spread between 0.8 and 1.2 of its step. */
function nextWaitMs(failed: number, retryAfterMs: number | null): number {
  const steps = REGISTRATION_RETRY_SCHEDULE_MS;
  const step = steps[Math.min(Math.max(failed - 1, 0), steps.length - 1)]! * waitScale;
  if (retryAfterMs !== null) {
    return Math.max(step, retryAfterMs) * (1 + 0.2 * random());
  }
  return step * (0.8 + 0.4 * random());
}

export function registrationState(): {
  state: RegistrationState;
  reason: string | null;
} {
  return { state, reason: lastReason };
}

export interface RegisterArgs {
  endpoint: string;
  installId: string;
  projectKey: string;
  appName?: string | undefined;
  platform: EdgePlatform;
  fetchImpl?: typeof fetch;
  /** What this isolate reached, and what it found and cannot watch. Optional:
   *  an isolate that cannot answer — or one that is stopped, and so holds no
   *  readings — sends nothing, and the server reads that as "this install has
   *  not reported coverage", never as full coverage. */
  coverage?: CoverageInventory | undefined;
}

/** Ask now. Concurrent callers share one in-flight request — an isolate
 *  serving twenty requests at once must ask once, not twenty times. Whether an
 *  ask is due is the caller's question (`askDue`). */
export async function ask(args: RegisterArgs): Promise<RegistrationState> {
  if (inFlight) return inFlight;
  // Waiting out a temporary failure: nothing goes on the wire until the time
  // has come, and the rows stay held. The flush after it makes the attempt.
  if (state === "unreachable" && clock() < nextAttemptAt) return state;
  inFlight = registerOnce(args).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function registerOnce(args: RegisterArgs): Promise<RegistrationState> {
  const outcome = await send({
    url: `${args.endpoint}/installs/consent`,
    bearer: args.projectKey,
    payload: {
      installId: args.installId,
      runtime: RUNTIME_TAG,
      packageVersion: RUNTIME_VERSION,
      ...(args.appName ? { appName: args.appName } : {}),
      platform: args.platform,
      // WHERE THIS PROJECT RUNS, in the same three words every other kit
      // sends, so an isolate host reads off one vocabulary with every other
      // host rather than only out of the isolate column. Re-derived on each
      // isolate, so a function republished onto a different host stops being
      // described by the old one.
      hosting: hostingFacts(args.platform),
      // WHAT WE ARE NOT WATCHING HERE. `withBoosthis` instruments the `fetch`
      // export and nothing else; if this worker also declares a queue consumer
      // or a cron handler, that is a blind spot the developer can only learn
      // about from us. Terms and counts only — never a handler's own name.
      ...(args.coverage ? { coverage: args.coverage } : {}),
      // The words this kit knows beyond `active`, so the server may answer
      // `dissolved` rather than a plain lock.
      understands: [...UNDERSTANDS],
    },
    fetchImpl: args.fetchImpl,
  });
  if (outcome.ok) {
    // Any 2xx. This kit asks for no credential back, so there is no "answered
    // but handed nothing" case to retry: the install is on file.
    state = "registered";
    lastReason = null;
    failedAttempts = 0;
    nextAttemptAt = 0;
    // A 2xx files the install; only the word inside the reply decides
    // whether it runs. No word is no answer, and the next ask is a minute
    // away.
    learnAnswer(outcome.body);
    return state;
  }
  // Only a 401, 402 or 403 names a refusal. A 404 is NOT one: the consent
  // route never answers 404, so one comes from routing in front of us (a
  // deploy in progress, a proxy's own page) and says nothing about this
  // project. Read as a refusal it silenced the isolate for its whole life; it
  // is retried on the schedule instead.
  if (learnRefusal(outcome.status, outcome.body)) {
    // The server said no to this project by name: a key that is not ours, a
    // paused account. That is a lock, and it has already stopped this
    // isolate.
    state = "refused";
    lastReason = describe(outcome.status, outcome.body);
    return state;
  }
  if (outcome.reason === "pii-guard" || outcome.reason === "too-large") {
    state = "refused";
    lastReason = "the kit refused to send its own registration";
    refuseOwnAsk(lastReason);
    return state;
  }
  // No answer at all: no network, a timeout, a 404 or a 5xx from something
  // in front of us, a rate limit. Not a verdict.
  state = "unreachable";
  lastReason = outcome.status === null ? outcome.reason : `no answer (${outcome.status})`;
  failedAttempts += 1;
  const retryAfterMs = outcome.status === 429 ? (outcome.retryAfterMs ?? null) : null;
  nextAttemptAt = clock() + nextWaitMs(failedAttempts, retryAfterMs);
  // The next ask waits for that time, not the minute a reply with no word
  // gets: no reply follows the failure schedule every back-end kit shares.
  noWord(nextAttemptAt);
  return state;
}

/** When the next registration attempt may be made (epoch ms), or null when
 *  nothing is waiting. For the status read and tests. */
export function nextRegistrationAttemptAt(): number | null {
  return state === "unreachable" ? nextAttemptAt : null;
}

function describe(status: number | null, body: unknown): string {
  const code =
    body && typeof body === "object"
      ? ((body as Record<string, unknown>).error ??
        (body as Record<string, unknown>).reason)
      : null;
  if (typeof code === "string" && code.length > 0 && code.length <= 100) {
    return code;
  }
  return status === null ? "refused" : `refused with ${status}`;
}

/** Forget this install (dissolved). Only this isolate's own memory: the
 *  project's history on our server is not this kit's to remove. */
export function forgetRegistration(): void {
  state = "unregistered";
  lastReason = null;
}

export function _resetRegistrationForTests(): void {
  state = "unregistered";
  inFlight = null;
  lastReason = null;
  failedAttempts = 0;
  nextAttemptAt = 0;
  clock = () => Date.now();
  random = () => Math.random();
  waitScale = 1;
}

/** Test seam: a clock, a random source and a scale for the waits. The shipped
 *  schedule itself never changes. */
export function _setRegistrationTimingForTests(opts: {
  now?: () => number;
  random?: () => number;
  waitScale?: number;
}): void {
  if (opts.now) clock = opts.now;
  if (opts.random) random = opts.random;
  if (opts.waitScale !== undefined) waitScale = opts.waitScale;
}
