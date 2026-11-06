/** LINKED STEPS — each database call and each outside-service call made INSIDE
 *  one measured request, sent as a step of its own whose parent is that
 *  request's own step.
 *
 * They are what lets the project map draw a measured line on a project with a
 * single server: route → Database, route → payments. The database and
 * outside-service readings already see these calls inside the request, but
 * only TOTAL them across the isolate, so the map could show a Database box and
 * never which route reached it.
 *
 * Source of truth: `linkedSteps` in lib/span-wire-vocabulary.json (marker
 * BOOSTHIS_LINKED_STEPS_V1). Every sending kit carries a copy, and
 * scripts/src/__tests__/span-wire-field-parity.test.ts holds them to it.
 *
 * WHAT LEAVES: a kind (`db` or `http`), a timing, an outcome, and ONE word from
 * the closed list below. The word is decided by the reading that already
 * classified the call — "database" for a hosted database reached over fetch;
 * otherwise the outside-service reading's own group — and nothing about the
 * call itself is read here: never the statement, a table, a host, an address,
 * a path or a value.
 *
 * WHAT THIS KIT CAN SEE. The edge kit watches the isolate's fetch, so a call
 * through it is linked on its own. An AI provider's call is not linked: the AI
 * reading measures it. An isolate has no async-local storage, so a call is
 * linked only when it can be attributed at all: with exactly one request in
 * flight in this isolate. A call made while two requests are interleaved
 * belongs to neither, and is not linked to either.
 *
 * THE FOLD. Repeated calls of the same word inside one request are folded into
 * ONE step: it starts when the first of them started, lasts as long as at
 * least one of them was in flight, and its outcome is `error` when any of them
 * failed or timed out. So a request sends at most one step per word — seven at
 * most. A call that finishes after its request ended is not linked to it.
 *
 * Steps are sent only beside a request step that is itself sent: they wait
 * beside it in the span buffer (spanEmitter.ts) and go wherever it goes. The
 * queue and cron entry points (`boosthisEntryPoint`) already send an ordinary
 * step labelled `job:<kind>` — a word from a closed list, never a name the
 * developer wrote — and the calls made inside one run hang from that step.
 */

import { newSpanId, sanitizeSpanId } from "./spanScope";
import type { TraceSpan } from "./spanEmitter";
import { rateDuration } from "./version";

export const LINKED_STEPS_MARKER = "BOOSTHIS_LINKED_STEPS_V1";

/** The closed words, per kind. */
export const LINKED_DB_WORDS = ["database"] as const;
export const LINKED_HTTP_WORDS = [
  "signin",
  "storage",
  "payments",
  "messaging",
  "search",
  "other",
] as const;

export type LinkedWord =
  | (typeof LINKED_DB_WORDS)[number]
  | (typeof LINKED_HTTP_WORDS)[number];

/** At most one step per word per request, so seven by construction. */
export const MAX_LINKED_STEPS_PER_REQUEST = 7;

/** How many separate in-flight windows one word keeps before folding them
 *  together, so ten thousand queries cost what ten do. */
const MAX_WINDOWS_PER_WORD = 64;

/** The server's `durationMs` bound — the same clamp spanEmitter.ts applies. */
const MAX_SPAN_DURATION_MS = 600_000;

/** "db" or "http" for a closed word, else null. */
export function kindOfLinkedWord(word: unknown): "db" | "http" | null {
  if ((LINKED_DB_WORDS as readonly unknown[]).includes(word)) return "db";
  if ((LINKED_HTTP_WORDS as readonly unknown[]).includes(word)) return "http";
  return null;
}

interface WordFold {
  kind: "db" | "http";
  windows: Array<[number, number]>;
  failed: boolean;
}

/** One request's linked calls, folded by word. */
export interface LinkedScope {
  /** The zero every step's offset is measured from, on `nowMs()`. */
  openedAtMs: number;
  closed: boolean;
  words: Map<LinkedWord, WordFold>;
}

/** One folded step, before it becomes a wire span. */
export interface LinkedFold {
  kind: "db" | "http";
  word: LinkedWord;
  startMs: number;
  durationMs: number;
  failed: boolean;
}

