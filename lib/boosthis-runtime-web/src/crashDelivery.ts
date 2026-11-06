import { storage } from "./storage";
import type { CrashReportPayload } from "./crashReporter";
import { normalizeRouteLabel } from "./partName";
import { pausedUntil, whenPauseEnds } from "./uploadPacing";
import { kitTimeout } from "./zoneSafe";

export const CRASH_KEY = "crash-pending:v2";
const HISTORY_KEY = "crash-history:v1";
const DAY = 86400000;
const RETRIES = [5000, 30000, 120000, 600000, 1800000];
type Kept = CrashReportPayload & { firstAt: number };
export interface CrashBatch {
  deliveryId: string;
  installId: string;
  sealedAt: number;
  crashes: Kept[];
}
interface State { open: Kept[]; batches: CrashBatch[]; historyRun?: Run }
/** One run of the page. `ext` / `ntc` are the errors SET ASIDE in that run —
 *  extension-only errors and the browser's ResizeObserver notices — as
 *  [first moment, count] pairs, one pair per ten minutes at most, so a broken
 *  extension firing every frame costs a handful of pairs rather than a stored
 *  moment per frame. Counts only: nothing about which extension ever reaches
 *  this record (see pageErrorOrigin.ts). Pruned on the SAME 24-hour window as
 *  `crashes`, which is what lets a surface print them beside the crash count. */
interface Run { id: string; start: number; last: number; crashes: number[]; ext?: Array<[number, number]>; ntc?: Array<[number, number]> }
interface History { runs: Run[]; cappedAt?: number }
export type Delivery = (crashes: readonly CrashReportPayload[], batch: CrashBatch, keepalive: boolean) => Promise<number>;
let send: Delivery | null = null;
let identity: () => string = () => "";
let timer: ReturnType<typeof setTimeout> | undefined;
let step = 0;
let busy = false;
let runId = "";
let generation = 0;
let retryGeneration = 0;
/** What has been set aside since the last history write. Held in memory and
 *  folded into the run on the next write (any write: a crash, the minute
 *  touch, the page hiding) or within five seconds, so an extension erroring on
 *  every frame never turns into a storage write per frame on the host page. */
const asidePending = { ext: 0, ntc: 0 };
let asideTimer: ReturnType<typeof setTimeout> | undefined;
const ASIDE_FLUSH_MS = 5000;
const ASIDE_BUCKET_MS = 600000;
function addAside(list: Array<[number, number]> | undefined, now: number, n: number): Array<[number, number]> | undefined {
  if (n <= 0) return list;
  const out = list ? list.filter(p => Array.isArray(p) && p[0] >= now - DAY) : [];
  const last = out[out.length - 1];
  if (last && now - last[0] < ASIDE_BUCKET_MS) last[1] = Math.min(1_000_000, last[1] + n);
  else out.push([now, Math.min(1_000_000, n)]);
  return out;
}
function sumAside(list: Array<[number, number]> | undefined, cutoff: number): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const p of list) if (Array.isArray(p) && p[0] >= cutoff && Number.isFinite(p[1]) && p[1] > 0) n += Math.trunc(p[1]);
  return n;
}
/**
 * Count one error the reporter SET ASIDE instead of recording as a crash:
 * `"extension"` (every frame that names an address is an extension's) or
 * `"notice"` (the browser's ResizeObserver loop notice). Never throws.
 */
export function noteSetAside(reason: "extension" | "notice"): void {
  try {
    if (reason === "extension") asidePending.ext += 1;
    else asidePending.ntc += 1;
    if (asideTimer === undefined) {
      asideTimer = kitTimeout(() => {
        asideTimer = undefined;
        try { touchCrashHistory(false, true); } catch { /* guest storage */ }
      }, ASIDE_FLUSH_MS);
      const h = asideTimer as unknown as { unref?: () => void };
      if (typeof h.unref === "function") h.unref();
    }
  } catch { /* counting must never disturb the page */ }
}
const said = new Set<string>();

