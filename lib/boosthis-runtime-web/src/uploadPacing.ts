/* ─── One upload schedule per browser ──────────────────────────────────────
 *
 * A website is ONE install: every tab, every reload and every teammate's page
 * uploads against the same allowance (50 measurement uploads a minute per
 * install, with crash reports kept apart, and 30 check-ins a minute). Before
 * this module none of the kit's pacing outlived a page: each reload checked
 * in again, sent a snapshot at once, restarted the first-minute ramp and sent
 * once more on close. Reloading every few seconds was enough to be told to
 * slow down (429), and the kit then filed that answer as a refused batch and
 * kept sending at its usual rate.
 *
 * This module keeps the pacing in ONE record in the kit's own storage, which
 * every tab of the browser shares and a reload keeps:
 *   • the PAUSE Boosthis asked for (a 429 and its Retry-After). Every path in
 *     every tab holds its data until the pause ends, then sends again without
 *     being told to. A pause is not a failure and is never counted as one;
 *   • when each kind of upload was last sent, and when the browser's SESSION
 *     began, so the first-minute ramp belongs to the browser, not each page;
 *   • the last check-in, so a quick run of reloads checks in once;
 *   • the server's snapshot hint and visit share (one install, many
 *     visitors: lib/snapshotPacing.ts on the server);
 *   • samples a closing page handed to the next send instead of sending.
 *
 * Where the record cannot be kept on the device — no storage, or the customer
 * holds device storage back (storage.ts answers from memory then) — every
 * function still works, per page: today's behaviour, never a failure. The
 * only thing that changes is that a closing page sends its own data rather
 * than handing it over, because a hand-over held in memory dies with the
 * page (see {@link mayHandOver}).
 *
 * docs/kit-upload-pacing.md has the counted requests this is paced against.
 */
import { storage } from "./storage";
import { kitTimeout } from "./zoneSafe";

/** The record's key in the kit's own storage (`forget()` removes it). */
export const PACE_KEY = "upload-pace:v1";

export type PaceKind =
  | "samples"
  | "snapshot"
  | "spans"
  | "crashes"
  | "candidates"
  | "resolutions"
  | "checkin"
  | "register";

const KINDS: readonly PaceKind[] = [
  "samples",
  "snapshot",
  "spans",
  "crashes",
  "candidates",
  "resolutions",
  "checkin",
  "register",
];

/** A 429 whose wait is missing or unreadable pauses this long — the length
 *  of the server's own limiter window. */
export const DEFAULT_PAUSE_MS = 60_000;
/** The shortest pause honoured (a past date or `0` still waits a moment). */
export const MIN_PAUSE_MS = 1_000;
/** The longest pause honoured, so a wild header cannot silence the kit for a
 *  day. Longer than any window the server's limiters use. */
export const MAX_PAUSE_MS = 15 * 60_000;
/** Tabs resume at a random moment within this long after the pause ends, so
 *  they do not all send in the same instant and meet the limit again. */
export const RESUME_SPREAD_MS = 2_000;
/** A page that loads within this long of the last activity of any page in
 *  this browser continues that browser's upload session (and its ramp). */
export const SESSION_GAP_MS = 5 * 60_000;
/** A check-in this browser made this recently is reused by a newly loaded
 *  page, which then checks in for itself once the answer is this old. */
export const CHECKIN_REUSE_MS = 15_000;
/** Samples handed over by a closing page wait this long for the next send;
 *  older ones are dropped and counted (samples carry no time of their own,
 *  so a late one would be filed under the moment it finally arrived). */
export const CARRY_MAX_AGE_MS = 10 * 60_000;
/** The most samples the hand-over holds (one upload's worth). */
export const CARRY_MAX_SAMPLES = 100;

interface PaceRecord {
  installId?: string;
  sessionStart?: number;
  lastActive?: number;
  last?: Partial<Record<PaceKind, number>>;
  pausedUntil?: number;
  pauseKind?: PaceKind;
  checkinAt?: number;
  nextSnapshotAt?: number;
  oneIn?: number;
  visit?: { session: number; oneIn: number; measured: boolean };
  carry?: { at: number; samples: unknown[] };
  dropped?: number;
}

