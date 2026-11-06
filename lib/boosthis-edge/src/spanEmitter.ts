/** Full-stack trace — span emission from a V8 isolate.
 *
 * `trace.ts` adopts the correlation id and `spanScope.ts` mints this hop's
 * identity. This module holds the one span the worker records for its own
 * request until the after-response flush can carry it away.
 *
 * ## What an isolate changes, and what it does not
 *
 * The wire row is byte-identical to every other kit's: the same six required
 * keys, the same two causality keys added only when present, the same closed
 * work vocabulary. A span from a Worker and a span from an Express app meet in
 * one waterfall, so they cannot differ.
 *
 * What differs is the LIFETIME around it. Every other kit buffers spans and
 * flushes them on a timer. There is no timer here that outlives a response,
 * and the isolate may be frozen or discarded the moment the reply is written.
 * So the span is RECORDED synchronously at the freeze boundary — inside the
 * request that produced it, never deferred to a later opportunity — and it
 * leaves on the same after-response handoff the samples and the snapshot use.
 * Nothing here schedules anything.
 *
 * A buffer is still needed because that handoff can fail, and because a
 * platform can freeze an isolate with work outstanding. It follows the
 * collector's rule: `drainSpans` takes a batch, `returnSpans` puts it back at
 * the FRONT when the transport failed, and anything that will not fit is
 * counted as dropped rather than silently forgotten. An isolate's memory is
 * the customer's memory, so the buffer is small and bounded.
 *
 * LINKED STEPS (`linkedSteps.ts`) wait BESIDE the request step they belong to
 * and go wherever it goes: dropped with it at the ceiling, or — once it has
 * been taken for an upload — moved to their own small share, from which the
 * same flush takes whole groups into the room the batch has left. They never
 * push a request's own step out.
 */

import { sanitizeSpanId } from "./spanScope";
import {
  sanitizeOutcome,
  sanitizeWorkKind,
  type SpanOutcome,
  type SpanWorkKind,
} from "./spanWork";
import { rateDuration, type Rating } from "./version";
import { MAX_PART_NAME } from "./routeLabel";
import { kindOfLinkedWord, MAX_LINKED_STEPS_PER_REQUEST } from "./linkedSteps";

/** This kit only ever produces `"edge"` spans. The server's `POST /api/spans`
 *  schema accepts the full runtime union. */
export type SpanLayer = "edge";
export type SpanRating = Rating;

/** One privacy-safe span. Wire shape is byte-identical across all runtimes and
 *  matches the server's `POST /api/spans` schema. */
export interface TraceSpan {
  traceId: string;
  layer: SpanLayer;
  routeLabel: string;
  durationMs: number;
  startOffsetMs: number;
  rating: SpanRating;
  spanId?: string | null;
  parentSpanId?: string | null;
  /** What KIND of work this was, and whether it WORKED. Same rules as the
   *  causality pair: optional, drawn from the shared vocabulary in
   *  `spanWork.ts`, and omitted entirely when the kit has nothing to say —
   *  never sent as a placeholder, because an absent field reads as "this kit
   *  does not report it" and a value would read as a measurement. */
  kind?: SpanWorkKind | null;
  outcome?: SpanOutcome | null;
  /** "declared": the request was to a route the developer declared as waiting
   *  on purpose (declaredWaits.ts), so its duration is a wait, not slowness,
   *  and the trace page says so rather than marking it slow. Omitted
   *  otherwise. */
  wait?: "declared" | null;
}

/** Server accepts at most 50 spans per batch. */
export const MAX_SPAN_BATCH = 50;
/** Hard cap on the in-memory buffer. One span per request, and an isolate that
 *  cannot get them away is an isolate whose platform is freezing it — holding
 *  more would cost the customer memory to no purpose. */
export const MAX_BUFFERED_SPANS = 100;
/** Duration hard clamp (matches the server `durationMs` 0..600000 bound). */
export const MAX_SPAN_DURATION_MS = 600_000;

