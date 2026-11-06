/** WHAT A PROBLEM REPORT SAYS ABOUT ITS CAUSE — the closed words.
 *
 * A recurring problem used to travel as a signature (`kind:severity:count`)
 * and a part, and nothing that pointed at why it happened. The kit already
 * decides, on the visitor's device, which KIND of destination every call went
 * to and how it ended; it measures how much script time came from the site's
 * own code and how much from other addresses; it watches the rhythm of every
 * live connection. It threw all of that away before reporting the problem.
 *
 * This module is the vocabulary those facts travel in. Every word is a
 * constant defined here (or, for destinations, in `callGroups.ts`); every
 * other field is a count or a duration in milliseconds; the only names are
 * page labels, which go through the same part-name rule and transmit guard as
 * every other label. No address, path, query, header or body is ever read into
 * any of it.
 *
 * DECIDING A CALL'S DESTINATION KIND AND HOW IT FAILED IS A PRIVACY STEP, NOT
 * JUDGING THE APP. It has to happen on the device because the address it is
 * decided from must never leave it. The server judges nothing it is not told:
 * it stores these facts as read and words them.
 *
 * The server mirrors every list below (artifacts/api-server/src/lib/
 * problemCause.ts) and a parity test holds the two together both ways, so a
 * reading is never dropped as unknown and the server never accepts a word no
 * kit can send.
 *
 * Import-free on purpose apart from the destination vocabulary: the server's
 * DOM-less build imports this file for the parity test.
 */

import type { CallGroupDestination } from "./callGroups";

/** How a call that did not come back with an answer ended. Closed set.
 *
 *  - `no-answer` — the call failed before any answer arrived: the network
 *    refused it, the connection broke, or the browser blocked it.
 *  - `turned-away` — the other side answered and refused the call (a 4xx).
 *  - `server-error` — the other side answered with an error of its own (a
 *    5xx, or, where the developer asked the kit to look, a normal-looking
 *    answer whose body carried an error).
 *  - `timed-out` — the page's own time limit ran out first.
 *  - `never-answered` — still waiting, long past the point where a call is
 *    merely slow (`HUNG_AFTER_MS`). */
export const CAUSE_FAILURE_KINDS = [
  "no-answer",
  "turned-away",
  "server-error",
  "timed-out",
  "never-answered",
] as const;

export type CauseFailureKind = (typeof CAUSE_FAILURE_KINDS)[number];

/** The wire spelling of each failure kind's count. One field per kind, so a
 *  row is a flat record of numbers rather than a nested map a reader has to
 *  walk. A count of zero is left out of the payload, never sent as a word. */
export const CAUSE_FAILURE_FIELDS: Readonly<Record<CauseFailureKind, string>> = {
  "no-answer": "noAnswer",
  "turned-away": "turnedAway",
  "server-error": "serverError",
  "timed-out": "timedOut",
  "never-answered": "neverAnswered",
};

/** Whether the visitor's browser reports which scripts held the page up.
 *  `not-reported` is a positive answer — the browser has no such report —
 *  never a zero standing in for one. */
export const CAUSE_PAGE_SCRIPTS = ["reported", "not-reported"] as const;
export type CausePageScripts = (typeof CAUSE_PAGE_SCRIPTS)[number];

/** The two kinds of long-lived connection the kit watches. */
export const CAUSE_CONNECTION_TRANSPORTS = ["ws", "sse"] as const;
export type CauseConnectionTransport =
  (typeof CAUSE_CONNECTION_TRANSPORTS)[number];

/** The blocks a cause can carry, one per problem kind that has one. */
export const CAUSE_BLOCKS = ["calls", "burst", "connection", "pageWait"] as const;
export type CauseBlock = (typeof CAUSE_BLOCKS)[number];

/** Which problem kind carries which block. A block on any other kind is
 *  dropped by the server as not belonging there. */
export const CAUSE_BLOCK_FOR_KIND: Readonly<Record<string, CauseBlock>> = {
  "slow-api": "calls",
  "failing-api": "calls",
  "api-thundering-herd": "burst",
  "reconnect-storm": "connection",
  "connection-stalled": "connection",
  "slow-nav": "pageWait",
};

/** At most this many destination rows; the rest are counted, never named. */
export const CAUSE_MAX_DESTINATIONS = 6;
/** At most this many page rows; the rest are counted, never named. */
export const CAUSE_MAX_PAGES = 3;
/** A call is SLOW at or past this: the network reading's own "poor" line
 *  (meterAxes NETWORK_THRESHOLDS.p75PoorMs), so a "slow call" here and the
 *  slow-call problem can never mean two different things. */
export const CAUSE_SLOW_CALL_MS = 3_000;

