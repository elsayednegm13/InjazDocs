/** Background jobs on an isolate host: each scheduled run, filed under its
 * schedule's name.
 *
 * WHY THIS EXISTS. `boosthisEntryPoint("scheduled", …)` always measured a cron
 * run — timed, failures counted, its outbound calls folded in — but only as one
 * anonymous `job:scheduled` row among the request meters. Two cron triggers on
 * one Worker read as one, and a nightly rebuild that stopped firing changed
 * nothing anyone could see: no job went late, because no row was ever the
 * job's. Each finished run is now ALSO filed the way every server kit files a
 * background job, so it reaches the project's list of jobs and the back half
 * of the map, and a rhythm the owner sets on the job's page is judged against
 * it.
 *
 * FOUR FACTS PER RUN, AND NOTHING ELSE: the name, how long ago it finished, how
 * long it took, and whether it worked — the same four every other kit sends.
 * Nothing the handler was handed or returned is read.
 *
 * WHERE THE NAME COMES FROM. The `job` option when the developer gives one: the
 * name as written in the app. Otherwise, on Cloudflare, the cron pattern that
 * fired this run (`controller.cron`, such as "0 3 * * *") — the schedule's own
 * name in wrangler.toml and on the Cloudflare dashboard, and the only thing
 * that tells two triggers on one Worker apart. Deno Deploy hands a cron handler
 * nothing at all, so a Deno cron is named in the option or it is not filed. A
 * run with no name is refused, counted and said once, never filed as an
 * unnamed job. The developer's FUNCTION name is never read: every bundler
 * mangles it, and nobody wrote it as a label.
 *
 * THE SCREEN IS THE SERVER'S: empty and over-length here, then the same value
 * checks the server applies (`jobNameHasPII`). A refused name is counted and
 * said once per cause, and never printed — it is exactly the string that must
 * not travel.
 *
 * WHEN IT LEAVES. An isolate runs nothing after its work is handed back, and
 * this kit keeps no timer. A run leaves on the same after-response handoff that
 * carries its run's other readings (`ctx.waitUntil`), in an upload of its own
 * beside them (see `flush` in index.ts). An upload that does not land keeps its
 * runs for this isolate's next handoff; a run that waited past
 * {@link MAX_JOB_MS} is dropped and counted, never re-dated.
 *
 * NO COUNT LINES. The server kits fold a busy backlog into one line per job. An
 * isolate's backlog is a few cron runs at most and dies with the isolate, so
 * past {@link MAX_BUFFERED_JOB_RUNS} the OLDEST run is given up and counted.
 *
 * NO RHYTHM IS DECLARED. A cron pattern is a rhythm, but this kit does not turn
 * it into one: a job is judged against a rhythm only when one was declared, on
 * the job's page. Translating cron into an interval would declare a rhythm
 * nobody wrote.
 */

import { sayOnce, type Notice } from "./announce";
import { jobNameHasPII } from "./no-pii";

/** The longest job name the server keeps. A longer one is refused, never
 *  shortened: two names cut to the same length would be filed as one job, and
 *  a shortened name would be screened with its tail already gone.
 *  See docs/decisions/job-name-length.md. */
export const MAX_JOB_NAME = 80;

/** Most runs one upload carries. The same batch every kit sends. */
export const MAX_JOB_RUN_BATCH = 50;

/** Most runs one isolate holds while it waits for an upload to land. */
export const MAX_BUFFERED_JOB_RUNS = 200;

/** The oldest a run may be when it is sent, and the longest it may have taken:
 *  a week, the server's own ceiling on both. */
export const MAX_JOB_MS = 604_800_000;

/** One run while it waits. */
export interface HeldJobRun {
  job: string;
  finishedAtMs: number;
  durationMs: number;
  ok: boolean;
}

/** One run as it travels. Exactly these four keys. */
export interface JobRunWire {
  job: string;
  finishedAgoMs: number;
  durationMs: number;
  ok: boolean;
}

let buffer: HeldJobRun[] = [];
/** Runs this isolate gave up on: aged out, pushed past the cap, or refused for
 *  good by the server. A count, so a gap in a job's history has a number. */
let lostJobRuns = 0;

let nameRefusedRuns = 0;
const nameRefusedNames = new Set<number>();
/** Bounded: a name built from a value is exactly the unbounded input. */
const MAX_REFUSED_NAMES_TRACKED = 50;

/** A refused name reduced to a number, for counting distinct ones and nothing
 *  else. The strings are by definition the ones a VALUE rule matched; a hash
 *  counts just as well and cannot be read back. */
function refusedNameFingerprint(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) h = (h * 33) ^ name.charCodeAt(i);
  return h >>> 0;
}

/** Why a job's name is refused, or null when it may travel. Empty and
 *  over-length first, then the server's own value checks. */
export function checkJobName(name: string): string | null {
  if (name.trim().length === 0) return "~empty-label";
  if (name.length > MAX_JOB_NAME) return "~over-length";
  return jobNameHasPII(name);
}

