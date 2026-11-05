import { useCallback, useRef, useState } from "react";
import { ApiRequestError, createIdempotencyKey } from "./api";

/**
 * One key per logical form submission. It intentionally survives network
 * errors and 5xx responses so a retry can be replayed instead of creating a
 * second record. It is rotated only after a known success or a definitive 4xx.
 */
export function useIdempotencyKey() {
  const key = useRef(createIdempotencyKey());
  const reset = useCallback(() => {
    key.current = createIdempotencyKey();
  }, []);
  return { key, reset };
}

/**
 * A synchronous lock, not just React state. A double click can dispatch two
 * events before a re-render disables the button; the ref closes that window.
 */
export function useSubmitLock() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const acquire = useCallback(() => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    return true;
  }, []);
  const release = useCallback(() => {
    locked.current = false;
    setBusy(false);
  }, []);
  return { busy, acquire, release };
}

/**
 * A 4xx is normally a known negative result: the operation did not run, or it
 * failed validation, so a corrected submit is a new logical operation. The
 * exceptions below are completed-operation states: rotating the key there
 * would allow the same logical operation to create a second business effect.
 * Network and 5xx failures keep the key because the outcome is unknown.
 */
const NON_ROTATING_CODES = new Set([
  "IDEMPOTENCY_IN_PROGRESS",
  "IDEMPOTENCY_RESULT_UNKNOWN",
  "IDEMPOTENCY_RESULT_EXPIRED",
  "IDEMPOTENCY_REPLAY_POLICY_MISSING",
]);

export function isDefinitiveFailure(error: unknown) {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.status === 0) return false;
  if (NON_ROTATING_CODES.has(error.code)) return false;
  return error.status >= 400 && error.status < 500;
}

export function shouldReuseKey(error: unknown) {
  return !isDefinitiveFailure(error);
}