/** Counts of each way a call failed. Absent means zero. */
export interface CauseFailureCounts {
  noAnswer?: number;
  turnedAway?: number;
  serverError?: number;
  timedOut?: number;
  neverAnswered?: number;
}

/** One destination kind and what happened to the calls sent to it. */
export interface CauseCallDestination extends CauseFailureCounts {
  to: CallGroupDestination;
  calls: number;
  slow?: number;
}

/** One page that started calls, by its label. */
export interface CauseCallPage {
  page: string;
  calls: number;
  slow?: number;
  failed?: number;
}

/** The calls behind a slow-call or failing-call problem. Every count is the
 *  whole document's, the same counters the network reading scores, so the
 *  failure counts always add up to the failing-call problem's own count. */
export interface CauseCalls extends CauseFailureCounts {
  calls: number;
  slow?: number;
  destinations: CauseCallDestination[];
  /** Destination kinds beyond the listed rows, and how many calls went to
   *  them. Absent when every kind is listed. */
  destinationsNotListed?: { destinations: number; calls: number };
  pages: CauseCallPage[];
  /** Pages beyond the listed rows. Absent when every page is listed. */
  pagesNotListed?: { pages: number; calls: number };
  /** Calls started where no page could be named. */
  callsWithNoPage?: number;
}

/** The worst burst: the calls that started inside one window. */
export interface CauseBurst {
  calls: number;
  windowMs: number;
  destinations: { to: CallGroupDestination; calls: number }[];
  destinationsNotListed?: { destinations: number; calls: number };
  /** The page the burst happened on, when every call in it started on the
   *  same named page. */
  page?: string;
  /** How many different pages its calls started on (0 = none could be
   *  named). */
  pages: number;
}

/** The connection behind a reconnect storm or a stalled connection. */
export interface CauseConnection {
  to: CallGroupDestination;
  transport: CauseConnectionTransport;
  /** Storm: how many times it was opened again inside the storm window. */
  reopens?: number;
  /** Storm: the usual gap between those re-openings. */
  reopenGapMs?: number;
  /** Stalled: how long it had been silent when read. */
  silentMs?: number;
  /** Stalled: the usual gap between messages before it went silent — its
   *  own rhythm. */
  usualGapMs?: number;
}

/** What held up the slow page view. The parts add up to `totalMs`. */
export interface CausePageWait {
  totalMs: number;
  scripts: CausePageScripts;
  /** Long scripts from the site's own address (only when reported). */
  ownScriptMs?: number;
  /** Long scripts from other addresses (only when reported). */
  otherScriptMs?: number;
  /** The recognised service behind most of the other-address script time. */
  otherScriptService?: CallGroupDestination;
  /** Time spent waiting on calls while no long script was running. */
  callWaitMs: number;
  /** Everything else: rendering, images, styles, short scripts — and, where
   *  the browser does not report scripts, all script time too. */
  restMs: number;
}

/** The cause facts one problem report carries. Exactly one block. */
export interface ProblemCause {
  /** When these figures were read (epoch ms, the device's clock). */
  readAt: number;
  calls?: CauseCalls;
  burst?: CauseBurst;
  connection?: CauseConnection;
  pageWait?: CausePageWait;
}

/** Non-negative whole number, or 0. */
export function causeCount(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
    ? Math.round(n)
    : 0;
}

/** Copy the failure counts onto `out`, leaving zeroes out. */
export function putFailureCounts(
  out: CauseFailureCounts,
  counts: Readonly<Record<CauseFailureKind, number>>,
): void {
  for (const kind of CAUSE_FAILURE_KINDS) {
    const n = causeCount(counts[kind]);
    if (n > 0) {
      (out as Record<string, number>)[CAUSE_FAILURE_FIELDS[kind]] = n;
    }
  }
}

/** The kind a settled call's failure is, or null when it did not fail.
 *
 *  `status` is the HTTP status when there was an answer at all. A failure with
 *  no answer is `no-answer`; an answer of 500 or above is the other side's own
 *  error; anything else at 400 or above is the other side turning the call
 *  away. A body-error failure (an answer that looked fine and carried an
 *  error) is the other side's error, and is passed in as `bodyError`. */
export function failureKindFor(
  outcome: "completed" | "failed" | "aborted" | "timed-out",
  status: number | null | undefined,
  bodyError = false,
): CauseFailureKind | null {
  if (outcome === "timed-out") return "timed-out";
  if (outcome !== "failed") return null;
  if (bodyError) return "server-error";
  if (typeof status !== "number" || !Number.isFinite(status) || status <= 0) {
    return "no-answer";
  }
  if (status >= 500) return "server-error";
  if (status >= 400) return "turned-away";
  // A failure reported with a non-error status (a library that rejects on its
  // own rules): an answer did arrive, and the call still failed. The nearest
  // honest word is that the other side's answer was refused as an error.
  return "server-error";
}
