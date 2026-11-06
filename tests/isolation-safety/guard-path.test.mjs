import { test } from "node:test";
import assert from "node:assert";
import {
  assertIsolatedPersist,
  isProtectedPersist,
  isDeveloperStatePath,
  isHistoricalTestRoot,
} from "../../shared/isolation.ts";

// Helper: run a function and capture whether it threw and the message.
async function expectThrows(t, fn, expectedCode) {
  let threw = false;
  let message = "";
  try {
    fn();
  } catch (error) {
    threw = true;
    message = error instanceof Error ? error.message : String(error);
  }
  t.assert.ok(threw, `Expected function to throw but it did not`);
  if (expectedCode) {
    t.assert.ok(
      message.includes(expectedCode),
      `Expected error message to include "${expectedCode}" but got "${message}"`,
    );
  }
  return { threw, message };
}

// Helper: assert a function does NOT throw.
function assertDoesNotThrow(fn, label) {
  try {
    fn();
  } catch (error) {
    throw new Error(`Expected "${label}" not to throw, but it threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Project root used as the `root` argument for run-marker validation.
const PROJECT_ROOT = "C:/";

// Synthetic run-owned root: first path segment starts with the run marker so
// that requireRunMarker validation passes when root is PROJECT_ROOT.
const SYNTHETIC_ROOT = "C:/.wrangler-safety-20261021-run-abc123";

// ---------------------------------------------------------------------------
// POSITIVE CASES
// ---------------------------------------------------------------------------

test("M01-A synthetic: valid unique owned root is accepted", (t) => {
  assertDoesNotThrow(
    () => assertIsolatedPersist(SYNTHETIC_ROOT, { root: PROJECT_ROOT, requireRunMarker: true }),
    "valid unique owned root",
  );
});

test("M01-A synthetic: valid child path within owned root is accepted", (t) => {
  const child = `${SYNTHETIC_ROOT}/state`;
  assertDoesNotThrow(
    () => assertIsolatedPersist(child, { root: PROJECT_ROOT, requireRunMarker: true }),
    "valid child path",
  );
});

test("M01-A synthetic: child path with credentials/storage/stamps suffix is accepted", (t) => {
  const paths = [
    `${SYNTHETIC_ROOT}/.dev.vars.e2e`,
    `${SYNTHETIC_ROOT}/admin.json`,
    `${SYNTHETIC_ROOT}/run.json`,
    `${SYNTHETIC_ROOT}/stamp.txt`,
    `${SYNTHETIC_ROOT}/admin-state.json`,
  ];
  for (const p of paths) {
    assertDoesNotThrow(
      () => assertIsolatedPersist(p, { root: PROJECT_ROOT, requireRunMarker: true }),
      `path ${p}`,
    );
  }
});

test("M01-A synthetic: isProtectedPersist returns false for owned synthetic root", (t) => {
  assert.strictEqual(isProtectedPersist(SYNTHETIC_ROOT), false);
});

test("M01-A synthetic: isDeveloperStatePath returns false for owned synthetic root", (t) => {
  assert.strictEqual(isDeveloperStatePath(SYNTHETIC_ROOT), false);
});

test("M01-A synthetic: isHistoricalTestRoot returns false for owned synthetic root", (t) => {
  assert.strictEqual(isHistoricalTestRoot(SYNTHETIC_ROOT), false);
});

test("M01-A synthetic: run marker requirement passes for marker-prefixed root", (t) => {
  const markerRoot = `${SYNTHETIC_ROOT}/state`;
  assertDoesNotThrow(
    () => assertIsolatedPersist(markerRoot, { root: PROJECT_ROOT, requireRunMarker: true }),
    "marker-prefixed root",
  );
});

test("M01-A synthetic: forward slash and backslash Windows forms both normalize", (t) => {
  const rootSlash = "C:/.wrangler-safety-20261021-run-abc123";
  const rootBackslash = "C:\\.wrangler-safety-20261021-run-abc123";
  assertDoesNotThrow(
    () => assertIsolatedPersist(rootSlash, { root: PROJECT_ROOT, requireRunMarker: true }),
    "forward slash",
  );
  assertDoesNotThrow(
    () => assertIsolatedPersist(rootBackslash, { root: PROJECT_ROOT, requireRunMarker: true }),
    "backslash",
  );
});

test("M01-A synthetic: trailing separator is tolerated for owned root", (t) => {
  const root = `${SYNTHETIC_ROOT}/`;
  assertDoesNotThrow(
    () => assertIsolatedPersist(root, { root: PROJECT_ROOT, requireRunMarker: true }),
    "trailing separator",
  );
});

// ---------------------------------------------------------------------------
// NEGATIVE CASES
// ---------------------------------------------------------------------------

test("M01-A synthetic: missing/empty root throws PERSIST_PATH_REQUIRED", async (t) => {
  await expectThrows(t, () => assertIsolatedPersist(""), "PERSIST_PATH_REQUIRED");
  await expectThrows(t, () => assertIsolatedPersist("   "), "PERSIST_PATH_REQUIRED");
});

test("M01-A synthetic: invalid/unrecognized root marker throws AUDIT_ROOT_REQUIRED", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist("C:/some-other-folder/state", { root: PROJECT_ROOT, requireRunMarker: true }),
    "AUDIT_ROOT_REQUIRED",
  );
  await expectThrows(
    t,
    () => assertIsolatedPersist("C:/wrangler-safety-old/state", { root: PROJECT_ROOT, requireRunMarker: true }),
    "AUDIT_ROOT_REQUIRED",
  );
});

test("M01-A synthetic: run-marker requirement without a root throws PROJECT_ROOT_REQUIRED", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist(SYNTHETIC_ROOT, { requireRunMarker: true }),
    "PROJECT_ROOT_REQUIRED",
  );
});

test("M01-A synthetic: relative path resolves against the provided root", async (t) => {
  assertDoesNotThrow(
    () =>
      assertIsolatedPersist(".wrangler-safety-20261021-run-abc123/state", {
        root: PROJECT_ROOT,
        requireRunMarker: true,
      }),
    "relative marker path",
  );
  await expectThrows(
    t,
    () =>
      assertIsolatedPersist("../outside/state", {
        root: "C:/exportflow/",
        requireRunMarker: true,
      }),
    "PERSIST_OUTSIDE_PROJECT",
  );
});

test("M01-A synthetic: direct protected-root string .wrangler/state throws DEVELOPER_STATE_FORBIDDEN", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler/state", { root: PROJECT_ROOT, requireRunMarker: true }),
    "DEVELOPER_STATE_FORBIDDEN",
  );
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler/state/", { root: PROJECT_ROOT, requireRunMarker: true }),
    "DEVELOPER_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: protected root .wrangler-e2e throws PROTECTED_STATE_FORBIDDEN", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler-e2e", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler-e2e/state", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler-e2e/admin-state.json", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: other historical roots throw PROTECTED_STATE_FORBIDDEN", async (t) => {
  const historical = [
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
  for (const root of historical) {
    await expectThrows(
      t,
      () => assertIsolatedPersist(root, { root: PROJECT_ROOT, requireRunMarker: true }),
      "PROTECTED_STATE_FORBIDDEN",
    );
    await expectThrows(
      t,
      () => assertIsolatedPersist(`${root}/state`, { root: PROJECT_ROOT, requireRunMarker: true }),
      "PROTECTED_STATE_FORBIDDEN",
    );
  }
});

test("M01-A synthetic: mixed case protected root still throws", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist(".WRANGLER/STATE", { root: PROJECT_ROOT, requireRunMarker: true }),
    "DEVELOPER_STATE_FORBIDDEN",
  );
  await expectThrows(
    t,
    () => assertIsolatedPersist(".Wrangler-E2E", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: protected root with trailing separator still throws", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler-e2e/", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: parent traversal to protected sibling throws", async (t) => {
  await expectThrows(
    t,
    () =>
      assertIsolatedPersist(
        "C:/.wrangler-safety-20261021-run-abc123/../.wrangler-e2e",
        { root: PROJECT_ROOT, requireRunMarker: true },
      ),
      "PROTECTED_STATE_FORBIDDEN",
  );
  await expectThrows(
    t,
    () =>
      assertIsolatedPersist(
        "C:/.wrangler-safety-20261021-run-abc123/../../.wrangler/state",
        { root: PROJECT_ROOT, requireRunMarker: true },
      ),
      "DEVELOPER_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: marker-prefixed child of owned root is accepted", (t) => {
  // A child path whose first relative segment starts with the run marker is
  // accepted, even if the child name contains "-old" (not a protected root).
  assertDoesNotThrow(
    () =>
      assertIsolatedPersist(
        `${SYNTHETIC_ROOT}/.wrangler-safety-20261021-run-old`,
        { root: PROJECT_ROOT, requireRunMarker: true },
      ),
      "marker-prefixed child",
    );
});

test("M01-A synthetic: alternate drive protected root throws", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist("D:/.wrangler-e2e/state", { root: "D:/", requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: UNC path to protected root throws", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist("\\\\server\\share\\.wrangler-e2e\\state", { root: "\\\\server\\share\\", requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: extended-prefix path to protected root throws", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist("\\\\?\\C:\\.wrangler-e2e\\state", { root: "\\\\?\\C:\\", requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: stale .wrangler-e2e admin/storage/stamp paths throw", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler-e2e/admin-state.json", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler-e2e/admin.json", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
  await expectThrows(
    t,
    () => assertIsolatedPersist(".wrangler-e2e/stamp.txt", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: ambiguous/nonexistent path components with historical root segment throw", async (t) => {
  await expectThrows(
    t,
    () =>
      assertIsolatedPersist("C:/exportflow/.../.wrangler-e2e/state", {
        root: "C:/exportflow/",
        requireRunMarker: true,
      }),
      "PROTECTED_STATE_FORBIDDEN",
  );
});

test("M01-A synthetic: isProtectedPersist returns true for all historical roots", (t) => {
  const historical = [
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
  for (const root of historical) {
    assert.strictEqual(isProtectedPersist(root), true, `${root} should be protected`);
    assert.strictEqual(isProtectedPersist(`${root}/state`), true, `${root}/state should be protected`);
  }
});

test("M01-A synthetic: isProtectedPersist returns true for developer state", (t) => {
  assert.strictEqual(isProtectedPersist(".wrangler/state"), true);
  assert.strictEqual(isProtectedPersist(".wrangler/state/"), true);
  assert.strictEqual(isProtectedPersist(".wrangler/state/foo.db"), true);
});

test("M01-A synthetic: cleanup decision on run-owned dummy root is allowed", (t) => {
  const dummy = "C:/.wrangler-safety-20261021-dummy-xyz789";
  assertDoesNotThrow(
    () => assertIsolatedPersist(dummy, { root: PROJECT_ROOT, requireRunMarker: true }),
    "run-owned dummy root",
  );
});

test("M01-A synthetic: cleanup request for parent or unowned dummy folder is rejected", async (t) => {
  await expectThrows(
    t,
    () => assertIsolatedPersist("C:/.wrangler-e2e", { root: PROJECT_ROOT, requireRunMarker: true }),
    "PROTECTED_STATE_FORBIDDEN",
  );
});
