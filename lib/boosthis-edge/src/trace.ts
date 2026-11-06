/** Full-stack trace tag — the correlation id that stitches one user action
 * across every Boosthis runtime, read at the edge of the system.
 *
 * BYTE-IDENTICAL CONTRACT. The header names, the id format, the elapsed bound
 * and the sanitize-on-receive rules below are the same ones the Node, Web and
 * React Native kits carry. They are duplicated rather than imported because
 * this package has zero runtime dependencies and must load in a V8 isolate
 * with no bundler help and no Node built-ins.
 *
 * WHY THIS RUNTIME MATTERS MOST. An edge worker usually sits in FRONT of the
 * app: it is the first hop a request touches, and often the only one that ever
 * sees the caller's own trace header. A kit that mints a fresh id here instead
 * of adopting the one it was handed does not merely lose a span — it cuts the
 * chain at the exact point the request entered the system, and every hop below
 * it is filed under a trace nobody else knows about.
 *
 * PRIVACY CONTRACT (verified against no-pii.ts):
 *  - The id is exactly 32 lowercase hex chars (128 random bits). Pure hex
 *    cannot match the PII guard's email/JWT/bearer/IPv4/IPv6/phone value
 *    patterns, and the field key `traceId` tokenizes to ["trace","id"], neither
 *    of which is denied.
 *  - It is random, ephemeral, and NEVER derived from user data.
 *
 * ⚠️  A trace id must NEVER be used as (or embedded in) a route label.
 */

import { adoptParentSpanId, PARENT_HEADER } from "./spanScope";
import { safe } from "./safe";

/** Canonical lowercase header name carried on every instrumented request. */
export const TRACE_HEADER = "x-boosthis-trace";

/** A valid trace id is exactly 32 lowercase hex characters (128 bits). */
export const TRACE_ID_RE = /^[0-9a-f]{32}$/;

/** True if `id` matches the locked trace-id format exactly. */
export function isValidTraceId(id: unknown): id is string {
  return typeof id === "string" && TRACE_ID_RE.test(id);
}

/** Mint a fresh 32-hex-char trace id.
 *
 * Uses the platform CSPRNG (`globalThis.crypto.getRandomValues`, present in
 * workerd, Deno and every hosted edge runtime) when available, falling back to
 * `Math.random`. The fallback is acceptable because the id is a CORRELATION
 * TAG, not an authenticator — it never gates access or proves identity, so
 * weaker randomness only risks a vanishingly rare collision between two
 * concurrent traces, never a security bypass. */
export function newTraceId(): string {
  const g = globalThis as unknown as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  const getRandomValues = g.crypto?.getRandomValues;
  if (typeof getRandomValues === "function") {
    try {
      const bytes = new Uint8Array(16);
      getRandomValues.call(g.crypto, bytes);
      let out = "";
      for (let i = 0; i < bytes.length; i++) {
        out += bytes[i]!.toString(16).padStart(2, "0");
      }
      return out;
    } catch {
      // fall through to Math.random below
    }
  }
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** Adopt-or-mint: return `id` unchanged if it is a valid trace id, otherwise
 * mint a fresh one. This is the sanitize-on-receive trust boundary — a caller
 * can never smuggle PII (or a CRLF header-injection payload) through the trace
 * header, because anything not matching `^[0-9a-f]{32}$` is discarded. */
export function sanitizeTraceId(id: unknown): string {
  return isValidTraceId(id) ? id : newTraceId();
}

/* ─── Elapsed chain (waterfall offsets) ──────────────────────────────────────
 * A companion header carrying a RELATIVE elapsed-ms integer: how long after the
 * trace root STARTED this hop was reached. This is what lets the server place
 * each span in the waterfall WITHOUT any absolute client timestamp and WITHOUT
 * comparing clocks across machines. A bounded non-negative integer carries no
 * PII, so the sanitize-on-receive rule is simply "parse a small int, else 0" —
 * and, unlike the id, a malformed elapsed only degrades the OFFSET; it never
 * re-mints or drops the trace correlation.
 */

/** Companion header carrying the relative elapsed-ms offset for the next hop. */
export const ELAPSED_HEADER = "x-boosthis-trace-elapsed";

/** A propagated elapsed value is 1–6 digits (0..999999); clamped to
 * MAX_TRACE_ELAPSED_MS on receive. Byte-identical across all runtimes. */
export const TRACE_ELAPSED_RE = /^\d{1,6}$/;

/** Upper clamp for a propagated elapsed value (mirrors the span duration
 * bound MAX_SPAN_DURATION_MS). */
export const MAX_TRACE_ELAPSED_MS = 600000;

/** Sanitize-on-receive for the elapsed chain: parse a bounded non-negative
 * integer from the incoming header, or 0 if it is missing/malformed. Never
 * throws; a bad value degrades the offset only. */
export function sanitizeTraceElapsed(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "string" && TRACE_ELAPSED_RE.test(raw)) {
    return Math.min(MAX_TRACE_ELAPSED_MS, parseInt(raw, 10));
  }
  return 0;
}

/* ─── Intake ─────────────────────────────────────────────────────────────── */

/** What this worker adopted from the request that arrived. */
export interface InboundTrace {
  /** The action this request belongs to: adopted when the caller named one,
   *  minted when it did not. Always present — an edge worker with no inbound
   *  header is the trace ROOT, which is the ordinary case for a public URL. */
  readonly traceId: string;
  /** The caller's own span id, adopted-or-DROPPED. Null means "nobody named a
   *  caller", never a guess: a re-minted parent would point at a call that
   *  does not exist, and the waterfall would draw that lie as confidently as
   *  the truth. */
  readonly parentSpanId: string | null;
  /** How long after the trace's root started this hop was reached. */
  readonly startOffsetMs: number;
  /** True when the caller handed us a usable trace id, so this worker
   *  CONTINUED an action rather than starting one. Reported, not inferred from
   *  `startOffsetMs` — a genuine root and an adopted trace reached in its first
   *  millisecond both offset 0. */
  readonly adopted: boolean;
}

/** Read all three trace headers off an inbound request, at the one boundary
 * that sees them.
 *
 * The three travel together and are consumed together. Reading two of them is
 * the failure mode this kit's siblings were caught in twice: the trace id is
 * right, the offset is right, the caller identity is silently dropped, and
 * every span from this hop down records itself as a root. So the id, the
 * caller and the offset are taken in one call, and there is no other intake
 * path in this kit.
 *
 * Never throws: a request object of any shape, or none, yields a fresh root. */
export function beginRequestTrace(request: unknown): InboundTrace {
  return safe(
    () => {
      const headers = (request as { headers?: { get?: (n: string) => unknown } })
        ?.headers;
      const get = (name: string): unknown =>
        typeof headers?.get === "function" ? headers.get(name) : undefined;
      const raw = get(TRACE_HEADER);
      return {
        traceId: sanitizeTraceId(raw),
        parentSpanId: adoptParentSpanId(get(PARENT_HEADER)),
        startOffsetMs: sanitizeTraceElapsed(get(ELAPSED_HEADER)),
        adopted: isValidTraceId(raw),
      };
    },
    {
      traceId: newTraceId(),
      parentSpanId: null,
      startOffsetMs: 0,
      adopted: false,
    } as InboundTrace,
  );
}