function say(reason: string, text: string): void {
  if (said.has(reason)) return;
  said.add(reason);
  try { console.warn(`[boosthis] ${text}`); } catch { /* guest console */ }
}
function write(key: string, value: unknown, captured = false): void {
  if (!storage.set(key, JSON.stringify(value)) && captured) {
    say("write-failed", "A crash was captured but could not be written to disk, so it will not survive this process. Check that the Boosthis state directory is writable.");
  }
}
function read(): State {
  try {
    const raw = storage.get(CRASH_KEY);
    if (raw) return JSON.parse(raw) as State;
    const old = JSON.parse(storage.get("crash-pending:v1") ?? "[]");
    const open: Kept[] = Array.isArray(old) ? old.filter(c => c.unsent > 0 && c.kind !== "render").map(c => ({
      signature: c.signature, errorName: c.errorName, kind: c.kind,
      redactedFrame: c.redactedFrame, occurrences: Math.min(c.unsent, 100000),
      countBucket: c.sessionTotal <= 1 ? "1" : c.sessionTotal <= 5 ? "2-5" : c.sessionTotal <= 20 ? "6-20" : c.sessionTotal <= 100 ? "21-100" : "100+",
      occurredAt: Math.trunc(c.lastSeen ?? Date.now()), firstAt: Math.trunc(c.lastSeen ?? Date.now()),
      ...(c.summary ? { summary: c.summary } : {}),
      ...(c.frames ? { frames: c.frames } : {}),
      ...(c.traceId ? { traceId: c.traceId } : {}),
      ...(c.spanId ? { spanId: c.spanId } : {}),
      ...(c.routeLabel ? (normalizeRouteLabel(c.routeLabel) ? { routeLabel: normalizeRouteLabel(c.routeLabel)! } : { partUnknown: "part-refused" }) : { partUnknown: ["no-part-open", "part-not-tracked", "part-refused"].includes(c.partUnknown) ? c.partUnknown : "part-not-tracked" }),
    })) : [];
    const state = { open, batches: [] };
    write(CRASH_KEY, state, open.length > 0);
    storage.remove("crash-pending:v1");
    return state;
  } catch { return { open: [], batches: [] }; }
}
function change(delta: (state: State) => void): State {
  const state = read();
  delta(state);
  write(CRASH_KEY, state, state.open.length > 0 || state.batches.length > 0);
  return state;
}
function randomId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function history(): History {
  try {
    const h: History = JSON.parse(storage.get(HISTORY_KEY) ?? '{"runs":[]}');
    // The crash write journals its run too. If the page died between the two
    // localStorage writes, the history key can recover without counting twice.
    const journal: Run | undefined = JSON.parse(storage.get(CRASH_KEY) ?? "{}").historyRun;
    if (journal && journal.last >= Date.now() - DAY) {
      const found = h.runs.find(r => r.id === journal.id);
      if (found && journal.last >= found.last && journal.crashes.length > found.crashes.length) Object.assign(found, journal);
      else if (!found && (h.runs.length < 32 || journal.last > Math.min(...h.runs.map(r => r.last)))) {
        h.runs.push(journal);
        h.runs.sort((a, b) => a.last - b.last);
        h.runs = h.runs.slice(-32);
      }
    }
    return h;
  }
  catch { return { runs: [] }; }
}
export function touchCrashHistory(crash = false, force = false, beforeWrite?: (run: Run) => void): void {
  if (!runId) runId = randomId();
  const now = Date.now();
  const h = history();
  h.runs = h.runs.filter(r => r.last >= now - DAY);
  let run = h.runs.find(r => r.id === runId);
  if (!run) { run = { id: runId, start: now, last: now, crashes: [] }; h.runs.push(run); }
  else if (!crash && !force && now - run.last < 60000) return;
  run.last = now;
  if (crash) run.crashes.push(now);
  run.crashes = run.crashes.filter(t => t >= now - DAY);
  const ext = addAside(run.ext, now, asidePending.ext);
  const ntc = addAside(run.ntc, now, asidePending.ntc);
  if (ext && ext.length > 0) run.ext = ext; else delete run.ext;
  if (ntc && ntc.length > 0) run.ntc = ntc; else delete run.ntc;
  asidePending.ext = 0; asidePending.ntc = 0;
  if (h.runs.length > 32) { h.runs = h.runs.slice(-32); h.cappedAt = now; }
  beforeWrite?.(run);
  storage.set(HISTORY_KEY, JSON.stringify(h));
}
export function crashHistory(): { crashes: number; windowMs: number; runsInWindow?: number; runsAtLeast?: boolean; setAsideExtension: number; setAsideNotice: number } {
  const cutoff = Date.now() - DAY;
  const h = history();
  const runs = h.runs.filter(r => r.last >= cutoff);
  return {
    crashes: runs.reduce((n, r) => n + r.crashes.filter(t => t >= cutoff).length, 0),
    // Set aside in the SAME window as `crashes` (to the nearest ten minutes),
    // plus whatever this page has set aside and not yet written down.
    setAsideExtension: runs.reduce((n, r) => n + sumAside(r.ext, cutoff), 0) + asidePending.ext,
    setAsideNotice: runs.reduce((n, r) => n + sumAside(r.ntc, cutoff), 0) + asidePending.ntc,
    windowMs: runs.reduce((n, r) => n + Math.max(0, r.last - Math.max(cutoff, r.start)), 0),
    ...(runs.length > 1 ? { runsInWindow: runs.length } : {}),
    ...(h.cappedAt && h.cappedAt >= cutoff ? { runsAtLeast: true } : {}),
  };
}
/** Preserve per-place and cause disagreements for the server's tallies. */
const MERGE_KEYS = ["signature", "routeLabel", "partUnknown", "mistake", "codeName", "codeNameState", "codeOwner", "codeService"] as const;
const sameReport = (a: CrashReportPayload, b: CrashReportPayload): boolean => MERGE_KEYS.every(k => a[k] === b[k]);
const keptBucket = (occurrences: number): string => occurrences <= 1 ? "1" : occurrences <= 5 ? "2-5" : occurrences <= 20 ? "6-20" : occurrences <= 100 ? "21-100" : "100+";
export function keepCrash(crash: CrashReportPayload): void {
  touchCrashHistory(true, true, run => change(s => {
    s.historyRun = run;
    const old = s.open.find(c => sameReport(c, crash));
    if (old) {
      const firstAt = old.firstAt;
      const occurrences = Math.min(100000, old.occurrences + 1);
      Object.assign(old, crash, { firstAt, occurrences, countBucket: occurrences <= 5 ? "2-5" : keptBucket(occurrences) });
    } else s.open.push({ ...crash, firstAt: crash.occurredAt! });
  }));
  restartCrashRetries();
  void offerCrashes();
}

