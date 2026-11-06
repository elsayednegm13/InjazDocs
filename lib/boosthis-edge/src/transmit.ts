/** The only place this kit talks to the network.
 *
 * Web standards only: `fetch`, `AbortSignal.timeout`, `Response`. Every send
 * runs the shared PII guard first, is hard-capped in time and size, and never
 * retries — an isolate that is already living on borrowed time after the
 * response must not spend it re-sending.
 */

import { assertNoPII, checkNoPIIInUrl } from "./no-pii";
import { markKitSend, ownFetch } from "./ownFetch";
import { safe, safeVoid } from "./safe";

/** Ceilings on everything we do after the response has left. These are the
 *  "cap what we do there" numbers: a Worker's after-response budget is small
 *  and shared with the customer's own work. */
export const SEND_TIMEOUT_MS = 3000;
/** Largest body we will ever put on the wire in one send. */
export const MAX_BODY_BYTES = 96 * 1024;
/** Largest answer we will hold from one send. Every answer the server sends is
 *  a few kilobytes of JSON; past this the answer is refused WHILE it is being
 *  read, never after it has been held whole. */
export const MAX_ANSWER_BYTES = 1024 * 1024;
/** Most rows in one sample batch (the server's own ceiling is 100). */
export const MAX_SAMPLES_PER_BATCH = 50;

export type SendOutcome =
  | { ok: true; status: number; body: unknown }
  | {
      ok: false;
      status: number | null;
      reason: SendFailure;
      body: unknown;
      /** On a 429 only: how long the server asked us to wait, read from its
       *  `Retry-After` (whole seconds or a date), clamped to a day. `null`
       *  when the answer carried none we could read. */
      retryAfterMs?: number | null;
    };

/** A payload refusal is final for ordinary rows, not for retained crashes. */
export function batchRefused(outcome: SendOutcome): boolean {
  return !outcome.ok && (
    outcome.reason === "refused" ||
    outcome.reason === "pii-guard" ||
    outcome.reason === "too-large" ||
    outcome.status === 400 || outcome.status === 413 || outcome.status === 422
  );
}

/** The longest `Retry-After` this kit will honour. The server's longest wait
 *  is the per-project day ceiling, which resets at midnight UTC. */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/** A `Retry-After` header as milliseconds: whole seconds or an HTTP date,
 *  clamped to [0, MAX_RETRY_AFTER_MS]. `null` for anything else. Never throws. */
export function readRetryAfterMs(raw: string | null, now: number = Date.now()): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  let ms: number;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else if (/[A-Za-z]/.test(text)) {
    // An HTTP date names its day and month; a bare "-5" is not one.
    const at = Date.parse(text);
    if (!Number.isFinite(at)) return null;
    ms = at - now;
  } else {
    return null;
  }
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/** Why a send did not land. Named causes, because "it didn't work" is what
 *  makes an install look healthy while uploading nothing. */
export type SendFailure =
  | "pii-guard"
  | "too-large"
  | "network"
  | "timeout"
  | "refused"
  | "server-error";

export interface SendArgs {
  url: string;
  payload: unknown;
  /** The credential this kit authenticates with — the project key. See
   *  `credentials.ts` for why an isolate has nothing else to present. */
  bearer?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function classify(status: number): SendFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403 || status === 402 || status === 404)
    return "refused";
  return "server-error";
}

