/** The kit's own way out of the isolate, captured before anything wraps it.
 *
 * An isolate has exactly one way to reach the network, and this kit is about
 * to watch it (see `outbound.ts`). That leaves one hazard worth designing
 * around rather than papering over: OUR uploads travel the same fetch, so a
 * naive wrap measures the kit and reports its traffic as the app's.
 *
 * The exclusion here is structural, not a name check. This module runs at
 * import time — before any handler exists and therefore before the watch can
 * possibly be armed — and keeps the function it found. `transmit.ts` sends
 * through THAT reference, so a kit upload never enters the wrapper at all.
 * There is nothing to recognise, so nothing to get wrong: renaming a URL,
 * moving an endpoint or adding a second one cannot leak our traffic into the
 * app's reading.
 *
 * The re-entrancy latch below is the belt to that braces. If an unusual host
 * defines `fetch` only AFTER modules are evaluated, there is no original to
 * keep; the send then has to go through whatever is on `globalThis`, which by
 * then may be our wrapper. `markKitSend` is set synchronously around the call
 * that issues the request, and the wrapper reads it at entry — again a fact
 * about the call in progress, never a guess from an address.
 */

import { safe } from "./safe";

type FetchFn = typeof fetch;

/** The isolate's fetch as it was when this kit loaded. Null on a host that
 *  had none at module-evaluation time. */
const CAPTURED: FetchFn | null = safe(() => {
  const f = (globalThis as { fetch?: FetchFn }).fetch;
  return typeof f === "function" ? (f.bind(globalThis) as FetchFn) : null;
}, null as FetchFn | null);

/** Depth of kit sends currently being ISSUED. Only ever non-zero across a
 *  synchronous call into fetch, so it can never straddle two requests. */
let kitSendDepth = 0;

/** The fetch the kit itself uses. Never the wrapped one when a capture
 *  succeeded, which is what keeps our uploads out of the app's reading. */
export function ownFetch(): FetchFn | null {
  if (CAPTURED) return CAPTURED;
  return safe(() => {
    const f = (globalThis as { fetch?: FetchFn }).fetch;
    return typeof f === "function" ? (f.bind(globalThis) as FetchFn) : null;
  }, null as FetchFn | null);
}

/** Did we manage to keep the isolate's own fetch? Only false on a host that
 *  defines fetch after module evaluation. */
export function hasOwnFetch(): boolean {
  return CAPTURED !== null;
}

/** Run one kit send with the latch raised. Synchronous body only: the latch
 *  must be down again before any of the host's own code can run. */
export function markKitSend<T>(issue: () => T): T {
  kitSendDepth += 1;
  try {
    return issue();
  } finally {
    kitSendDepth -= 1;
  }
}

/** Is a kit send being issued right now? Read by the outbound watch. */
export function inKitSend(): boolean {
  return kitSendDepth > 0;
}
