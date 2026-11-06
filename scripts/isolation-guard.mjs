#!/usr/bin/env node
/**
 * Fail-closed isolation guard for audit/test runners.
 *
 * The developer D1 store and every established test store are protected. A
 * writable run must live in a newly created `.wrangler-safety-20261021-*`
 * root. Rejection is lexical first: a forbidden or non-run-owned candidate is
 * refused without ever calling existsSync/realpath on it. Only a candidate
 * that already proved to be inside a run-owned root is canonicalized, so a
 * symlink or junction that escapes that root still fails closed.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RUN_MARKER = ".wrangler-safety-20261021-";

export const PROTECTED_ROOTS = [
  ".wrangler/state",
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

function toPosixLower(value) {
  return value.replaceAll("\\", "/").toLowerCase();
}

function lexicalAbsolute(value, base = process.cwd()) {
  return toPosixLower(path.resolve(base, value));
}

function directoryRelative(target, root) {
  const base = root.replace(/\/+$/, "");
  if (!base) return null;
  if (target === base) return "";
  if (target.startsWith(`${base}/`)) return target.slice(base.length + 1);
  return null;
}

function isProtectedRelative(relative) {
  if (!relative) return false;
  return PROTECTED_ROOTS.some((protectedRoot) => {
    const normalized = protectedRoot.toLowerCase();
    return (
      relative === normalized ||
      relative.startsWith(`${normalized}/`) ||
      relative.includes(`/${normalized}/`) ||
      relative.endsWith(`/${normalized}`)
    );
  });
}

function relativeToRoot(target, root) {
  return directoryRelative(lexicalAbsolute(target, root), lexicalAbsolute(root));
}

function canonicalExistingAncestor(absolutePosixLower) {
  let cursor = absolutePosixLower;
  const missing = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  try {
    cursor = realpathSync.native(cursor);
  } catch {
    /* keep the resolved path when the parent cannot be canonicalized */
  }
  return toPosixLower(path.join(cursor, ...missing));
}

export function isProtectedPersist(persistTo, root = process.cwd()) {
  const relative = relativeToRoot(persistTo, root);
  if (relative === null) return false;
  return isProtectedRelative(relative);
}

export function assertIsolatedPersist(
  persistTo,
  { root = process.cwd(), requireRunMarker = true } = {},
) {
  if (!persistTo || !String(persistTo).trim()) {
    throw new Error("PERSIST_PATH_REQUIRED");
  }
  if (!root || !String(root).trim()) {
    throw new Error("PROJECT_ROOT_REQUIRED");
  }

  const absolute = path.resolve(root, persistTo);
  const lexicalTarget = toPosixLower(absolute);
  const lexicalRoot = toPosixLower(path.resolve(root));
  const lexicalRelative = directoryRelative(lexicalTarget, lexicalRoot);

  // Pure lexical gate first. A forbidden or non-run-owned candidate is refused
  // here, so the guard never stats or resolves a protected store to reject it.
  if (lexicalRelative === null) {
    throw new Error("PERSIST_OUTSIDE_PROJECT");
  }
  if (isProtectedRelative(lexicalRelative)) {
    throw new Error("PROTECTED_STATE_FORBIDDEN");
  }
  if (requireRunMarker) {
    const first = lexicalRelative.split("/")[0];
    if (!first || !first.startsWith(RUN_MARKER)) {
      throw new Error("AUDIT_ROOT_REQUIRED");
    }
  }

  // Only a candidate that already proved to be inside a run-owned root may be
  // canonicalized. A junction or symlink that escapes the root, or that lands
  // on a protected store, still fails closed here.
  const canonicalRelative = directoryRelative(
    canonicalExistingAncestor(lexicalTarget),
    canonicalExistingAncestor(lexicalRoot),
  );
  if (canonicalRelative === null) {
    throw new Error("PERSIST_OUTSIDE_PROJECT");
  }
  if (isProtectedRelative(canonicalRelative)) {
    throw new Error("PROTECTED_STATE_FORBIDDEN");
  }
  if (requireRunMarker) {
    const first = canonicalRelative.split("/")[0];
    if (!first || !first.startsWith(RUN_MARKER)) {
      throw new Error("AUDIT_ROOT_REQUIRED");
    }
  }

  return absolute;
}

export function createRunRoot(runId, root = process.cwd()) {
  const safe = String(runId)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!safe) throw new Error("RUN_ID_REQUIRED");
  return path.join(root, `${RUN_MARKER}${safe}`);
}

function main(argv) {
  const args = [...argv];
  let root = process.cwd();
  let requireRunMarker = true;
  const rootIndex = args.indexOf("--root");
  if (rootIndex >= 0) {
    root = args[rootIndex + 1];
    args.splice(rootIndex, 2);
  }
  if (args.includes("--no-marker")) {
    requireRunMarker = false;
    args.splice(args.indexOf("--no-marker"), 1);
  }
  const target = args[0];
  if (!target) {
    console.error("usage: node scripts/isolation-guard.mjs [--root <dir>] [--no-marker] <persist-path>");
    process.exit(2);
  }
  try {
    const resolved = assertIsolatedPersist(target, { root, requireRunMarker });
    console.log(`ISOLATION_OK ${resolved}`);
  } catch (error) {
    console.error(`ISOLATION_REFUSED ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