/** The linked steps' own share: how many may wait to be sent once the step
 *  they belong to has left. */
export const MAX_BUFFERED_LINKED_STEPS = 50;

let buffer: TraceSpan[] = [];
let dropped = 0;
/** Each buffered request step's linked steps, until that step is taken. Keyed
 *  by the buffered row itself, so a row dropped at the ceiling takes its group
 *  with it. */
let beside = new WeakMap<TraceSpan, TraceSpan[]>();
/** Groups whose step has been taken for an upload, oldest first. */
let ready: TraceSpan[][] = [];

/* A trace span is a NETWORK round-trip, not a page paint, so it is rated on the
 * SAME cross-runtime span band as every other layer — the shared TTI band this
 * kit already applies to a request duration. Otherwise the very same 1.2s call
 * would read "good" from the browser and "poor" from the worker inside one
 * waterfall. */
export function rateSpanDuration(durationMs: number): SpanRating {
  return rateDuration(durationMs);
}

/** Record one span. Called synchronously at the freeze boundary, from inside
 *  the request that produced it. Clamps duration and offset, rebuilds a closed
 *  row (never spreads unknown keys), and drops the OLDEST span when the buffer
 *  is full — the newest span is the one most likely still to be sendable.
 *
 *  `linked` is the linked steps made inside this span's request. They are kept
 *  only when the span itself is kept and carries its own id, and each is
 *  rebuilt to name that id as its parent. */
export function enqueueSpan(span: TraceSpan, linked: readonly TraceSpan[] = []): void {
  if (span.routeLabel.length > MAX_PART_NAME) {
    dropped += 1;
    return;
  }
  const durationMs = Math.max(
    0,
    Math.min(MAX_SPAN_DURATION_MS, Math.round(span.durationMs)),
  );
  const startOffsetMs = Math.max(
    0,
    Math.min(MAX_SPAN_DURATION_MS, Math.round(span.startOffsetMs || 0)),
  );
  // Rebuild a closed span so the buffered shape stays byte-identical to the
  // other runtimes'. The causality pair is validated here and ADDED ONLY WHEN
  // PRESENT: a malformed id is dropped rather than forwarded, and a span with
  // nothing to say about its caller sends the same six keys it always did.
  const row: TraceSpan = {
    traceId: span.traceId,
    layer: span.layer,
    routeLabel: span.routeLabel,
    durationMs,
    startOffsetMs,
    rating: span.rating,
  };
  const spanId = sanitizeSpanId(span.spanId);
  if (spanId !== null) row.spanId = spanId;
  const parentSpanId = sanitizeSpanId(span.parentSpanId);
  if (parentSpanId !== null) row.parentSpanId = parentSpanId;
  const kind = sanitizeWorkKind(span.kind);
  if (kind !== null) row.kind = kind;
  const outcome = sanitizeOutcome(span.outcome);
  if (outcome !== null) row.outcome = outcome;
  if (span.wait === "declared") row.wait = "declared";
  if (spanId !== null && linked.length > 0) {
    const kids = closedLinked(linked, spanId);
    if (kids.length > 0) beside.set(row, kids);
  }
  buffer.push(row);
  while (buffer.length > MAX_BUFFERED_SPANS) {
    buffer.shift();
    dropped += 1;
  }
}

/** Linked steps rebuilt field by field, each forced to name `parent` as its
 *  parent and to carry a closed word for its kind, seven at most. */
function closedLinked(linked: readonly TraceSpan[], parent: string): TraceSpan[] {
  const out: TraceSpan[] = [];
  for (const kid of linked) {
    if (out.length >= MAX_LINKED_STEPS_PER_REQUEST) break;
    const kind = sanitizeWorkKind(kid?.kind);
    const own = sanitizeSpanId(kid?.spanId);
    if (own === null || kind === null || kind !== kindOfLinkedWord(kid.routeLabel)) continue;
    if (!kid.traceId) continue;
    const durationMs = Math.max(0, Math.min(MAX_SPAN_DURATION_MS, Math.round(kid.durationMs || 0)));
    const row: TraceSpan = {
      traceId: kid.traceId,
      layer: "edge",
      routeLabel: kid.routeLabel,
      durationMs,
      startOffsetMs: Math.max(0, Math.min(MAX_SPAN_DURATION_MS, Math.round(kid.startOffsetMs || 0))),
      rating: rateSpanDuration(durationMs),
      spanId: own,
      parentSpanId: parent,
      kind,
    };
    const outcome = sanitizeOutcome(kid.outcome);
    if (outcome !== null) row.outcome = outcome;
    out.push(row);
  }
  return out;
}

