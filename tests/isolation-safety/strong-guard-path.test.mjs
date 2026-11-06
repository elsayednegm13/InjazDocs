import { test, before, after } from "node:test";
import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUN_MARKER,
  assertIsolatedPersist,
  isProtectedPersist,
} from "../../scripts/isolation-guard.mjs";

// Every fixture below lives in a fresh temporary sandbox owned by this test
// file. No project path, protected store, database or runtime is touched: the
// junctions only connect two dummy directories created here.
let sandbox = "";
let root = "";
const createdDirs = [];
const createdLinks = [];

const guardSource = readFileSync(
  fileURLToPath(new URL("../../scripts/isolation-guard.mjs", import.meta.url)),
  "utf8",
);

function track(dir) {
  createdDirs.push(dir);
  return dir;
}

function runRoot(name) {
  const dir = path.join(root, `${RUN_MARKER}${name}`);
  mkdirSync(dir);
  return track(dir);
}

function expectThrows(fn, code) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(
      message.includes(code),
      `Expected error containing "${code}" but got "${message}"`,
    );
    return message;
  }
  assert.fail(`Expected ${code} but the guard accepted the path`);
}

before(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "exportflow-m01a-strong-"));
  root = path.join(sandbox, "root");
  mkdirSync(root);
});

after(() => {
  for (const link of createdLinks) {
    try {
      unlinkSync(link);
    } catch {
      /* already unlinked */
    }
  }
  for (const dir of createdDirs.reverse()) {
    try {
      rmdirSync(dir);
    } catch {
      /* only empty, test-owned directories are removed */
    }
  }
  try {
    rmdirSync(root);
  } catch {
    /* keep evidence untouched if an unexpected file appeared */
  }
  try {
    rmdirSync(sandbox);
  } catch {
    /* keep evidence untouched if an unexpected file appeared */
  }
});

// ---------------------------------------------------------------------------
// POSITIVE CASES
// ---------------------------------------------------------------------------

test("M01-A strong: accepts a fresh run-owned root", () => {
  const owned = runRoot("accept-root");
  assert.doesNotThrow(() => assertIsolatedPersist(owned, { root }));
});

test("M01-A strong: accepts a non-existent state child of the owned root", () => {
  const owned = runRoot("accept-child");
  assert.doesNotThrow(() => assertIsolatedPersist(path.join(owned, "state"), { root }));
});

test("M01-A strong: returns the resolved absolute path", () => {
  const owned = runRoot("accept-return");
  assert.strictEqual(assertIsolatedPersist(owned, { root }), owned);
});

test("M01-A strong: accepts a relative marker path", () => {
  const owned = runRoot("accept-relative");
  const relative = path.basename(owned);
  assert.doesNotThrow(() => assertIsolatedPersist(relative, { root }));
});

// ---------------------------------------------------------------------------
// NEGATIVE CASES
// ---------------------------------------------------------------------------

test("M01-A strong: missing/blank persist path throws PERSIST_PATH_REQUIRED", () => {
  expectThrows(() => assertIsolatedPersist("", { root }), "PERSIST_PATH_REQUIRED");
  expectThrows(() => assertIsolatedPersist("   ", { root }), "PERSIST_PATH_REQUIRED");
});

test("M01-A strong: blank root throws PROJECT_ROOT_REQUIRED", () => {
  expectThrows(() => assertIsolatedPersist("some-dir", { root: "  " }), "PROJECT_ROOT_REQUIRED");
});

test("M01-A strong: developer store is refused", () => {
  for (const target of [".wrangler/state", ".WRANGLER/STATE", ".wrangler\\state", "./.wrangler/state/"]) {
    assert.strictEqual(isProtectedPersist(target, root), true);
    expectThrows(() => assertIsolatedPersist(target, { root }), "PROTECTED_STATE_FORBIDDEN");
  }
});

test("M01-A strong: every historical test root is refused", () => {
  for (const target of [
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
  ]) {
    expectThrows(() => assertIsolatedPersist(target, { root }), "PROTECTED_STATE_FORBIDDEN");
    expectThrows(() => assertIsolatedPersist(`${target}/state`, { root }), "PROTECTED_STATE_FORBIDDEN");
  }
});

test("M01-A strong: parent traversal outside the project is refused", () => {
  expectThrows(() => assertIsolatedPersist(path.join(root, "..", "outside"), { root }), "PERSIST_OUTSIDE_PROJECT");
  expectThrows(
    () => assertIsolatedPersist(`${RUN_MARKER}owned/../../outside`, { root }),
    "PERSIST_OUTSIDE_PROJECT",
  );
});

test("M01-A strong: a non marker directory is refused", () => {
  expectThrows(() => assertIsolatedPersist("some-other-dir/state", { root }), "AUDIT_ROOT_REQUIRED");
});

test("M01-A strong: prefix collision does not inherit run ownership", () => {
  const collision = path.join(root, ".wrangler-e2e-old");
  assert.strictEqual(isProtectedPersist(collision, root), false);
  expectThrows(() => assertIsolatedPersist(collision, { root }), "AUDIT_ROOT_REQUIRED");
});

test("M01-A strong: protected segment nested below the project root is refused", () => {
  const nested = path.join("nested", ".wrangler-e2e", "state");
  assert.strictEqual(isProtectedPersist(nested, root), true);
  expectThrows(() => assertIsolatedPersist(nested, { root }), "PROTECTED_STATE_FORBIDDEN");
});

test("M01-A strong: a junction escaping the owned root is refused", () => {
  const outside = path.join(sandbox, "outside");
  mkdirSync(outside);
  track(outside);
  const link = path.join(root, `${RUN_MARKER}escape-link`);
  symlinkSync(outside, link, "junction");
  createdLinks.push(link);
  expectThrows(() => assertIsolatedPersist(link, { root }), "PERSIST_OUTSIDE_PROJECT");
});

test("M01-A strong: a junction that drops the run marker is refused", () => {
  const inside = path.join(root, "inside-real");
  mkdirSync(inside);
  createdDirs.push(inside);
  const link = path.join(root, `${RUN_MARKER}inside-link`);
  symlinkSync(inside, link, "junction");
  createdLinks.push(link);
  expectThrows(() => assertIsolatedPersist(link, { root }), "AUDIT_ROOT_REQUIRED");
});

// ---------------------------------------------------------------------------
// STRUCTURAL PROOF: lexical gate precedes any filesystem resolution
// ---------------------------------------------------------------------------

test("M01-A strong: lexical denylist check precedes canonical filesystem access", () => {
  const lexicalIndex = guardSource.indexOf("isProtectedRelative(lexicalRelative)");
  const canonicalIndex = guardSource.indexOf("canonicalExistingAncestor(lexicalTarget)");
  assert.ok(lexicalIndex > 0, "lexical denylist check not found in assertIsolatedPersist");
  assert.ok(canonicalIndex > 0, "canonicalization call not found in assertIsolatedPersist");
  assert.ok(
    lexicalIndex < canonicalIndex,
    "canonicalization must run only after the lexical denylist gate",
  );
});

test("M01-A strong: no protected literal is resolved before rejection", () => {
  // existsSync/realpathSync remain imported, but only inside
  // canonicalExistingAncestor, which is called after the lexical gate.
  const canonicalIndex = guardSource.indexOf("function canonicalExistingAncestor");
  const existsIndex = guardSource.indexOf("existsSync(cursor)");
  assert.ok(canonicalIndex > 0, "canonical helper not found");
  assert.ok(existsIndex > canonicalIndex, "filesystem calls must stay inside the canonical helper");
});
