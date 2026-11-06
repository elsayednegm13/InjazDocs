/** Only these closed outcome words may leave the app. */
export const CALL_FAILURE_KINDS = [
  // boosthis:call-failure-kinds:begin
  "could-not-connect", "no-answer", "turned-away", "too-many-requests",
  "server-error", "timed-out", "cancelled",
  // boosthis:call-failure-kinds:end
] as const;
export type CallFailure = (typeof CALL_FAILURE_KINDS)[number];
export interface FailureCounts {
  couldNotConnect: number;
  noAnswer: number;
  turnedAway: number;
  tooManyRequests: number;
  serverError: number;
  cancelled: number;
}
export const emptyFailures = (): FailureCounts => ({
  couldNotConnect: 0, noAnswer: 0, turnedAway: 0,
  tooManyRequests: 0, serverError: 0, cancelled: 0,
});
export function callFailure(status?: unknown, error?: unknown): CallFailure | undefined {
  try {
    if (typeof status === "number" && status > 0) {
      if (status >= 500 && status < 600) return "server-error";
      if (status === 429) return "too-many-requests";
      if (status >= 400 && status < 500) return "turned-away";
      return undefined;
    }
    if (error == null) return undefined;
    const e = error as { code?: unknown; name?: unknown; cause?: unknown };
    if (e.name === "TimeoutError" || ["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(String(e.code))) return "timed-out";
    if (e.name === "AbortError" || e.code === "ABORT_ERR" || e.code === "UND_ERR_ABORTED") return "cancelled";
    if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"].includes(String(e.code))) return "could-not-connect";
    if (e.cause && e.cause !== error) {
      const nested = e.cause as { code?: unknown; name?: unknown };
      if (nested.name === "TimeoutError" || ["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(String(nested.code))) return "timed-out";
      if (nested.name === "AbortError" || nested.code === "ABORT_ERR" || nested.code === "UND_ERR_ABORTED") return "cancelled";
      if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"].includes(String(nested.code))) return "could-not-connect";
    }
    return "no-answer";
  } catch { return error == null ? undefined : "no-answer"; }
}
/** Preserve the existing score buckets, even when they disagree with detail. */
export function countFailure(t: FailureCounts, word: CallFailure | undefined, failed: boolean, timedOut: boolean): void {
  if (word === "turned-away") { if (!failed && !timedOut) t.turnedAway++; return; }
  if (!failed || timedOut) return;
  if (word === "could-not-connect") t.couldNotConnect++;
  if (word === "no-answer") t.noAnswer++;
  if (word === "too-many-requests") t.tooManyRequests++;
  if (word === "server-error") t.serverError++;
  if (word === "cancelled") t.cancelled++;
}
export interface ServiceCounts { name: string; calls: number; failed: number; timedOut: number }
export function countService(services: Map<string, ServiceCounts>, name: string | undefined, failed: boolean, timedOut: boolean): void {
  if (!name) return;
  let s = services.get(name);
  if (!s && services.size < 8) {
    s = { name, calls: 0, failed: 0, timedOut: 0 };
    services.set(name, s);
  }
  if (s) { s.calls++; if (failed) s.failed++; if (timedOut) s.timedOut++; }
}
export function topServices(services: Map<string, ServiceCounts>): { services?: ServiceCounts[] } {
  const rows = [...services.values()].sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, 4).map(s => ({ ...s }));
  return rows.length ? { services: rows } : {};
}
export interface DbFailureCounts {
  dbFailed: number; dbCouldNotConnect: number; dbNoAnswer: number; dbTurnedAway: number;
  dbTooManyRequests: number; dbServerError: number; dbTimedOut: number; dbCancelled: number;
}
export const emptyDbFailures = (): DbFailureCounts => ({
  dbFailed: 0, dbCouldNotConnect: 0, dbNoAnswer: 0, dbTurnedAway: 0,
  dbTooManyRequests: 0, dbServerError: 0, dbTimedOut: 0, dbCancelled: 0,
});
export function countDbFailure(t: DbFailureCounts, word?: CallFailure): void {
  t.dbFailed++;
  if (word === "could-not-connect") t.dbCouldNotConnect++;
  if (word === "no-answer") t.dbNoAnswer++;
  if (word === "turned-away") t.dbTurnedAway++;
  if (word === "too-many-requests") t.dbTooManyRequests++;
  if (word === "server-error") t.dbServerError++;
  if (word === "timed-out") t.dbTimedOut++;
  if (word === "cancelled") t.dbCancelled++;
}
