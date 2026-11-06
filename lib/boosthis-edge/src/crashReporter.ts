/** Privacy-safe crash capture for edge isolates.
 *
 * There is no process-wide error hook here: the handler wrapper is the only
 * boundary at which an unhandled host error can be observed. Pending reports
 * live only in this isolate's memory. If the isolate is evicted before its
 * after-response flush runs, they are necessarily lost; there is no disk on
 * which to pretend they were persisted.
 */

import { checkNoPII } from "./no-pii";
import { MAX_PART_NAME, normalizePath } from "./routeLabel";
import { safe, safeVoid } from "./safe";

const MAX_CRASHES = 200;
const MAX_BATCH = 50;
const MAX_OCCURRENCES = 100000;
const MAX_FRAMES = 20;

export type CrashKind = "uncaught" | "unhandledRejection" | "render" | "job";

export interface CrashFrameData {
  func: string;
  file: string;
  line?: number;
  column?: number;
}

export interface CrashReportPayload {
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  countBucket: string;
  occurrences: number;
  occurredAt: number;
  routeLabel?: string;
  partUnknown?: "no-part-open" | "part-not-tracked" | "part-refused";
  frames?: CrashFrameData[];
  /** WHICH ACTION was underway when this crashed. Both optional, and absence
   *  is a real answer — "no action recorded" — never a guess at whichever
   *  request happened to be nearby. See the note on `reportUnhandledError`. */
  traceId?: string;
  spanId?: string;
}

interface CrashEntry {
  signature: string;
  errorName: string;
  kind: CrashKind;
  redactedFrame: string;
  frames?: CrashFrameData[];
  sessionTotal: number;
  unsent: number;
  lastSeen: number;
  routeLabel?: string;
  partUnknown?: "no-part-open" | "part-not-tracked" | "part-refused";
  traceId?: string;
  spanId?: string;
}

const pending = new Map<string, CrashEntry>();
interface SealedBatch {
  deliveryId: string;
  crashes: CrashReportPayload[];
  retryStep: number;
  nextAt: number;
}
let sealed: SealedBatch[] = [];
const RETRY_LADDER_MS = [5000, 30000, 120000, 600000, 1800000];

function deliveryId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// BOOSTHIS_FAILURE_PART_V1: the label comes only from the failing request's
// local action, never an isolate-wide "last request".
function failurePart(action?: { routeLabel?: string | null }): {
  routeLabel?: string;
  partUnknown?: "no-part-open" | "part-not-tracked" | "part-refused";
} {
  if (!action || action.routeLabel === undefined) return { partUnknown: "part-not-tracked" };
  if (action.routeLabel === null) return { partUnknown: "part-refused" };
  const match = action.routeLabel.match(/^([A-Z]{1,10}) (\/.*)$/);
  if (!match || action.routeLabel.length > MAX_PART_NAME ||
      normalizePath(match[2]!) !== match[2] ||
      checkNoPII(action.routeLabel) !== null) return { partUnknown: "part-refused" };
  return { routeLabel: action.routeLabel };
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function bucketCount(n: number): string {
  if (n <= 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  if (n <= 100) return "21-100";
  return "100+";
}

function toError(error: unknown): { name: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, stack: error.stack };
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; stack?: unknown };
    return {
      name: typeof value.name === "string" ? value.name : "Error",
      stack: typeof value.stack === "string" ? value.stack : undefined,
    };
  }
  return { name: "Error" };
}

function sanitizeErrorName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "").slice(0, 80);
  return cleaned.length > 0 ? cleaned : "Error";
}