let boundInstall: string | null = null;
const listeners = new Set<() => void>();
const resumeWaiters = new Set<() => void>();
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let random: () => number = Math.random;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isKind(v: unknown): v is PaceKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

function unref(t: unknown): void {
  try {
    (t as { unref?: () => void }).unref?.();
  } catch {
    /* a host timer without unref is fine */
  }
}

function read(): PaceRecord {
  try {
    const raw = storage.get(PACE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const rec = v as PaceRecord;
    // Another install's schedule says nothing about this one's allowance.
    if (boundInstall !== null && rec.installId !== undefined && rec.installId !== boundInstall) {
      return {};
    }
    return rec;
  } catch {
    return {};
  }
}

function write(rec: PaceRecord): void {
  try {
    if (boundInstall !== null) rec.installId = boundInstall;
    storage.set(PACE_KEY, JSON.stringify(rec));
  } catch {
    /* pacing must never disturb the host */
  }
}

function update<T>(fn: (rec: PaceRecord) => T): T {
  const rec = read();
  const out = fn(rec);
  write(rec);
  return out;
}

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a listener must never break pacing */
    }
  }
}

/** Re-read when anything here changes (the panel and status page). */
export function subscribeUploadPace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tie the record to the install it paces. A record written for another
 *  install is ignored (and replaced on the next write). */
export function bindPaceInstall(installId: string | null | undefined): void {
  boundInstall = typeof installId === "string" && installId ? installId : null;
}

/* ─── The pause Boosthis asked for ─────────────────────────────────────── */

