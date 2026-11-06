export function startWebVitals(options?: { bubble?: boolean; projectKey?: string }): void;
export function enableTelemetry(options: {
  installId: string;
  inviteKey?: string;
  appName?: string;
  endpoint?: string;
}): unknown;
export function reportCaughtError(error: unknown): void;