function fileBasename(raw: string): string {
  let value = raw;
  const suffix = value.search(/[?#]/);
  if (suffix >= 0) value = value.slice(0, suffix);
  const parts = value.split(/[\\/]/);
  value = (parts[parts.length - 1] ?? "").trim().slice(0, 120);
  return value.length > 0 ? value : "<unknown>";
}

function clampInt(raw: string): number | undefined {
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(value, 100_000_000);
}

/** Parse V8 and JSC stack formats. Paths become basenames before they can be
 * retained, and every detailed frame gets one final pass through the kit-wide
 * no-PII screen. */
export function parseStack(stack: string | undefined): CrashFrameData[] {
  if (!stack || typeof stack !== "string") return [];
  const frames: CrashFrameData[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let func = "<anonymous>";
    let location = "";
    const v8 = line.match(/^at\s+(.*?)\s+\((.*)\)$/);
    if (v8) {
      func = v8[1] ?? "<anonymous>";
      location = v8[2] ?? "";
    } else {
      const v8NoFunc = line.match(/^at\s+(.*)$/);
      // Requiring a trailing source coordinate prevents an email address in
      // the Error header from being mistaken for Safari's `func@file:line`.
      const jsc = line.match(/^(.*?)@(.*:\d+(?::\d+)?)$/);
      if (v8NoFunc) location = v8NoFunc[1] ?? "";
      else if (jsc) {
        func = jsc[1] && jsc[1].length > 0 ? jsc[1] : "<anonymous>";
        location = jsc[2] ?? "";
      } else continue;
    }

    let file = location;
    let lineNo: number | undefined;
    let column: number | undefined;
    const match =
      location.match(/^(.*):(\d+):(\d+)$/) ?? location.match(/^(.*):(\d+)$/);
    if (match) {
      file = match[1] ?? location;
      lineNo = clampInt(match[2]!);
      column = match[3] === undefined ? undefined : clampInt(match[3]);
    }
    func = func.replace(/[^A-Za-z0-9_$.<>\s]/g, "").trim().slice(0, 120);
    if (!func) func = "<anonymous>";
    const frame: CrashFrameData = { func, file: fileBasename(file) };
    if (lineNo !== undefined && lineNo > 0) frame.line = lineNo;
    if (column !== undefined) frame.column = column;
    if (checkNoPII(frame) === null) frames.push(frame);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

function safeRedactedFrame(top: CrashFrameData | undefined): string {
  if (!top) return "<unknown>";
  const line = top.line !== undefined ? `:${top.line}` : "";
  const candidate = `${top.func} (${top.file}${line})`.slice(0, 160);
  return checkNoPII(candidate) === null ? candidate : "<unknown>";
}

function evictIfNeeded(): void {
  if (pending.size <= MAX_CRASHES) return;
  const oldest = [...pending.values()].sort((a, b) => a.lastSeen - b.lastSeen);
  for (const entry of oldest) {
    if (pending.size <= MAX_CRASHES) break;
    if (entry.unsent <= 0) pending.delete(entry.signature);
  }
  for (const entry of oldest) {
    if (pending.size <= MAX_CRASHES) break;
    pending.delete(entry.signature);
  }
}

/** Record the handler error synchronously, before the isolate's freeze
 * boundary. Fully guarded: reporter failure can never replace the host error.
 *
 * `action` names the request that was underway, and is HANDED IN rather than
 * read from an ambient scope. That is not a style choice: one isolate serves
 * many requests concurrently on a single thread, so an ambient "most recent
 * action" would attach this crash to another visitor's request as confidently
 * as to the right one. The wrapper is on the throwing stack and holds the
 * request's identity in a local, so it can say which one for certain — and
 * where it cannot, it passes nothing and the crash honestly records no action.
 *
 * A repeat occurrence never overwrites the action already stored. The first
 * sighting is the one whose action we are sure of; a later one that cannot
 * name an action must not blank it, and a later one from a DIFFERENT request
 * must not claim the signature. */
export function reportUnhandledError(
  error: unknown,
  detailed = false,
  action?: { traceId?: string | null; spanId?: string | null; routeLabel?: string | null },
): void {
  safeVoid(() => {
    const err = toError(error);
    const errorName = sanitizeErrorName(err.name);
    const parsed = parseStack(err.stack);
    const redactedFrame = safeRedactedFrame(parsed[0]);
    // The raw error message is deliberately absent even from the hash basis.
    const basis =
      redactedFrame !== "<unknown>"
        ? redactedFrame
        : `${errorName}|uncaught|<no-frame>`;
    const signature = `${errorName}:${hash(basis)}`.slice(0, 120);
    const traceId = typeof action?.traceId === "string" ? action.traceId : undefined;
    const spanId = typeof action?.spanId === "string" ? action.spanId : undefined;
    const part = failurePart(action);
    const occurredAt = Date.now();
    const existing = pending.get(signature);
    if (existing) {
      existing.sessionTotal = Math.min(existing.sessionTotal + 1, MAX_OCCURRENCES);
      existing.unsent = Math.min(existing.unsent + 1, MAX_OCCURRENCES);
      existing.lastSeen = occurredAt;
      if (detailed && parsed.length > 0) existing.frames = parsed;
      // Deliberately NOT overwritten. The action stored is the one from the
      // first sighting, which is the occurrence we are sure of; a later
      // occurrence belongs to a different request and would point the reader
      // at the wrong one. See the note on this function.
      return;
    }
    pending.set(signature, {
      signature,
      errorName,
      kind: "uncaught",
      redactedFrame,
      ...(detailed && parsed.length > 0 ? { frames: parsed } : {}),
      sessionTotal: 1,
      unsent: 1,
      lastSeen: occurredAt,
      ...part,
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
    });
    evictIfNeeded();
  });
}

/** Snapshot at most one server-sized batch. New occurrences arriving while a
 * send is in flight remain pending because acknowledgeCrashes subtracts only
 * the transmitted delta. */
export function pendingCrashes(): CrashReportPayload[] {
  return safe(() => {
    const batch: CrashReportPayload[] = [];
    for (const entry of pending.values()) {
      if (entry.unsent <= 0) continue;
      const item: CrashReportPayload = {
        signature: entry.signature,
        errorName: entry.errorName,
        kind: entry.kind,
        redactedFrame: entry.redactedFrame,
        countBucket: bucketCount(entry.sessionTotal),
        occurrences: Math.min(entry.unsent, MAX_OCCURRENCES),
        occurredAt: entry.lastSeen,
      };
      if (entry.routeLabel) item.routeLabel = entry.routeLabel;
      else item.partUnknown = entry.partUnknown ?? "part-not-tracked";
      if (entry.frames) item.frames = entry.frames;
      // Conditional, both halves: a crash with no action recorded sends
      // neither key, and the server stores absence rather than a blank.
      if (entry.traceId) item.traceId = entry.traceId;
      if (entry.spanId) item.spanId = entry.spanId;
      batch.push(item);
      if (batch.length >= MAX_BATCH) break;
    }
    return batch;
  }, []);
}

/** An in-memory sealed batch keeps its id and contents across refused uploads.
 * New occurrences remain open for the next batch, rather than mutating this one. */
export function pendingCrashBatch(): { deliveryId: string; crashes: CrashReportPayload[] } | null {
  return safe(() => {
    if (sealed.length > 0) return sealed[0]!;
    return sealNext();
  }, null);
}

function sealNext(): SealedBatch | null {
  const crashes = pendingCrashes();
  if (crashes.length === 0) return null;
  const id = deliveryId();
  const batch = { deliveryId: id, crashes, retryStep: 0, nextAt: 0 };
  sealed.push(batch);
  for (const crash of crashes) {
    const entry = pending.get(crash.signature);
    if (entry) entry.unsent = Math.max(0, entry.unsent - crash.occurrences);
  }
  return batch;
}

/** Invocations replace a background timer in an isolate. Due batches remain
 * eligible forever; the final rung repeats on later after-response passes. */
export function dueCrashBatches(now = Date.now()): SealedBatch[] {
  return safe(() => {
    while (sealed.length < Math.ceil(MAX_CRASHES / MAX_BATCH) && sealNext()) { /* bounded */ }
    return sealed.filter((batch) => batch.nextAt <= now);
  }, []);
}

export function retryCrashBatch(batch: SealedBatch, now = Date.now()): void {
  batch.nextAt = now + RETRY_LADDER_MS[Math.min(batch.retryStep, RETRY_LADDER_MS.length - 1)]!;
  batch.retryStep += 1;
}

export function acknowledgeCrashes(batch: readonly CrashReportPayload[]): void {
  safeVoid(() => {
    sealed = sealed.filter((entry) => entry.crashes !== batch);
  });
}

export function pendingCrashCount(): number {
  return safe(() => pendingCrashes().length + sealed.reduce((n, batch) => n + batch.crashes.length, 0), 0);
}

/** THE LOCK RULE (docs/kit-lock-rule.md): throw away every crash this isolate
 *  holds, the sealed batches included — they are never sent. */
export function clearCrashes(): void {
  safeVoid(() => { pending.clear(); sealed = []; });
}

export function _resetCrashesForTests(): void {
  clearCrashes();
}

export const _crashInternals = {
  MAX_CRASHES,
  MAX_BATCH,
  MAX_FRAMES,
  pendingSize: () => pending.size,
  getPending: () => [...pending.values()].map((entry) => ({ ...entry })),
};