export function openLinkedScope(openedAtMs: number): LinkedScope {
  return { openedAtMs, closed: false, words: new Map() };
}

/** File one finished call, timed on `nowMs()`. A closed scope takes nothing:
 *  the call was still in flight when its request answered. Never throws. */
export function noteLinkedCall(
  scope: LinkedScope | null | undefined,
  word: unknown,
  startMs: number,
  endMs: number,
  failed: boolean,
): void {
  try {
    if (!scope || scope.closed) return;
    const kind = kindOfLinkedWord(word);
    if (kind === null) return;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    const finish = Math.max(startMs, endMs);
    let fold = scope.words.get(word as LinkedWord);
    if (!fold) {
      fold = { kind, windows: [], failed: false };
      scope.words.set(word as LinkedWord, fold);
    }
    if (failed) fold.failed = true;
    if (fold.windows.length >= MAX_WINDOWS_PER_WORD) fold.windows = mergeWindows(fold.windows);
    if (fold.windows.length >= MAX_WINDOWS_PER_WORD) {
      // Still full of separate windows: widen the last one to cover this
      // call. The step can read slightly longer than the union, never shorter
      // than a call was in flight.
      const last = fold.windows[fold.windows.length - 1]!;
      last[0] = Math.min(last[0], startMs);
      last[1] = Math.max(last[1], finish);
    } else {
      fold.windows.push([startMs, finish]);
    }
  } catch {
    /* measurement never disturbs the worker */
  }
}

/** Close the scope and fold what it collected, once: one step per word,
 *  sorted by start (then word), seven at most. */
export function closeLinkedScope(scope: LinkedScope | null | undefined): LinkedFold[] {
  try {
    if (!scope || scope.closed) return [];
    scope.closed = true;
    const out: LinkedFold[] = [];
    for (const [word, fold] of scope.words) {
      const merged = mergeWindows(fold.windows);
      if (merged.length === 0) continue;
      let busy = 0;
      for (const [s, e] of merged) busy += e - s;
      out.push({
        kind: fold.kind,
        word,
        startMs: Math.max(0, merged[0]![0] - scope.openedAtMs),
        durationMs: busy,
        failed: fold.failed,
      });
    }
    scope.words = new Map();
    out.sort((a, b) => a.startMs - b.startMs || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    return out.slice(0, MAX_LINKED_STEPS_PER_REQUEST);
  } catch {
    return [];
  }
}

/** Folded steps as wire spans, each naming `parentSpanId` as its parent and
 *  starting `baseOffsetMs` plus its own offset in. Nothing without a valid
 *  parent: a linked step that names no request is not a linked step. */
export function linkedSpans(
  folds: readonly LinkedFold[],
  traceId: string,
  parentSpanId: string | null | undefined,
  baseOffsetMs: number,
): TraceSpan[] {
  try {
    const parent = sanitizeSpanId(parentSpanId);
    if (folds.length === 0 || parent === null || !traceId) return [];
    return folds.slice(0, MAX_LINKED_STEPS_PER_REQUEST).map((fold) => {
      const durationMs = clampMs(fold.durationMs);
      return {
        traceId,
        layer: "edge",
        routeLabel: fold.word,
        durationMs,
        startOffsetMs: clampMs((Number.isFinite(baseOffsetMs) ? baseOffsetMs : 0) + fold.startMs),
        rating: rateDuration(durationMs),
        spanId: newSpanId(),
        parentSpanId: parent,
        kind: fold.kind,
        outcome: fold.failed ? "error" : "ok",
      };
    });
  } catch {
    return [];
  }
}

/** Sorted, overlapping windows merged into their union. */
export function mergeWindows(windows: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [s, e] of [...windows].map((w) => [w[0], w[1]] as [number, number]).sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

function clampMs(ms: number): number {
  const n = Number.isFinite(ms) ? ms : 0;
  return Math.max(0, Math.min(MAX_SPAN_DURATION_MS, Math.round(n)));
}