/** Queue groups of linked steps whose step has been taken, oldest first; past
 *  the share the OLDEST group goes whole and is counted as dropped. `front`
 *  puts groups back ahead of the rest (an upload that failed). */
function pushReady(groups: TraceSpan[][], front = false): void {
  const kept = groups.filter((g) => g.length > 0);
  if (kept.length === 0) return;
  ready = front ? [...kept, ...ready] : [...ready, ...kept];
  while (readyLinkedCount() > MAX_BUFFERED_LINKED_STEPS && ready.length > 0) {
    dropped += ready.shift()!.length;
  }
}

/** Take whole groups of linked steps, oldest first, while they fit in `room`
 *  rows: one request's linked steps never straddle two uploads. */
export function takeReadyLinked(room: number): TraceSpan[] {
  const out: TraceSpan[] = [];
  while (ready.length > 0 && out.length + ready[0]!.length <= room) {
    out.push(...ready.shift()!);
  }
  return out;
}

/** Put linked steps from a failed upload back at the FRONT of their share. */
export function returnLinked(rows: readonly TraceSpan[]): void {
  if (rows.length > 0) pushReady([[...rows]], true);
}

/** Linked steps waiting in their own share (their step has been taken). */
export function readyLinkedCount(): number {
  let n = 0;
  for (const g of ready) n += g.length;
  return n;
}

/** Take up to `max` spans off the buffer for one upload. The linked steps of
 *  each span taken move to their own share, where `takeReadyLinked` finds
 *  them. */
export function drainSpans(max: number): TraceSpan[] {
  if (buffer.length === 0) return [];
  const out = buffer.slice(0, max);
  buffer = buffer.slice(out.length);
  const groups: TraceSpan[][] = [];
  for (const row of out) {
    const kids = beside.get(row);
    if (kids) {
      beside.delete(row);
      groups.push(kids);
    }
  }
  pushReady(groups);
  return out;
}

/** Put a failed batch back at the FRONT, oldest first, so a transport hiccup
 *  costs nothing. Anything that no longer fits is counted as dropped — the
 *  loss is reported, never hidden. */
export function returnSpans(batch: readonly TraceSpan[]): void {
  if (batch.length === 0) return;
  buffer = [...batch, ...buffer];
  while (buffer.length > MAX_BUFFERED_SPANS) {
    buffer.pop();
    dropped += 1;
  }
}

/** Spans recorded but not yet away: requests' own steps, and the linked steps
 *  whose own step has already been taken. */
export function pendingSpanCount(): number {
  return buffer.length + readyLinkedCount();
}

/** Linked steps held anywhere: beside their step, or in their own share. */
export function bufferedLinkedCount(): number {
  let n = readyLinkedCount();
  for (const row of buffer) n += beside.get(row)?.length ?? 0;
  return n;
}

/** Spans this isolate recorded and then lost to its own ceiling. */
export function droppedSpanCount(): number {
  return dropped;
}

export function discardSpans(count: number): void {
  dropped += count;
}

/** THE LOCK RULE (docs/kit-lock-rule.md): throw away every span and linked
 *  step this isolate holds. */
export function clearSpans(): void {
  buffer = [];
  dropped = 0;
  beside = new WeakMap();
  ready = [];
}

/** Test seam: reset the per-isolate state a real isolate gets for free. */
export function _resetSpansForTests(): void {
  clearSpans();
}
