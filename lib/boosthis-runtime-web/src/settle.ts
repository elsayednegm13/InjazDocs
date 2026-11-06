/**
 * Boosthis browser kit: the one settle-and-window rule for start-up-sensitive
 * meters (docs/settle-rule-contract.md). Every meter whose grade could be
 * decided by start-up work, a cold sample, a lifetime peak or a since-load
 * total goes through this module, and every reading taken under it carries the
 * marker `settleRule: 1`.
 *
 * How a browser reading meets the rule across documents
 * -----------------------------------------------------
 * A server process lives for hours; a page view rarely lives for a minute. So
 * the browser's "process" is the VISIT: the run of documents one visitor opens
 * on the site with no gap longer than {@link VISIT_GAP_MS}, held in the kit's
 * own consent-gated device store (`settle.v1`).
 *
 * - The settle clock starts at the visit's first document, and the snapshot's
 *   `startedAt` is that visit start, so the server's settle check reads the
 *   same age the kit judged by.
 * - A page load is start-up for its own document, so a page-load reading is one
 *   sample per document, pooled across the visit: the visit's first documents
 *   fall inside the settle period, the first load of each route is set-up, and
 *   a verdict waits for the family's sample floor. One document's load never
 *   decides a grade.
 * - Events inside a document (taps, long tasks, frames, requests) are judged on
 *   the visit clock and pooled across the visit's documents the same way, so a
 *   page that is replaced every twenty seconds is still judged, and judged on
 *   settled running only.
 * - Growth is judged inside one document only: a navigation frees the old
 *   document's memory and timers, so growth across documents is not growth.
 * - With the store closed (no consent, or no storage) the visit is the current
 *   document: its readings stay "still settling" or pending rather than guess.
 *
 * Pure arithmetic plus a small store. Never throws into the host page.
 */
import { storage } from "./storage";

export const SETTLE_RULE = 1 as const;

export type SettleFamily =
  | "latencyTail"
  | "growthSlope"
  | "peakRate"
  | "perRequestMemory"
  | "startupEvent";

export interface SettleFamilyRule {
  /** Nothing from the first this-many ms of the visit is judged. */
  settleMs: number;
  /** The shortest settled span a rate, peak or slope may be judged over. */
  spanMs: number;
  /** The first this-many samples of each route carry set-up. */
  first: number;
  /** The fewest settled samples a verdict may rest on. */
  samples: number;
}

/** The contract's table (checked against the server's SETTLE_FAMILIES by the
 *  kit's own test, so a number cannot move here alone). */
export const SETTLE_FAMILIES: Readonly<Record<SettleFamily, SettleFamilyRule>> = {
  latencyTail: { settleMs: 60_000, spanMs: 0, first: 1, samples: 20 },
  growthSlope: { settleMs: 600_000, spanMs: 600_000, first: 0, samples: 3 },
  peakRate: { settleMs: 60_000, spanMs: 300_000, first: 0, samples: 2 },
  perRequestMemory: { settleMs: 60_000, spanMs: 0, first: 20, samples: 20 },
  startupEvent: { settleMs: 120_000, spanMs: 0, first: 0, samples: 1 },
};

/** A visit ends after this long without a document of the site. */
export const VISIT_GAP_MS = 30 * 60_000;

const KEY = "settle.v1";
/** Documents kept per meter (newest first by start). */
const MAX_DOCS = 24;
/** Settled values one document contributes to a pooled tail (its newest). */
export const MAX_DOC_VALUES = 16;
const MAX_ROUTES = 64;

interface VisitState {
  v: 1;
  /** Visit start, epoch ms (the first document's time origin). */
  s: number;
  /** Last time a document of this visit was seen, epoch ms. */
  l: number;
  /** Route keys already loaded once in this visit. */
  r: string[];
  /** Per meter: one entry per document, [docId, ...numbers]. */
  m: Record<string, number[][]>;
}

let nowFn: () => number = () => Date.now();
let originFn: () => number = () => {
  try {
    if (typeof performance !== "undefined" && performance.timeOrigin) {
      return Math.round(performance.timeOrigin);
    }
  } catch {
    // fall through
  }
  return Date.now();
};

let state: VisitState | null = null;
/** This document's own entries, merged into the store on commit. */
const docEntries = new Map<string, number[]>();
/** Route keys this document asked about, and the answer it got. */
const docRoutes = new Map<string, boolean>();

function nowMs(): number {
  try {
    return nowFn();
  } catch {
    return Date.now();
  }
}

/**
 * The settle clock's reading, epoch ms: the instant a snapshot is taken at.
 * The snapshot reads its `now` here so every settle decision in one capture
 * (windows, edges, the visit ledger) runs on ONE clock; in a page it is
 * `Date.now()`.
 */