/* ─── Errors the page caught ──────────────────────────────────────────
 *
 * An error the app's own code caught and handed to the kit (kind
 * `caughtByPage`) travels the SAME road as a crash — the kept list, the
 * sealed batches with their delivery id, the retry ladder, the pause — so it
 * is offered, refused and retried exactly as a crash is. Three things differ:
 *
 *   - it NEVER touches the crash history the crash-free reading counts: no
 *     moment is added to a run, so the crash-free reading cannot move;
 *   - it is merged in memory and written down at most once a second (and
 *     whenever the page hides), so an app that catches an error on every
 *     frame never costs the page a storage write per frame;
 *   - it is capped: at most MAX_CAUGHT_HELD distinct caught errors are held
 *     at once — in memory, kept, or sealed and not yet accepted. Past that, a
 *     NEW one is dropped; repeats of one still waiting in memory or in the
 *     kept list keep counting.
 */
const caughtPending: Kept[] = [];
/** Which waiting entry an error object was merged into, so a crash for the
 *  same object can take its caught occurrence back (see takeBackCaught). Holds
 *  no error alive and is never read for content. */
let caughtHeldFor: WeakMap<object, Kept> = new WeakMap();
let caughtTimer: ReturnType<typeof setTimeout> | undefined;
const CAUGHT_FLUSH_MS = 1000;
export const MAX_CAUGHT_HELD = 100;
const isCaught = (c: CrashReportPayload): boolean => c.kind === "caughtByPage";
function heldCaught(s: State): number {
  return s.open.filter(isCaught).length + s.batches.reduce((n, b) => n + b.crashes.filter(isCaught).length, 0);
}
function mergeCaught(list: Kept[], entry: Kept): Kept | undefined {
  const old = list.find(c => isCaught(c) && sameReport(c, entry));
  if (!old) return undefined;
  const firstAt = Math.min(old.firstAt, entry.firstAt);
  const occurrences = Math.min(100000, old.occurrences + entry.occurrences);
  Object.assign(old, entry, { firstAt, occurrences, countBucket: keptBucket(occurrences) });
  return old;
}
/**
 * Keep one error the page caught. `token` is the error object itself, used
 * by identity only. Never throws; never touches the crash history.
 */
