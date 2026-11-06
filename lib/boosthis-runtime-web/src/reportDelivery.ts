/**
 * A REPORT FROM THE DEVELOPER'S AI: SENT, OR HONESTLY NOT.
 *
 * lib/kit-report-delivery-contract.json is the statement this file follows,
 * word for word in every kit that ships the report tool (Node, React Native,
 * website, Python); scripts/src/__tests__/kit-report-delivery-parity.test.ts
 * holds the four copies to it.
 *
 * WHY THIS EXISTS. The local AI helper used to store a report on the
 * developer's computer, fire the upload without waiting, and answer "ok" — a
 * crash-fix report even answered "Sent for a person to review". A helper
 * started on its own never completes the app's activation check-in, so the
 * kit's switched-off gate dropped every one of those uploads, and nobody
 * learned otherwise.
 *
 * WHAT IT DOES NOW. One question first, with the project key: is this project
 * active? (`POST /rules/propose/state`, which writes nothing at Boosthis, so
 * asking it never shows up as an install.) Only on `active` does the report
 * leave, and the helper waits for the answer. The reply says sent only when
 * Boosthis accepted the report (202 with `accepted: true`); every other
 * outcome is one reason from a closed list. Nothing is sent while the project
 * is locked: a lock Boosthis names is remembered for its stated wait, clamped
 * to the contract's bounds, and no question is asked until it passes.
 *
 * Both requests ride the kit's one transport (`_gatedTransmitInternal`), so
 * the privacy guard and the end user's permission run on them exactly as on
 * every other send, through the app's untouched fetch so the kit never counts
 * its own request as the app's traffic. They pass `allowWhenLocked` because a
 * helper started on its own is never activated; the server's answer to the
 * question is the authority instead, and a dissolved or switched-off kit stays
 * silent anyway.
 * The kit-level lock answers of the lock rule (docs/kit-lock-rule.md) run
 * before any of this and are unchanged.
 *
 * Never throws.
 */

import { readAnswerJson } from "./answerRead";
import { unwatchedFetch } from "./callWatch";
import { _gatedTransmitInternal } from "./gatedSend";
import { PIIDetectedError } from "./no-pii";
import { isBoosthisDisabled } from "./runtimeFlags";
import { isNoSendResponse } from "./transmit";

/** Why a report did not leave, or may not have arrived. The contract's list. */
export type ReportNotSentReason =
  | "locked"
  | "no-key"
  | "switched-off"
  | "privacy-guard"
  | "rate-limited"
  | "refused"
  | "unreachable"
  | "unreadable"
  | "unconfirmed";

/** What happened to one report. `sent` is true only for an accepted report. */
export type ReportOutcome =
  | { sent: true; tier: "A" | "B" | null }
  | { sent: false; reason: ReportNotSentReason; refusedBecause?: string };

/** Everything one report needs to leave. The body is built by the caller. */
export interface ReportSend {
  /** The kit's API base, without a trailing slash. */
  endpoint: string;
  /** The project key, or undefined when none is configured. */
  key: string | undefined;
  body: Record<string, unknown>;
  /** The install proof for tier B, applied after the privacy guard. */
  internalHeaders?: Record<string, string>;
}

export const REPORT_STATE_PATH = "/rules/propose/state";
export const REPORT_PATH = "/rules/propose";
const REPORT_STATE_TIMEOUT_MS = 5000;
const REPORT_SEND_TIMEOUT_MS = 10000;
/** Every answer either request can carry is a few hundred bytes. */
const REPORT_ANSWER_MAX_BYTES = 16384;
const MINIMUM_LOCK_WAIT_SECONDS = 21600;
const MAXIMUM_LOCK_WAIT_SECONDS = 86400;
/** A 403 carrying one of these words is a lock, not a refusal of the report. */
const LOCKED_403_ERRORS: readonly string[] = [
  "invite_key_revoked",
  "plan_required",
  "account_closure_pending",
  "project_locked",
];
const ERROR_WORD = /^[a-z][a-z0-9_]{0,63}$/;