export function settleNow(): number {
  return nowMs();
}

/** This document's start (epoch ms). Also its id in the ledger. */
export function documentStartedAt(): number {
  try {
    return originFn();
  } catch {
    return Date.now();
  }
}

function parse(raw: string | null): VisitState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VisitState>;
    if (
      v &&
      v.v === 1 &&
      Number.isFinite(v.s) &&
      Number.isFinite(v.l) &&
      Array.isArray(v.r) &&
      v.m &&
      typeof v.m === "object"
    ) {
      return v as VisitState;
    }
  } catch {
    // unreadable: a new visit
  }
  return null;
}

function fresh(start: number): VisitState {
  return { v: 1, s: start, l: start, r: [], m: {} };
}

/** Does a stored visit continue into a document that started at `doc`? */
function continues(stored: VisitState | null, doc: number): stored is VisitState {
  return (
    stored !== null &&
    stored.s <= doc &&
    doc - stored.l <= VISIT_GAP_MS
  );
}

function visit(): VisitState {
  if (state) return state;
  const doc = documentStartedAt();
  let stored: VisitState | null = null;
  try {
    stored = parse(storage.get(KEY));
  } catch {
    stored = null;
  }
  state = continues(stored, doc) ? stored : fresh(doc);
  return state;
}

/** The visit's start, epoch ms: what the snapshot reports as `startedAt`. */
export function visitStartedAt(): number {
  try {
    return visit().s;
  } catch {
    return documentStartedAt();
  }
}

/** The first instant (epoch ms) whose samples a family may judge. */
export function settleBoundary(family: SettleFamily): number {
  return visitStartedAt() + SETTLE_FAMILIES[family].settleMs;
}

/** Has the visit passed the family's settle period at `atMs` (epoch)? */
export function isSettled(family: SettleFamily, atMs: number = nowMs()): boolean {
  return atMs >= settleBoundary(family);
}

/** Epoch ms of a time stamped on this document's performance clock. */
export function epochOf(perfMs: number): number {
  return documentStartedAt() + perfMs;
}

/** A still-settling (or not-yet-enough) reading: no score, no word. */
export function settling<T extends Record<string, unknown>>(
  extra?: T,
): { score: null; rating: "pending"; settleRule: 1 } & T {
  return { ...(extra ?? ({} as T)), score: null, rating: "pending", settleRule: SETTLE_RULE };
}

/** Stamp a reading taken under the rule. */
export function marked<T extends object>(reading: T): T & { settleRule: 1 } {
  return Object.assign(reading, { settleRule: SETTLE_RULE });
}

/**
 * Is this document the visit's first load of `routeKey`? Answered once per
 * document (stable across captures) and remembered for the visit.
 */
export function firstOfRoute(routeKey: string): boolean {
  const memo = docRoutes.get(routeKey);
  if (memo !== undefined) return memo;
  const v = visit();
  const first = !v.r.includes(routeKey);
  if (first) {
    v.r.push(routeKey);
    if (v.r.length > MAX_ROUTES) v.r.splice(0, v.r.length - MAX_ROUTES);
  }
  docRoutes.set(routeKey, first);
  return first;
}

/** Record this document's entry for a meter (replaces its earlier one). */
export function putDoc(meter: string, nums: number[]): void {
  docEntries.set(meter, nums.filter((n) => Number.isFinite(n)));
}

/** Every document's entry for a meter in this visit, this document's last. */
export function visitDocs(meter: string): number[][] {
  const doc = documentStartedAt();
  const out: number[][] = [];
  try {
    for (const e of visit().m[meter] ?? []) {
      if (Array.isArray(e) && e[0] !== doc) out.push(e.slice(1));
    }
  } catch {
    // a damaged entry is skipped
  }
  const mine = docEntries.get(meter);
  if (mine) out.push(mine);
  return out;
}

/** Nearest-rank percentile of `values` (0 < p ≤ 1); null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const rank = Math.min(v.length, Math.max(1, Math.ceil(p * v.length)));
  return v[rank - 1];
}

export interface SettledTail {
  /** Settled values pooled across the visit. */
  values: number[];
  /** True once the pool reaches the family's sample floor. */
  ready: boolean;
}

/**
 * A latency-style tail on settled samples only, pooled across the visit.
 * `samples` carry epoch-ms stamps; `cold` marks samples that are the first
 * of their route (set-up), which never count.
 */