export function keepCaught(caught: CrashReportPayload, token?: object): void {
  try {
    if (!isCaught(caught)) return;
    const entry: Kept = { ...caught, occurrences: 1, countBucket: "1", firstAt: caught.occurredAt! };
    let held = mergeCaught(caughtPending, entry);
    if (!held) {
      if (caughtPending.length >= MAX_CAUGHT_HELD) return;
      caughtPending.push(entry);
      held = entry;
    }
    if (token) caughtHeldFor.set(token, held);
    if (caughtTimer === undefined) {
      caughtTimer = kitTimeout(() => { caughtTimer = undefined; flushCaught(); }, CAUGHT_FLUSH_MS);
      (caughtTimer as unknown as { unref?: () => void }).unref?.();
    }
  } catch { /* keeping must never disturb the page */ }
}
/**
 * A crash arrived for an error object the app had ALSO handed over as caught
 * (Angular 20 passes the window's uncaught errors to its ErrorHandler; the
 * window's own event can reach the kit after it). One error is one report and
 * a crash outranks: the caught occurrence is taken back while it still waits
 * in memory. Returns whether one was.
 */
export function takeBackCaught(token: unknown): boolean {
  try {
    if (token === null || (typeof token !== "object" && typeof token !== "function")) return false;
    const held = caughtHeldFor.get(token);
    caughtHeldFor.delete(token);
    const i = held ? caughtPending.indexOf(held) : -1;
    if (!held || i < 0) return false;
    held.occurrences -= 1;
    if (held.occurrences <= 0) caughtPending.splice(i, 1);
    else held.countBucket = keptBucket(held.occurrences);
    return true;
  } catch { return false; }
}
/**
 * Write the caught errors waiting in memory into the kept list, then — unless
 * `offer` is false (the page is hiding or leaving, and the caller offers with
 * keepalive itself) — offer them. Never throws.
 */
export function flushCaught(offer = true): void {
  try {
    if (caughtTimer !== undefined) { clearTimeout(caughtTimer); caughtTimer = undefined; }
    if (!caughtPending.length) return;
    const waiting = caughtPending.splice(0);
    caughtHeldFor = new WeakMap();
    change(s => {
      let held = heldCaught(s);
      for (const entry of waiting) {
        if (mergeCaught(s.open, entry)) continue;
        if (held >= MAX_CAUGHT_HELD) continue;
        s.open.push(entry);
        held += 1;
      }
    });
    if (offer) {
      restartCrashRetries();
      void offerCrashes();
    }
  } catch { /* never disturb the host */ }
}
/** "1 crash occurrence", "3 caught errors", or both — the console's own count
 *  of what a message is about. A caught error is never called a crash. */
