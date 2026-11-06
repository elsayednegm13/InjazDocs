export function withBoosthis<T>(worker: T, options?: { appName?: string }): T;
export function boosthisEntryPoint<H extends (...args: never[]) => unknown>(
  kind: "scheduled",
  handler: H,
  options?: { appName?: string; job?: string },
): H;