/** POST one JSON payload. Never throws. */
export async function send(args: SendArgs): Promise<SendOutcome> {
  try {
    assertNoPII(args.payload);
  } catch {
    return { ok: false, status: null, reason: "pii-guard", body: null };
  }
  // The address goes through the same guard as the body: a query that
  // carries something shaped like personal data is refused here, with the
  // same named cause, and nothing is sent.
  if (checkNoPIIInUrl(args.url)) {
    return { ok: false, status: null, reason: "pii-guard", body: null };
  }
  let body: string;
  try {
    body = JSON.stringify(args.payload);
  } catch {
    return { ok: false, status: null, reason: "pii-guard", body: null };
  }
  if (body.length > MAX_BODY_BYTES) {
    return { ok: false, status: null, reason: "too-large", body: null };
  }
  // NOT `globalThis.fetch`. This kit watches the isolate's outbound calls to
  // report the app's AI and database work, and the fetch used here is the one
  // captured BEFORE that watch existed — so a kit upload cannot be measured as
  // the customer's own traffic. The exclusion is the reference, not a name
  // check on the address (see `ownFetch.ts`).
  const f = args.fetchImpl ?? ownFetch();
  if (!f) return { ok: false, status: null, reason: "network", body: null };
  const timeoutMs = args.timeoutMs ?? SEND_TIMEOUT_MS;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (args.bearer) headers.authorization = `Bearer ${args.bearer}`;
  let res: Response;
  try {
    // The latch is raised only across the synchronous issue of this call, and
    // it is the belt to the captured reference's braces: on an unusual host
    // that defined `fetch` after this kit loaded, there was nothing to capture,
    // and this is what still keeps our upload out of the app's reading.
    res = await markKitSend(() =>
      f(args.url, {
        method: "POST",
        headers,
        body,
        // AbortSignal.timeout exists in workerd, Deno and every hosted edge
        // runtime. Guarded anyway: an unknown isolate that lacks it still
        // sends, it just relies on the platform's own request ceiling.
        signal: safe(
          () => AbortSignal.timeout(timeoutMs),
          undefined as AbortSignal | undefined,
        ),
      }),
    );
  } catch (e) {
    const name = safe(() => (e as { name?: string }).name ?? "", "");
    return {
      ok: false,
      status: null,
      reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
      body: null,
    };
  }
  // The answer, bounded while reading. One that is too large, too slow to
  // arrive or not JSON reads as null — exactly like no answer: the STATUS
  // still says whether the send landed, and nothing the answer would have
  // taught this isolate is learned from it.
  const parsed = await readAnswer(res, timeoutMs);
  const failure = classify(res.status);
  if (failure && res.status === 429) {
    const retryAfterMs = safe(
      () => readRetryAfterMs(res.headers.get("retry-after")),
      null as number | null,
    );
    return { ok: false, status: res.status, reason: failure, body: parsed, retryAfterMs };
  }
  if (failure) return { ok: false, status: res.status, reason: failure, body: parsed };
  return { ok: true, status: res.status, body: parsed };
}

/** UTF-8 length of a string, counted only as far as `stopAt`. */
function utf8Length(s: string, stopAt: number): number {
  let n = 0;
  for (let i = 0; i < s.length && n <= stopAt; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Thrown inside `readAnswer` only, for an answer this kit refused. */
class AnswerRefused extends Error {}

/** A clock that rejects when `timeoutMs` has passed. Built on
 *  `AbortSignal.timeout`, the same web-standard clock the send itself uses —
 *  this kit keeps no timers of its own. An isolate without it relies on the
 *  send's own signal and the platform's request ceiling. */
function answerClock(timeoutMs: number): { done: Promise<never>; stop: () => void } {
  let stop = (): void => {};
  const done = new Promise<never>((_, reject) => {
    const sig = safe(() => AbortSignal.timeout(timeoutMs), undefined as AbortSignal | undefined);
    if (!sig) return;
    const onAbort = (): void => reject(new AnswerRefused("too-slow"));
    sig.addEventListener("abort", onAbort, { once: true });
    stop = () => sig.removeEventListener("abort", onAbort);
  });
  done.catch(() => {});
  return { done, stop: () => stop() };
}

function step<T>(p: Promise<T>, clock: Promise<never>): Promise<T> {
  p.catch(() => {});
  return Promise.race([p, clock]);
}

/** Read an answer's body as JSON without letting it decide how much memory or
 *  time this isolate spends on it: a declared length over the ceiling is
 *  refused before a byte is read, a streamed body is cancelled at the piece
 *  that would cross the ceiling, and the whole read has a clock. Never
 *  throws; anything refused or unparseable is null. */
async function readAnswer(res: Response, timeoutMs: number): Promise<unknown> {
  const clock = answerClock(timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const declared = safe(() => Number(res.headers.get("content-length") ?? NaN), NaN);
    if (Number.isFinite(declared) && declared > MAX_ANSWER_BYTES) {
      throw new AnswerRefused("too-large");
    }
    let text: string;
    const body = safe(() => res.body, null);
    if (body && typeof body.getReader === "function") {
      reader = body.getReader();
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await step(reader.read(), clock.done);
        if (done) break;
        const n = value ? value.byteLength : 0;
        // The ceiling is checked BEFORE the piece is kept.
        if (total + n > MAX_ANSWER_BYTES) throw new AnswerRefused("too-large");
        total += n;
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      reader = null;
      text = parts.join("");
    } else {
      // A transport that hands the answer over whole: refused by size once
      // in hand, on the same clock.
      text = await step(res.text(), clock.done);
      if (utf8Length(text, MAX_ANSWER_BYTES) > MAX_ANSWER_BYTES) {
        throw new AnswerRefused("too-large");
      }
    }
    return JSON.parse(text) as unknown;
  } catch {
    if (reader) {
      const r = reader;
      safeVoid(() => {
        r.cancel().catch(() => {});
      });
    } else {
      safeVoid(() => {
        res.body?.cancel().catch(() => {});
      });
    }
    return null;
  } finally {
    clock.stop();
  }
}