export function settledTail(
  meter: string,
  family: SettleFamily,
  samples: ReadonlyArray<{ t: number; v: number; cold?: boolean }>,
  floor: number = SETTLE_FAMILIES[family].samples,
): SettledTail {
  const edge = settleBoundary(family);
  const mine: number[] = [];
  for (const s of samples) {
    if (s && Number.isFinite(s.t) && Number.isFinite(s.v) && s.t >= edge && !s.cold) mine.push(s.v);
  }
  // The store keeps each document's newest MAX_DOC_VALUES; this document's
  // own values all count while it is open.
  putDoc(meter, mine.slice(-MAX_DOC_VALUES));
  const values = [...visitDocs(meter).slice(0, -1).flat(), ...mine];
  return { values, ready: values.length >= Math.max(1, floor) };
}

export interface SettledRate {
  /** Settled observation time pooled across the visit, ms. */
  windowMs: number;
  /** Settled events pooled across the visit. */
  count: number;
  /** Events per minute over the pooled settled window (0 when no window). */
  perMin: number;
  /** True once the pooled window reaches the family's span. */
  ready: boolean;
}

/**
 * A rate (or count) of events on settled running only, pooled across the
 * visit: each document contributes its settled window and its settled events.
 */
export function settledRate(
  meter: string,
  family: SettleFamily,
  events: readonly number[],
  now: number = nowMs(),
  minSpanMs: number = SETTLE_FAMILIES[family].spanMs,
): SettledRate {
  const edge = settleBoundary(family);
  const from = Math.max(edge, documentStartedAt());
  const myWindow = Math.max(0, now - from);
  let myCount = 0;
  for (const t of events) if (Number.isFinite(t) && t >= edge && t <= now) myCount++;
  return pooledRate(meter, myWindow, myCount, now >= edge, minSpanMs);
}

function pooledRate(
  meter: string,
  myWindow: number,
  myCount: number,
  settledNow: boolean,
  minSpanMs: number,
): SettledRate {
  putDoc(meter, [myWindow, myCount]);
  let windowMs = 0;
  let count = 0;
  for (const e of visitDocs(meter)) {
    windowMs += Number(e[0]) || 0;
    count += Number(e[1]) || 0;
  }
  return {
    windowMs,
    count,
    perMin: windowMs > 0 ? (count / windowMs) * 60_000 : 0,
    ready: settledNow && windowMs > 0 && windowMs >= Math.max(1, minSpanMs),
  };
}

/**
 * The worst settled sample across the visit (each document keeps its count
 * and its worst), for meters whose quantity is a worst case by design.
 */
export function settledWorst(
  meter: string,
  family: SettleFamily,
  samples: ReadonlyArray<{ t: number; v: number; cold?: boolean }>,
  floor: number = SETTLE_FAMILIES[family].samples,
): { worst: number | null; count: number; ready: boolean } {
  const edge = settleBoundary(family);
  let worst = -Infinity;
  let n = 0;
  for (const s of samples) {
    if (s && s.t >= edge && !s.cold && Number.isFinite(s.v)) {
      n++;
      if (s.v > worst) worst = s.v;
    }
  }
  putDoc(meter, n > 0 ? [n, worst] : [0]);
  let count = 0;
  let w = -Infinity;
  for (const e of visitDocs(meter)) {
    count += Number(e[0]) || 0;
    if (e.length > 1 && Number(e[1]) > w) w = Number(e[1]);
  }
  return { worst: count > 0 ? w : null, count, ready: count >= Math.max(1, floor) };
}

/** Where this document's cumulative counters were re-anchored. */
const anchors = new Map<string, { at: number; base: number }>();

/**
 * A since-load counter re-anchored at the end of the settle period, so a
 * since-load total never decides a grade. A document that opened after the
 * settle period counts from its own start; one that opened inside it counts
 * from the first reading after the period ends. Pooled across the visit.
 */
export function settledCounter(
  meter: string,
  family: SettleFamily,
  cumulative: number,
  now: number = nowMs(),
  minSpanMs: number = SETTLE_FAMILIES[family].spanMs,
): SettledRate {
  const edge = settleBoundary(family);
  const total = Number.isFinite(cumulative) ? cumulative : 0;
  let a = anchors.get(meter);
  if (!a) {
    const doc = documentStartedAt();
    if (doc >= edge) a = { at: doc, base: 0 };
    else if (now >= edge) a = { at: now, base: total };
    if (a) anchors.set(meter, a);
  }
  const myWindow = a ? Math.max(0, now - a.at) : 0;
  const myCount = a ? Math.max(0, total - a.base) : 0;
  return pooledRate(meter, myWindow, myCount, now >= edge, minSpanMs);
}

