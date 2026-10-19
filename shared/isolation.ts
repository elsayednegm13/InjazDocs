export function assertIsolatedPersist(persistTo: string) {
  const normalized = persistTo.replaceAll("\\", "/");
  if (
    normalized === ".wrangler/state" ||
    normalized.startsWith(".wrangler/state/") ||
    normalized.includes("/.wrangler/state/") ||
    normalized.endsWith("/.wrangler/state")
  ) {
    throw new Error("DEVELOPER_STATE_FORBIDDEN");
  }
}
