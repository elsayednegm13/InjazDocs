/** Keep the company mark and the bell outside the dashboard overview's first second. */
export const DASHBOARD_BRAND_DELAY_MS = 1000;
export const DASHBOARD_BELL_DELAY_MS = 2000;

export function dashboardFollowUp(settled: boolean, elapsedMs: number) {
  if (!settled) return { brand: false, notifications: false };
  return {
    brand: elapsedMs >= DASHBOARD_BRAND_DELAY_MS,
    notifications: elapsedMs >= DASHBOARD_BELL_DELAY_MS,
  };
}