/** A capped ring of stamped samples (epoch ms) for a tail meter. */
export class SampleRing {
  private readonly items: { t: number; v: number; cold?: boolean }[] = [];
  constructor(private readonly cap: number = 256) {}
  push(t: number, v: number, cold?: boolean): void {
    if (!Number.isFinite(t) || !Number.isFinite(v)) return;
    this.items.push(cold ? { t, v, cold } : { t, v });
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }
  all(): ReadonlyArray<{ t: number; v: number; cold?: boolean }> {
    return this.items;
  }
  clear(): void {
    this.items.length = 0;
  }
}

export interface SustainedGrowth {
  /** Growth per minute that persisted across the settled span (0 when it
   *  did not persist: a single step is never projected into a rate). */
  perMin: number;
  /** True once the settled span and sample floor are met. */
  ready: boolean;
}

/**
 * Growth that persists after settling, inside this document. The settled span
 * is cut into three equal-time parts; growth counts only when each part's mean
 * is above the one before (a one-time step lifts two parts, never all three),
 * and the rate is the outer parts' difference over their distance.
 */
export function sustainedGrowth(
  points: ReadonlyArray<{ t: number; v: number }>,
  now: number = nowMs(),
  family: SettleFamily = "growthSlope",
  minSpanMs: number = SETTLE_FAMILIES[family].spanMs,
): SustainedGrowth {
  const rule = { ...SETTLE_FAMILIES[family], spanMs: Math.max(SETTLE_FAMILIES[family].spanMs, minSpanMs) };
  const edge = settleBoundary(family);
  const p = points.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v) && x.t >= edge);
  if (p.length < Math.max(3, rule.samples)) return { perMin: 0, ready: false };
  const t0 = p[0].t;
  const t1 = p[p.length - 1].t;
  const span = t1 - t0;
  if (span < rule.spanMs || now < edge) return { perMin: 0, ready: false };
  const third = span / 3;
  const parts: { t: number; v: number }[][] = [[], [], []];
  for (const x of p) parts[Math.min(2, Math.floor((x.t - t0) / third))].push(x);
  if (parts.some((q) => q.length === 0)) return { perMin: 0, ready: false };
  const mean = (q: { t: number; v: number }[], k: "t" | "v") =>
    q.reduce((a, x) => a + x[k], 0) / q.length;
  const [a, b, c] = parts;
  const rising = mean(a, "v") < mean(b, "v") && mean(b, "v") < mean(c, "v");
  if (!rising) return { perMin: 0, ready: true };
  const dt = mean(c, "t") - mean(a, "t");
  const perMin = dt > 0 ? ((mean(c, "v") - mean(a, "v")) / dt) * 60_000 : 0;
  return { perMin: Math.max(0, perMin), ready: true };
}

/** Persist the visit (read-modify-write, so two open tabs of one visit keep
 *  each other's documents). Called once per snapshot. Never throws. */
export function commitSettle(now: number = nowMs()): void {
  try {
    const v = visit();
    const doc = documentStartedAt();
    const stored = parse(storage.get(KEY));
    const base = stored && stored.s === v.s ? stored : v;
    const routes = Array.from(new Set([...base.r, ...v.r])).slice(-MAX_ROUTES);
    const m: Record<string, number[][]> = { ...base.m };
    for (const [meter, nums] of docEntries) {
      const kept = (m[meter] ?? []).filter((e) => Array.isArray(e) && e[0] !== doc);
      kept.push([doc, ...nums]);
      kept.sort((x, y) => (x[0] as number) - (y[0] as number));
      m[meter] = kept.slice(-MAX_DOCS);
    }
    state = { v: 1, s: v.s, l: Math.max(base.l, now), r: routes, m };
    storage.set(KEY, JSON.stringify(state));
  } catch {
    // best effort: an unsaved visit only means later documents wait longer
  }
}

/** Test seam: a controlled clock and document start. */
export function _setSettleClockForTests(clock: { now?: () => number; origin?: () => number }): void {
  if (clock.now) nowFn = clock.now;
  if (clock.origin) originFn = clock.origin;
}

/** Test seam: forget the in-memory visit (a "new document"); the store stays. */
export function _newDocumentForTests(): void {
  state = null;
  docEntries.clear();
  docRoutes.clear();
  anchors.clear();
}

/** Drop measured baselines at a lock; never touch the site's own records. */
export function clearSettle(): void {
  _newDocumentForTests();
  storage.remove(KEY);
}

/** Test seam: back to the real clock and an empty in-memory state. */
export function _resetSettleForTests(): void {
  nowFn = () => Date.now();
  originFn = () => {
    try {
      if (typeof performance !== "undefined" && performance.timeOrigin) {
        return Math.round(performance.timeOrigin);
      }
    } catch {
      // fall through
    }
    return Date.now();
  };
  _newDocumentForTests();
}
