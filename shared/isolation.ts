/**
 * Isomorphic (Worker/browser/Node) guard for persist paths.
 *
 * This module intentionally has no Node imports: it is used by Playwright
 * helpers and by unit tests. The stronger audit runner guard, which also
 * resolves symlinks and requires a run-owned root marker, lives in
 * `scripts/isolation-guard.mjs`.
 *
 * Every check here is a pure lexical denylist comparison: no fs.stat,
 * fs.realpath, fs.access, fs.readdir or equivalent is ever issued for a
 * candidate path, so a forbidden store is never touched merely to reject it.
 */

const DEVELOPER_STATE = ".wrangler/state";
const RUN_MARKER = ".wrangler-safety-20261021-";

// Historical test roots that must never be reused as a test persist target,
// mirroring PROTECTED_ROOTS in scripts/isolation-guard.mjs.
const HISTORICAL_TEST_ROOTS = [
  ".wrangler-e2e",
  ".wrangler-perf",
  ".wrangler-reliability-b",
  ".wrangler-0653",
  ".wrangler-0654-drain",
  ".wrangler-0654-race",
  ".wrangler-verify",
  ".wrangler-transition-audit-20261020-c",
  ".wrangler-transition-audit-20261020-u",
  ".wrangler-transition-audit-20261020-p",
  ".wrangler-transition-audit-20261020-f",
  ".wrangler-transition-audit-20261020-h",
  ".wrangler-transition-audit-20261020-cwd",
];

function normalize(value: string): string {
  let text = value.replaceAll("\\", "/");
  const unc = text.startsWith("//");
  text = text.replace(/\/+/g, "/");
  if (unc) text = `/${text}`;
  if (text.length > 1) text = text.replace(/\/+$/, "");
  return text.toLowerCase();
}

function isExactOrDescendant(normalized: string, root: string): boolean {
  return (
    normalized === root ||
    normalized.startsWith(`${root}/`) ||
    normalized.includes(`/${root}/`) ||
    normalized.endsWith(`/${root}`)
  );
}

function collapseSegments(normalized: string): string {
  const drive = normalized.match(/^[a-z]:/)?.[0] ?? "";
  const unc = !drive && normalized.startsWith("//");
  const rooted = !drive && !unc && normalized.startsWith("/");
  const output: string[] = [];
  for (const segment of normalized.slice(drive.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      output.pop();
      continue;
    }
    output.push(segment);
  }
  const body = output.join("/");
  if (drive) return `${drive}/${body}`;
  if (unc) return `//${body}`;
  if (rooted) return `/${body}`;
  return body;
}

function isAbsolute(value: string): boolean {
  return /^[a-z]:\//.test(value) || value.startsWith("//") || value.startsWith("/");
}

function resolveAgainstRoot(value: string, root: string): string {
  const normalized = normalize(value);
  if (isAbsolute(normalized)) return collapseSegments(normalized);
  return collapseSegments(`${normalize(root)}/${normalized}`);
}

function relativeWithin(target: string, root: string): string | null {
  const base = collapseSegments(normalize(root)).replace(/\/+$/, "");
  if (!base) return null;
  if (target === base) return "";
  if (target.startsWith(`${base}/`)) return target.slice(base.length + 1);
  return null;
}

export type IsolatedPersistOptions = {
  root?: string;
  requireRunMarker?: boolean;
};

export function isDeveloperStatePath(persistTo: string): boolean {
  const normalized = normalize(persistTo);
  return isExactOrDescendant(normalized, DEVELOPER_STATE);
}

export function isHistoricalTestRoot(persistTo: string): boolean {
  const normalized = normalize(persistTo);
  return HISTORICAL_TEST_ROOTS.some((root) => isExactOrDescendant(normalized, root));
}

export function isProtectedPersist(persistTo: string): boolean {
  return isDeveloperStatePath(persistTo) || isHistoricalTestRoot(persistTo);
}

export function assertIsolatedPersist(
  persistTo: string,
  { root = "", requireRunMarker = false }: IsolatedPersistOptions = {},
): void {
  if (!persistTo || !persistTo.trim()) {
    throw new Error("PERSIST_PATH_REQUIRED");
  }
  // Developer state keeps its historical error code for existing callers.
  if (isDeveloperStatePath(persistTo)) {
    throw new Error("DEVELOPER_STATE_FORBIDDEN");
  }
  if (isHistoricalTestRoot(persistTo)) {
    throw new Error("PROTECTED_STATE_FORBIDDEN");
  }
  if (!requireRunMarker) {
    return;
  }
  if (!root || !root.trim()) {
    throw new Error("PROJECT_ROOT_REQUIRED");
  }
  const relative = relativeWithin(resolveAgainstRoot(persistTo, root), root);
  if (relative === null) {
    throw new Error("PERSIST_OUTSIDE_PROJECT");
  }
  const first = relative.split("/")[0];
  if (!first || !first.startsWith(RUN_MARKER)) {
    throw new Error("AUDIT_ROOT_REQUIRED");
  }
}