// The words the reply carries, from the contract.
export const PATTERN_SENT =
  "Sent for a person to review. Nothing you send becomes a rule unless a person approves it.";
export const PATTERN_NOT_SENT = "Kept on this computer and not sent.";
export const PATTERN_UNCONFIRMED = "Kept on this computer. It may not have reached Boosthis.";
export const CRASH_FIX_SENT = "Sent for a person to review. Nothing is read back or served from it.";
export const CRASH_FIX_NOT_SENT = "Not sent, and not kept on this computer.";
export const CRASH_FIX_UNCONFIRMED = "Not kept on this computer. It may not have reached Boosthis.";

export const REPORT_WHY: Readonly<Record<ReportNotSentReason, string>> = {
  locked: "Boosthis is locked for this project, so reports are not sent until it is active again.",
  "no-key": "No project key is set where this helper runs, so it cannot send reports.",
  "switched-off": "Boosthis is switched off here, so nothing is sent.",
  "privacy-guard": "The privacy check on this computer stopped it before it left.",
  "rate-limited": "Boosthis is taking too many reports from this project right now. Try again later.",
  refused: "Boosthis refused it.",
  unreachable: "Boosthis could not be reached to confirm the project is active.",
  unreadable: "Boosthis gave an answer this helper could not read.",
  unconfirmed: "Boosthis did not confirm that it arrived.",
};

/** Until when a lock Boosthis named stops this process asking. */
let lockedUntilMs = 0;

/** @internal Tests only: forget a remembered lock. */
export function _resetReportDeliveryForTests(): void {
  lockedUntilMs = 0;
}

function rememberLock(seconds: number | null): void {
  const stated = seconds !== null && Number.isFinite(seconds) ? seconds : MINIMUM_LOCK_WAIT_SECONDS;
  const wait = Math.min(MAXIMUM_LOCK_WAIT_SECONDS, Math.max(MINIMUM_LOCK_WAIT_SECONDS, stated));
  lockedUntilMs = Date.now() + wait * 1000;
}