/**
 * How long a 429 asks the kit to wait. Both standard forms of Retry-After are
 * read: a number of seconds, or an HTTP date. A missing or unreadable header
 * waits {@link DEFAULT_PAUSE_MS}; every answer is held within
 * [{@link MIN_PAUSE_MS}, {@link MAX_PAUSE_MS}].
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now(),
): number {
  const clamp = (ms: number): number =>
    Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, Math.round(ms)));
  if (typeof value !== "string") return DEFAULT_PAUSE_MS;
  const text = value.trim();
  if (/^\d+$/.test(text)) return clamp(Number(text) * 1000);
  // Every HTTP-date form names its day or month in letters; a bare "-5" or
  // "2.5" is neither form, however leniently Date.parse reads it.
  if (!/[A-Za-z]/.test(text)) return DEFAULT_PAUSE_MS;
  const at = Date.parse(text);
  if (Number.isFinite(at)) return clamp(at - now);
  return DEFAULT_PAUSE_MS;
}

/** Read the wait off a response (any object with Fetch-style headers). */
export function retryAfterOf(res: unknown): string | null {
  try {
    const headers = (res as { headers?: { get?: (n: string) => string | null } })
      ?.headers;
    const v = headers?.get?.("retry-after");
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Boosthis answered a request of `kind` with 429: hold every upload of this
 * install, in every tab, until the stated wait is over. Returns when the
 * pause ends. A shorter wait never shortens a pause already in force.
 */
export function holdForStatedWait(
  kind: PaceKind,
  retryAfter: string | null | undefined,
  now: number = Date.now(),
): number {
  const end = recordStatedWait(kind, retryAfter, now);
  armResume(end);
  return end;
}

/**
 * The same record, without this tab's resume timer: for a path that runs
 * only when the panel is drawn (the registration check), which holds no data
 * of its own. Every sender that does hold data waits through
 * {@link whenPauseEnds}, which keeps its own timer, so hiding the panel
 * changes nothing about when uploads resume.
 */
export function recordStatedWait(
  kind: PaceKind,
  retryAfter: string | null | undefined,
  now: number = Date.now(),
): number {
  const until = now + parseRetryAfterMs(retryAfter, now);
  const end = update((rec) => {
    const current = num(rec.pausedUntil);
    if (current === null || current < until) {
      rec.pausedUntil = until;
      rec.pauseKind = kind;
      return until;
    }
    return current;
  });
  emit();
  return end;
}

/** When the pause in force ends, or null when uploads may go now. */
export function pausedUntil(now: number = Date.now()): number | null {
  const until = num(read().pausedUntil);
  return until !== null && until > now ? until : null;
}

/** The pause in force and the kind of request that was asked to wait. */
export function getUploadPause(
  now: number = Date.now(),
): { until: number; kind: PaceKind } | null {
  const rec = read();
  const until = num(rec.pausedUntil);
  if (until === null || until <= now) return null;
  return { until, kind: isKind(rec.pauseKind) ? rec.pauseKind : "samples" };
}

/** Run `fn` once the pause has ended (in this tab). Several callers share
 *  one timer; each is run once. */
export function whenPauseEnds(fn: () => void): void {
  resumeWaiters.add(fn);
  armResume(pausedUntil() ?? Date.now());
}

function armResume(until: number): void {
  if (resumeTimer !== null) clearTimeout(resumeTimer);
  const delay =
    Math.max(0, until - Date.now()) + Math.round(random() * RESUME_SPREAD_MS);
  resumeTimer = kitTimeout(() => {
    resumeTimer = null;
    // Another tab may have been asked to wait longer meanwhile.
    const still = pausedUntil();
    if (still !== null) {
      armResume(still);
      return;
    }
    const waiting = [...resumeWaiters];
    resumeWaiters.clear();
    emit();
    for (const fn of waiting) {
      try {
        fn();
      } catch {
        /* one sender's resume must never stop another's */
      }
    }
  }, delay);
  unref(resumeTimer);
}

/* ─── The browser's session and each kind's last send ────────────────── */

/**
 * When this browser's upload session began — the anchor of the first-minute
 * ramp. A page that loads within {@link SESSION_GAP_MS} of the last activity
 * of any page in this browser continues that session; otherwise this page
 * starts one. Calling it counts as activity.
 */
export function sessionStartedAt(now: number = Date.now()): number {
  return update((rec) => {
    const start = num(rec.sessionStart);
    const active = num(rec.lastActive);
    if (start === null || active === null || now - active > SESSION_GAP_MS || start > now) {
      rec.sessionStart = now;
    }
    rec.lastActive = now;
    return rec.sessionStart as number;
  });
}

/** When any tab of this browser last sent an upload of `kind`. */
export function lastSentAt(kind: PaceKind): number | null {
  return num(read().last?.[kind]);
}

/** Stamp a send of `kind` (made by this tab, now). Stamped BEFORE the
 *  request leaves, so a page that is closing still leaves its stamp for the
 *  page that replaces it. Returns the stamp, for {@link unnoteSent}. */
export function noteSent(kind: PaceKind, now: number = Date.now()): number {
  update((rec) => {
    rec.last = { ...(rec.last ?? {}), [kind]: now };
    rec.lastActive = now;
  });
  return now;
}

/** Take a stamp back: the request it stood for never left the page (the kit
 *  answered itself — switched off, consent withheld, or a wait in force).
 *  Left alone when another tab has stamped since. */
export function unnoteSent(kind: PaceKind, stampedAt: number, previous: number | null): void {
  update((rec) => {
    if (num(rec.last?.[kind]) !== stampedAt) return;
    const last = { ...(rec.last ?? {}) };
    if (previous === null) delete last[kind];
    else last[kind] = previous;
    rec.last = last;
  });
}

/** The status text of the kit's OWN 429 — the answer it gives itself for a
 *  path that tried to send under a wait already in force. It restates the
 *  wait that remains; it is never a new wait. */
export const LOCAL_PAUSE_STATUS_TEXT = "Boosthis paused";

/** Whether `res` is that local answer rather than Boosthis's own 429. */
export function isLocalPauseAnswer(res: unknown): boolean {
  try {
    const r = res as { status?: unknown; statusText?: unknown };
    return r?.status === 429 && r?.statusText === LOCAL_PAUSE_STATUS_TEXT;
  } catch {
    return false;
  }
}

/**
 * Ask for the next send of `kind`: granted (and stamped) when no tab of this
 * browser sent one within `minGapMs`, otherwise refused with the moment it
 * would be granted. Always refused while a pause is in force.
 */
export function claimSend(
  kind: PaceKind,
  minGapMs: number,
  now: number = Date.now(),
): { ok: true } | { ok: false; at: number } {
  return update((rec) => {
    const until = num(rec.pausedUntil);
    if (until !== null && until > now) return { ok: false as const, at: until };
    const last = num(rec.last?.[kind]);
    if (last !== null && now - last < minGapMs && last <= now) {
      return { ok: false as const, at: last + minGapMs };
    }
    rec.last = { ...(rec.last ?? {}), [kind]: now };
    rec.lastActive = now;
    return { ok: true as const };
  });
}

/* ─── Check-ins ───────────────────────────────────────────────────────── */

/** When this browser last checked in, if within {@link CHECKIN_REUSE_MS}. */
export function recentCheckIn(now: number = Date.now()): number | null {
  const at = num(read().checkinAt);
  return at !== null && now - at >= 0 && now - at < CHECKIN_REUSE_MS ? at : null;
}

/** Stamp a check-in the server answered. */
export function recordCheckIn(now: number = Date.now()): void {
  update((rec) => {
    rec.checkinAt = now;
    rec.lastActive = now;
  });
}

/* ─── One install, many visitors ─────────────────────────────────────── */

/** The server says the next snapshot from this browser is useful in
 *  `inMs` (plus up to `spreadMs`, chosen at random, for a newly arrived page
 *  so a crowd's first snapshots do not all land together). */
export function recordSnapshotHint(
  inMs: unknown,
  spreadMs: unknown = 0,
  now: number = Date.now(),
): void {
  const wait = num(inMs);
  if (wait === null || wait <= 0) return;
  const spread = Math.max(0, num(spreadMs) ?? 0);
  const at = now + Math.min(wait + random() * spread, 60 * 60_000);
  update((rec) => {
    rec.nextSnapshotAt = Math.round(at);
  });
}

/** When the server last said the next snapshot is useful (or null). */
export function snapshotHintAt(): number | null {
  return num(read().nextSnapshotAt);
}

/** The share of visits the server asked to send samples and spans. */
export function recordVisitShare(oneIn: unknown): void {
  const n = num(oneIn);
  if (n === null || n < 1) return;
  const next = Math.min(1000, Math.round(n));
  const changed = update((rec) => {
    const was = num(rec.oneIn) ?? 1;
    rec.oneIn = next;
    return was !== next;
  });
  if (changed) {
    visitMemo = null;
    emit();
  }
}

/**
 * Whether this visit sends samples and spans. Every visit does while the
 * share is 1 in 1. Above it, each visit — this browser's session, shared by
 * its tabs and reloads — is chosen once at random with odds 1 in N, and
 * keeps that answer until the session ends or the share changes.
 */
export function visitMeasured(now: number = Date.now()): boolean {
  // Asked for every recorded sample and span, so a page remembers its answer
  // for VISIT_MEMO_MS rather than reading (and touching) the record each time.
  if (visitMemo !== null && now - visitMemo.at >= 0 && now - visitMemo.at < VISIT_MEMO_MS) {
    return visitMemo.measured;
  }
  const measured = decideVisit(now);
  visitMemo = { at: now, measured };
  return measured;
}

/** How long a page reuses its own answer to {@link visitMeasured}. */
const VISIT_MEMO_MS = 5_000;
let visitMemo: { at: number; measured: boolean } | null = null;

function decideVisit(now: number): boolean {
  const rec = read();
  const oneIn = num(rec.oneIn) ?? 1;
  if (oneIn <= 1) return true;
  const session = sessionStartedAt(now);
  const visit = rec.visit;
  if (visit && visit.session === session && visit.oneIn === oneIn) {
    return visit.measured === true;
  }
  const measured = random() < 1 / oneIn;
  update((r) => {
    r.visit = { session, oneIn, measured };
  });
  return measured;
}

/** The share of visits samples and spans come from right now (1 = every
 *  visit), for the panel and status page to state. */
export function visitShareOneIn(): number {
  const n = num(read().oneIn);
  return n === null || n < 1 ? 1 : n;
}

/** Whether this visit was chosen to send samples and spans under the share
 *  in force — read only, never deciding: null while every visit is measured
 *  or before this session's visit has been decided. */
export function visitDecision(): boolean | null {
  const rec = read();
  const oneIn = num(rec.oneIn) ?? 1;
  if (oneIn <= 1) return null;
  const visit = rec.visit;
  if (!visit || visit.oneIn !== oneIn || visit.session !== num(rec.sessionStart)) return null;
  return visit.measured === true;
}

/* ─── A closing page's samples ────────────────────────────────────────── */

/** Whether a closing page may hand its data to the next send: only when the
 *  record is really kept on the device, so the hand-over outlives the page. */
export function mayHandOver(): boolean {
  try {
    return storage.isPersistent();
  } catch {
    return false;
  }
}

/** Hand samples to the next send. Past {@link CARRY_MAX_SAMPLES} the oldest
 *  are dropped and counted. */
export function handOverSamples(samples: readonly unknown[], now: number = Date.now()): void {
  if (samples.length === 0) return;
  update((rec) => {
    const kept = rec.carry && Array.isArray(rec.carry.samples) ? rec.carry.samples : [];
    const at = num(rec.carry?.at) ?? now;
    const all = [...kept, ...samples];
    const over = Math.max(0, all.length - CARRY_MAX_SAMPLES);
    if (over > 0) rec.dropped = (num(rec.dropped) ?? 0) + over;
    rec.carry = { at, samples: all.slice(over) };
  });
  emit();
}

/** How many samples are waiting in the hand-over (a peek; takes nothing). */
export function handedOverCount(): number {
  const carry = read().carry;
  return carry && Array.isArray(carry.samples) ? carry.samples.length : 0;
}

/** Take the samples handed over (all of them, once). Ones older than
 *  {@link CARRY_MAX_AGE_MS} are dropped and counted instead. */
export function takeHandedOverSamples(now: number = Date.now()): unknown[] {
  const rec = read();
  if (!rec.carry) return [];
  const samples = Array.isArray(rec.carry.samples) ? rec.carry.samples : [];
  const at = num(rec.carry.at) ?? now;
  const stale = now - at > CARRY_MAX_AGE_MS;
  update((r) => {
    delete r.carry;
    if (stale && samples.length) r.dropped = (num(r.dropped) ?? 0) + samples.length;
  });
  if (stale && samples.length) emit();
  return stale ? [] : samples;
}

/** Put samples back at the head of the hand-over (a send was asked to wait). */
export function returnSamples(samples: readonly unknown[], now: number = Date.now()): void {
  if (samples.length === 0) return;
  update((rec) => {
    const kept = rec.carry && Array.isArray(rec.carry.samples) ? rec.carry.samples : [];
    const at = Math.min(num(rec.carry?.at) ?? now, now);
    const all = [...samples, ...kept];
    const over = Math.max(0, all.length - CARRY_MAX_SAMPLES);
    if (over > 0) rec.dropped = (num(rec.dropped) ?? 0) + over;
    rec.carry = { at, samples: all.slice(0, CARRY_MAX_SAMPLES) };
  });
  emit();
}

/* ─── What the kit itself had to drop ─────────────────────────────────── */

/** Count data the kit dropped itself while holding it (a buffer full during
 *  a pause, a hand-over too old to send). Never a server refusal. */
export function noteHeldDropped(count: number): void {
  if (!(count > 0)) return;
  update((rec) => {
    rec.dropped = (num(rec.dropped) ?? 0) + Math.round(count);
  });
  emit();
}

/** How many held items the kit has dropped itself (this browser). */
export function getHeldDroppedCount(): number {
  return Math.max(0, num(read().dropped) ?? 0);
}

/* ─── Erasing and tests ───────────────────────────────────────────────── */

/** Remove the record (`forget()`), and stop waiting on any pause. */
export function clearUploadPace(): void {
  try {
    storage.remove(PACE_KEY);
  } catch {
    /* erasure of a pacing record must never throw into the host */
  }
  if (resumeTimer !== null) clearTimeout(resumeTimer);
  resumeTimer = null;
  resumeWaiters.clear();
  visitMemo = null;
  emit();
}

export function _resetUploadPaceForTests(opts: { random?: () => number } = {}): void {
  clearUploadPace();
  boundInstall = null;
  listeners.clear();
  random = opts.random ?? Math.random;
}