function refusalLine(length: number, cause: string): string {
  let why: string;
  if (cause === "~empty-label") {
    why =
      'it has no name. Deno Deploy hands a cron handler nothing to name it by, so name it where you wrap it: boosthisEntryPoint("scheduled", handler, { job: "nightly-rebuild" }).';
  } else if (cause === "~over-length") {
    why =
      `its name is ${length} characters, and a job name must be ${MAX_JOB_NAME} or fewer. ` +
      `It is refused rather than shortened, because two names cut to the same ${MAX_JOB_NAME} characters would be filed as one job, ` +
      "and a shortened name would be screened with its tail already gone.";
  } else {
    why =
      `its name (${length} characters) matched ${cause}, so it reads as something built out of a value rather than a label. ` +
      'Spaces are fine — "queue drain" is a name. An email address, a token, an IP address, a phone number, a UUID or a run of six or more digits is not.';
  }
  const unprinted =
    cause === "~empty-label"
      ? ""
      : " The name itself is deliberately not printed — it is exactly the string that must not travel, and your logs are somewhere it would travel to.";
  return (
    `Boosthis is not filing a background job run: ${why} ` +
    "The run is still timed among this function's readings, but the job will not appear in the project's list of jobs: " +
    'it is not late, and it is not "never reported"; it does not exist there.' +
    unprinted
  );
}

/** Record one run refused for its NAME, and say so once per cause. Stores a
 *  fingerprint, never the name. */
export function noteJobNameRefused(name: string, cause: string, notice?: Notice): void {
  nameRefusedRuns += 1;
  if (nameRefusedNames.size < MAX_REFUSED_NAMES_TRACKED) {
    nameRefusedNames.add(refusedNameFingerprint(name));
  }
  sayOnce(`job-name:${cause}`, refusalLine(name.length, cause), notice);
}

/** Runs this isolate refused for their name, and how many distinct names. */
export function jobNameRefusals(): { runs: number; names: number } {
  return { runs: nameRefusedRuns, names: nameRefusedNames.size };
}

/**
 * File one finished run. Screens the name, holds the run and returns; nothing
 * is sent from here. Never throws, and returns whether the run was held.
 */
export function fileJobRun(run: {
  job: string | null | undefined;
  durationMs: number;
  ok: boolean;
  notice?: Notice | undefined;
  /** When it finished, by the wall clock. Defaults to now. */
  finishedAtMs?: number;
}): boolean {
  try {
    const name = typeof run.job === "string" ? run.job.trim() : "";
    const refused = checkJobName(name);
    if (refused !== null) {
      noteJobNameRefused(name, refused, run.notice);
      return false;
    }
    const durationMs = Math.round(run.durationMs);
    // A run that took longer than the server can store is not a run this kit
    // can describe truthfully; counted, never clamped to a week it did not take.
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_JOB_MS) {
      lostJobRuns += 1;
      return false;
    }
    buffer.push({
      job: name,
      finishedAtMs:
        typeof run.finishedAtMs === "number" && Number.isFinite(run.finishedAtMs)
          ? run.finishedAtMs
          : Date.now(),
      durationMs,
      ok: run.ok === true,
    });
    while (buffer.length > MAX_BUFFERED_JOB_RUNS) {
      buffer.shift();
      lostJobRuns += 1;
    }
    return true;
  } catch {
    // A guest never fails its host.
    return false;
  }
}

/**
 * Take up to one batch for an upload. A run that aged past the ceiling while
 * it waited is dropped and counted here, never re-dated onto a day it did not
 * run. An empty buffer takes nothing, so no empty batch is ever sent.
 */
export function takeJobRuns(now: number = Date.now()): {
  held: HeldJobRun[];
  wire: JobRunWire[];
} {
  if (buffer.length === 0) return { held: [], wire: [] };
  const taken = buffer.splice(0, MAX_JOB_RUN_BATCH);
  const held: HeldJobRun[] = [];
  const wire: JobRunWire[] = [];
  for (const r of taken) {
    // A wall clock that stepped back makes a run look newer than now, which is
    // the clock's fault and not the run's: read as just finished.
    const ago = Math.max(0, now - r.finishedAtMs);
    if (ago > MAX_JOB_MS) {
      lostJobRuns += 1;
      continue;
    }
    held.push(r);
    wire.push({ job: r.job, finishedAgoMs: ago, durationMs: r.durationMs, ok: r.ok });
  }
  return { held, wire };
}

/** Put a batch back after an upload that may land next time. Oldest first, so
 *  past the cap it is the oldest that is given up. */
export function returnJobRuns(runs: readonly HeldJobRun[]): void {
  if (runs.length === 0) return;
  buffer = [...runs, ...buffer];
  while (buffer.length > MAX_BUFFERED_JOB_RUNS) {
    buffer.shift();
    lostJobRuns += 1;
  }
}

/** A batch refused for good — a bad shape, or our own privacy or size check.
 *  It would be refused again, so it is let go and counted. */
export function discardJobRuns(count: number): void {
  if (count > 0) lostJobRuns += count;
}

/** Runs held, waiting for an upload. */
export function pendingJobRunCount(): number {
  return buffer.length;
}

/** Runs this isolate gave up on. */
export function jobRunsLost(): number {
  return lostJobRuns;
}

/** A stop threw away everything held: the runs go with it, unsent. */
export function clearJobRuns(): void {
  buffer = [];
}

export function _resetJobRunsForTests(): void {
  buffer = [];
  lostJobRuns = 0;
  nameRefusedRuns = 0;
  nameRefusedNames.clear();
}