function heldWords(crashes: number, caught: number): string {
  const parts: string[] = [];
  if (crashes > 0 || caught === 0) parts.push(`${crashes} crash occurrence${crashes === 1 ? "" : "s"}`);
  if (caught > 0) parts.push(`${caught} caught error${caught === 1 ? "" : "s"}`);
  return parts.join(" and ");
}
function expire(): void {
  let count = 0;
  let caught = 0;
  let oldest = Infinity;
  const fresh = (c: Kept) => {
    if (c.occurredAt! >= Date.now() - 30 * DAY) return true;
    if (isCaught(c)) caught += c.occurrences;
    else count += c.occurrences;
    oldest = Math.min(oldest, c.occurredAt!);
    return false;
  };
  change(s => {
    s.open = s.open.filter(fresh);
    s.batches = s.batches.filter(b => {
      b.crashes = b.crashes.filter(fresh);
      return b.crashes.length > 0;
    });
  });
  if (count) {
    const day = new Date(oldest).toISOString().slice(0, 10);
    say("expired", count === 1
      ? `1 crash occurrence this app kept was older than the 30 days Boosthis keeps crash receipts for, so it was not sent and has been removed. It happened on ${day}.`
      : `${count} crash occurrences this app kept were older than the 30 days Boosthis keeps crash receipts for, so they were not sent and have been removed. The oldest happened on ${day}.`);
  } else if (caught) {
    const day = new Date(oldest).toISOString().slice(0, 10);
    say("expired", `${caught} caught error${caught === 1 ? "" : "s"} this app kept ${caught === 1 ? "was" : "were"} older than the 30 days Boosthis keeps error receipts for, so ${caught === 1 ? "it was" : "they were"} not sent and ${caught === 1 ? "has" : "have"} been removed. The oldest happened on ${day}.`);
  }
}
/**
 * Say once, per reason, that Boosthis did not accept what was offered.
 * `count` is crash occurrences; `caught` is errors the page caught, which are
 * never called crashes and never make the crash count "lower than the truth".
 */
export function crashRefusal(status: number, count: number, caught = 0): void {
  if (status === 429) { crashesPaused(count, caught); return; }
  const reason = status <= 0 ? "unreachable" : status === 404 ? "not-registered" : status === 401 || status === 403 ? "credential-refused" : [400, 413, 422].includes(status) ? "rejected" : status >= 500 ? "server-error" : "unknown";
  const text = { unreachable: "Boosthis could not be reached", "not-registered": "this install is not registered with Boosthis", "credential-refused": "this install's credential was refused", rejected: "Boosthis rejected the report", "server-error": "Boosthis answered with an error", unknown: "Boosthis did not accept it and gave no reason we recognise" }[reason];
  const after = count > 0 || caught === 0
    ? "until they are accepted this project's crash count is lower than the truth."
    : "until they are accepted they are missing from this project's page.";
  say(reason, `Boosthis did not accept ${heldWords(count, caught)} this app reported: ${text}. They are still held and will be offered again; ${after}`);
}
/** ASKED TO WAIT, NOT REFUSED. Boosthis answered 429 — this install has used
 *  its allowance for the moment and said how long to wait. Nothing was judged:
 *  the batches stay held with their delivery id and each crash's own time, so
 *  the wait never moves a crash to another day or counts it twice, and they
 *  are offered again by themselves the moment the wait is over. */
