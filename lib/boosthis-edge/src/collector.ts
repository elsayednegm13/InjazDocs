/** What one isolate has measured so far.
 *
 * Per-isolate, in memory, bounded. An isolate can be recycled at any moment,
 * so nothing here is precious: whatever has not been sent when the isolate goes
 * away is lost, and the counters say so rather than pretending otherwise.
 */

import { rateDuration, type Rating } from "./version";

export interface RequestRow {
  label: string;
  count: number;
  totalMs: number;
  maxMs: number;
  good: number;
  needsWork: number;
  poor: number;
  errors: number;
  /** Every duration seen for this label, capped — kept so percentiles are real
   *  measurements rather than an average pretending to be one. */
  durations: number[];
}

export interface PendingSample {
  routeLabel: string;
  durationMs: number;
  rating: Rating;
}

/** Ceilings. An isolate's memory is the customer's memory. */
const MAX_ROWS = 60;
const MAX_DURATIONS_PER_ROW = 200;
const MAX_PENDING_SAMPLES = 200;

const rows = new Map<string, RequestRow>();
let pending: PendingSample[] = [];
let droppedSamples = 0;
let droppedRows = 0;
let requests = 0;
let firstSeenAtMs: number | null = null;

export function noteRequest(args: {
  label: string;
  durationMs: number;
  status: number;
  atMs: number;
}): void {
  requests += 1;
  if (firstSeenAtMs === null) firstSeenAtMs = args.atMs;
  const durationMs = Math.max(0, Math.round(args.durationMs));
  const rating = rateDuration(durationMs);
  let row = rows.get(args.label);
  if (!row) {
    if (rows.size >= MAX_ROWS) {
      droppedRows += 1;
      return;
    }
    row = {
      label: args.label,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      good: 0,
      needsWork: 0,
      poor: 0,
      errors: 0,
      durations: [],
    };
    rows.set(args.label, row);
  }
  row.count += 1;
  row.totalMs += durationMs;
  if (durationMs > row.maxMs) row.maxMs = durationMs;
  if (rating === "good") row.good += 1;
  else if (rating === "needs-work") row.needsWork += 1;
  else row.poor += 1;
  if (args.status >= 500) row.errors += 1;
  if (row.durations.length < MAX_DURATIONS_PER_ROW) row.durations.push(durationMs);

  if (pending.length < MAX_PENDING_SAMPLES) {
    pending.push({ routeLabel: args.label, durationMs, rating });
  } else {
    droppedSamples += 1;
  }
}

/** A request to a route the developer declared as waiting on purpose
 *  (declaredWaits.ts): counted as a request — so reliability and access
 *  pressure still see its status — but its duration feeds no route row and no
 *  sample, because it is the wait it was declared for. */
export function noteDeclaredRequest(atMs: number): void {
  requests += 1;
  if (firstSeenAtMs === null) firstSeenAtMs = atMs;
}

/** Take up to `max` pending samples off the queue for one upload. */
export function drainSamples(max: number): PendingSample[] {
  if (pending.length === 0) return [];
  const out = pending.slice(0, max);
  pending = pending.slice(out.length);
  return out;
}

/** Put samples back after a failed send, if there is still room. Anything that
 *  no longer fits is counted as dropped — never silently forgotten. */
export function returnSamples(samples: PendingSample[]): void {
  for (const s of samples) {
    if (pending.length < MAX_PENDING_SAMPLES) pending.unshift(s);
    else droppedSamples += 1;
  }
}

export function pendingCount(): number {
  return pending.length;
}

export function discardSamples(count: number): void {
  droppedSamples += count;
}

export interface CollectorState {
  rows: RequestRow[];
  requests: number;
  droppedSamples: number;
  droppedRows: number;
  firstSeenAtMs: number | null;
}

export function readState(): CollectorState {
  return {
    rows: [...rows.values()],
    requests,
    droppedSamples,
    droppedRows,
    firstSeenAtMs,
  };
}

/** THE LOCK RULE (docs/kit-lock-rule.md): throw away every row and sample this
 *  isolate holds, including what waited for the first answer. */
export function clearCollector(): void {
  rows.clear();
  pending = [];
  droppedSamples = 0;
  droppedRows = 0;
  requests = 0;
  firstSeenAtMs = null;
}

export function _resetCollectorForTests(): void {
  rows.clear();
  pending = [];
  droppedSamples = 0;
  droppedRows = 0;
  requests = 0;
  firstSeenAtMs = null;
}
