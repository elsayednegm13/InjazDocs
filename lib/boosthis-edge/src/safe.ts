/** Never let the kit break the customer's function.
 *
 * An isolate serves one request per invocation with no supervisor to catch us:
 * a throw out of our code is the customer's 500. Every public entry point in
 * this kit runs its body through one of these, so the worst thing a bug in
 * Boosthis can do is measure nothing.
 */

/** Run `fn`, swallow anything it throws, return `fallback` instead. */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Run `fn` for its side effects only. Never throws. */
export function safeVoid(fn: () => void): void {
  try {
    fn();
  } catch {
    /* instrumentation must be silent */
  }
}

/** Await `p`, swallow a rejection, return `fallback` instead. Also swallows a
 *  synchronous throw from the thunk. */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