function crashesPaused(count: number, caught = 0): void {
  const until = pausedUntil();
  const end = until === null ? "shortly" : `at ${new Date(until).toLocaleTimeString()}`;
  const held = caught > 0
    ? `${heldWords(count, caught)} are`
    : `${count} crash occurrence${count === 1 ? " is" : "s are"}`;
  say("paused", `Boosthis asked this install to wait before sending more, so ${held} held and will be sent when the pause ends (${end}). This is a pause Boosthis asked for, not a refusal: nothing was lost.`);
  whenPauseEnds(offerAfterPause);
}
/** Occurrences in a list: the caught errors' (`caught`) or everything else's. */
function occurrencesOf(list: readonly CrashReportPayload[], caught: boolean): number {
  return list.reduce((n, c) => (isCaught(c) === caught ? n + c.occurrences : n), 0);
}
/** One stable reference, so a page waiting out a pause offers its crashes once. */
const offerAfterPause = (): void => { void offerCrashes(); };
export async function offerCrashes(keepalive = false): Promise<void> {
  if (busy && !keepalive) return;
  const started = generation;
  busy = true;
  try {
    expire();
    if (!send || !identity()) return;
    // Under a wait Boosthis stated (from any tab), nothing is offered: the
    // crashes stay held on the device and go out once the wait is over.
    if (pausedUntil() !== null) { whenPauseEnds(offerAfterPause); return; }
    change(s => {
      while (s.open.length) {
        // Small batches leave room for opt-in frames under keepalive's 64 KB.
        const crashes: Kept[] = [];
        while (s.open.length && crashes.length < 50 && JSON.stringify([...crashes, s.open[0]]).length < 14000) crashes.push(s.open.shift()!);
        if (!crashes.length) crashes.push(s.open.shift()!);
        s.batches.push({ deliveryId: randomId(), installId: identity(), sealedAt: Date.now(), crashes });
      }
    });
    for (const batch of read().batches) {
      if (batch.installId !== identity()) { crashRefusal(401, occurrencesOf(batch.crashes, false), occurrencesOf(batch.crashes, true)); continue; }
      const wire = batch.crashes.map(({ firstAt: _first, ...c }) => c);
      let status = 0;
      try { status = await send(wire, batch, keepalive); } catch { /* held */ }
      if (started !== generation) return;
      if (status >= 200 && status < 300) change(s => { s.batches = s.batches.filter(b => b.deliveryId !== batch.deliveryId); });
      else if (status === 429) {
        const all = read().batches.flatMap(b => b.crashes);
        crashesPaused(occurrencesOf(all, false), occurrencesOf(all, true));
        break;
      }
      else {
        crashRefusal(status, occurrencesOf(wire, false), occurrencesOf(wire, true));
        if (status === 0) break;
      }
    }
  } catch { /* never disturb the host */ }
  finally { if (started === generation) busy = false; }
}
export function restartCrashRetries(): void {
  if (timer) clearTimeout(timer);
  const retries = ++retryGeneration;
  step = 0;
  const next = () => {
    if (retries !== retryGeneration) return;
    const pending = read();
    if (!pending.open.length && !pending.batches.length) { timer = undefined; return; }
    const delay = RETRIES[Math.min(step++, RETRIES.length - 1)];
    timer = kitTimeout(() => {
      timer = undefined;
      void offerCrashes().catch(() => {}).finally(next);
    }, delay);
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  next();
}
export function configureCrashDelivery(submitter: Delivery | null, installId?: () => string): void {
  send = submitter;
  if (installId) identity = installId;
  if (send) void offerCrashes();
}
export function resetCrashDelivery(erase = false): void {
  generation++;
  retryGeneration++;
  if (timer) clearTimeout(timer);
  timer = undefined; busy = false; runId = ""; send = null; identity = () => ""; said.clear();
  if (asideTimer) clearTimeout(asideTimer);
  asideTimer = undefined; asidePending.ext = 0; asidePending.ntc = 0;
  if (caughtTimer) clearTimeout(caughtTimer);
  caughtTimer = undefined; caughtPending.length = 0; caughtHeldFor = new WeakMap();
  if (erase) { storage.remove(CRASH_KEY); storage.remove("crash-pending:v1"); storage.remove(HISTORY_KEY); }
}