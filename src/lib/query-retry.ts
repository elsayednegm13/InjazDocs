import { ApiRequestError } from "./api";

/**
 * One extra attempt for a dropped connection or a 5xx response.
 * A 4xx answer is the server's decision, so it is not sent again.
 * `failureCount` is the number of failures already seen, before this one is counted.
 */
export function retryReadQuery(failureCount: number, error: unknown) {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/** A failed read stays failed until something asks again. A successful one may refresh when it is stale. */
export function refetchWhenReadable(status: string) {
  return status === "success";
}

/**
 * Login opens with the session read alone. The setup check is next, and only
 * for a signed-out visitor. The brand read waits until that check has settled,
 * so the page never fires its reads together.
 */
export function loginRequestGate(input: { sessionPending: boolean; hasSession: boolean; bootstrapSettled: boolean }) {
  const signedOut = !input.sessionPending && !input.hasSession;
  return {
    bootstrap: signedOut,
    brand: signedOut && input.bootstrapSettled,
  };
}

/** True when the document icon would request a different URL. */
export function iconHrefNeedsUpdate(currentHref: string, nextHref: string, baseHref: string) {
  try {
    return new URL(currentHref, baseHref).href !== new URL(nextHref, baseHref).href;
  } catch {
    return true;
  }
}