function notSent(reason: ReportNotSentReason, refusedBecause?: string): ReportOutcome {
  return refusedBecause ? { sent: false, reason, refusedBecause } : { sent: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Posted = { kind: "answer"; res: Response } | { kind: "threw"; guard: boolean };

async function post(
  url: string,
  payload: Record<string, unknown>,
  auth: string,
  internalHeaders: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<Posted> {
  try {
    const res = await _gatedTransmitInternal(
      url,
      payload,
      { timeoutMs, allowWhenLocked: true, fetchImpl: unwatchedFetch() ?? undefined },
      auth,
      internalHeaders,
    );
    return { kind: "answer", res };
  } catch (err) {
    return { kind: "threw", guard: err instanceof PIIDetectedError };
  }
}

/** The answer's JSON object, or null when it cannot be read in time. */
async function readObject(res: Response, timeoutMs: number): Promise<Record<string, unknown> | null> {
  try {
    const body = await readAnswerJson(res, { maxBytes: REPORT_ANSWER_MAX_BYTES, timeoutMs });
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

/** A made-up answer: the end user's permission withheld, the kit's own
 *  switch, or a kit that dissolved in this run. */
function silenced(res: Response): ReportOutcome {
  if (res.statusText === "Boosthis consent withheld") return notSent("switched-off");
  return notSent(isBoosthisDisabled() ? "switched-off" : "locked");
}

/** A refusal status, the same on both requests. Null: not a refusal. */
async function refusal(res: Response): Promise<ReportOutcome | null> {
  if (res.status === 402) {
    rememberLock(null);
    return notSent("locked");
  }
  if (res.status === 429) return notSent("rate-limited");
  if (res.status < 400 || res.status >= 500) return null;
  const body = await readObject(res, REPORT_STATE_TIMEOUT_MS);
  const word = body && typeof body.error === "string" && ERROR_WORD.test(body.error) ? body.error : undefined;
  if (res.status === 403 && word !== undefined && LOCKED_403_ERRORS.includes(word)) {
    rememberLock(null);
    return notSent("locked");
  }
  return notSent("refused", word);
}

/** Ask, then send. Every outcome is one of the contract's. */
export async function deliverReport(send: ReportSend): Promise<ReportOutcome> {
  let reportLeft = false;
  try {
    if (!send.key) return notSent("no-key");
    if (isBoosthisDisabled()) return notSent("switched-off");
    if (Date.now() < lockedUntilMs) return notSent("locked");
    const auth = `Bearer ${send.key}`;

    const asked = await post(`${send.endpoint}${REPORT_STATE_PATH}`, {}, auth, undefined, REPORT_STATE_TIMEOUT_MS);
    if (asked.kind === "threw") return notSent(asked.guard ? "privacy-guard" : "unreachable");
    if (isNoSendResponse(asked.res)) return silenced(asked.res);
    if (asked.res.status !== 200) {
      const refused = await refusal(asked.res);
      if (refused) return refused;
      return notSent(asked.res.status >= 500 ? "unreachable" : "unreadable");
    }
    const state = await readObject(asked.res, REPORT_STATE_TIMEOUT_MS);
    if (state === null) return notSent("unreadable");
    if (state.state === "locked") {
      const recheck = typeof state.recheckAfterSeconds === "number" ? state.recheckAfterSeconds : null;
      rememberLock(recheck);
      return notSent("locked");
    }
    if (state.state !== "active") return notSent("unreadable");

    reportLeft = true;
    const filed = await post(
      `${send.endpoint}${REPORT_PATH}`,
      send.body,
      auth,
      send.internalHeaders,
      REPORT_SEND_TIMEOUT_MS,
    );
    if (filed.kind === "threw") return notSent(filed.guard ? "privacy-guard" : "unconfirmed");
    if (isNoSendResponse(filed.res)) return silenced(filed.res);
    if (filed.res.status === 202) {
      const answer = await readObject(filed.res, REPORT_SEND_TIMEOUT_MS);
      if (answer === null || answer.accepted !== true) return notSent("unconfirmed");
      const tier = answer.tier === "A" || answer.tier === "B" ? answer.tier : null;
      return { sent: true, tier };
    }
    const refused = await refusal(filed.res);
    return refused ?? notSent("unconfirmed");
  } catch {
    return notSent(reportLeft ? "unconfirmed" : "unreachable");
  }
}

/** The reply to a pattern report, which is always kept on this computer. */
export function patternReply(storedAtMs: number, outcome: ReportOutcome): Record<string, unknown> {
  if (outcome.sent) {
    return {
      ok: true,
      stored_at_ms: storedAtMs,
      sent: true,
      says: PATTERN_SENT,
      ...(outcome.tier ? { tier: outcome.tier } : {}),
    };
  }
  const lead = outcome.reason === "unconfirmed" ? PATTERN_UNCONFIRMED : PATTERN_NOT_SENT;
  return {
    ok: true,
    stored_at_ms: storedAtMs,
    sent: false,
    says: `${lead} ${REPORT_WHY[outcome.reason]}`,
    not_sent_reason: outcome.reason,
    ...(outcome.refusedBecause ? { refused_because: outcome.refusedBecause } : {}),
  };
}

/** The reply to a crash-fix report, which is never kept on this computer. */
export function crashFixReply(outcome: ReportOutcome): Record<string, unknown> {
  if (outcome.sent) {
    return {
      ok: true,
      filed: true,
      sent: true,
      says: CRASH_FIX_SENT,
      ...(outcome.tier ? { tier: outcome.tier } : {}),
    };
  }
  const lead = outcome.reason === "unconfirmed" ? CRASH_FIX_UNCONFIRMED : CRASH_FIX_NOT_SENT;
  return {
    ok: false,
    filed: false,
    sent: false,
    says: `${lead} ${REPORT_WHY[outcome.reason]}`,
    not_sent_reason: outcome.reason,
    ...(outcome.refusedBecause ? { refused_because: outcome.refusedBecause } : {}),
  };
}
