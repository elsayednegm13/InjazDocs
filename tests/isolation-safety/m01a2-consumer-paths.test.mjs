import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIsolatedPersist as assertSharedPersist,
  isHistoricalTestRoot,
  isProtectedPersist as isSharedProtected,
} from "../../shared/isolation.ts";
import {
  RUN_MARKER,
  assertIsolatedPersist as assertStrongPersist,
  isProtectedPersist as isStrongProtected,
} from "../../scripts/isolation-guard.mjs";

// M01-A.2 static consumer closure. These tests read only ordinary project
// source files and use artificial path strings. They never import Playwright,
// Vite, Wrangler, a Worker/bootstrap module or a database driver, and they
// never resolve a real developer/historical state root.

const E2E_CONSUMERS = [
  "e2e/atomicity.spec.ts",
  "e2e/duplicates.spec.ts",
  "e2e/dossier-grid.spec.ts",
  "e2e/invoice-lock.spec.ts",
  "e2e/security.spec.ts",
  "e2e/shell-grid.spec.ts",
  "e2e/operations.spec.ts",
];

function readProjectFile(relative) {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function expectError(fn, code) {
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

// ---------------------------------------------------------------------------
// STATIC CONTRACT: the seven E2E consumers
// ---------------------------------------------------------------------------

test("M01-A2 static: seven E2E consumers contain no hardcoded wrangler run root", () => {
  for (const relative of E2E_CONSUMERS) {
    const source = readProjectFile(relative);
    assert.ok(
      !source.includes(".wrangler-"),
      `${relative} still contains a hardcoded .wrangler-* path`,
    );
  }
});

test("M01-A2 static: every consumer imports one explicit run-root helper and derives child paths", () => {
  for (const relative of E2E_CONSUMERS) {
    const source = readProjectFile(relative);
    assert.match(source, /import path from "node:path";/, `${relative} must import node:path`);
    assert.match(
      source,
      /import \{[^}]*\be2eRunRoot\b[^}]*\} from "\.\/helpers";/,
      `${relative} must import e2eRunRoot from helpers`,
    );
    assert.match(
      source,
      /const runRoot = e2eRunRoot\(\);/,
      `${relative} must bind the explicit run root once`,
    );
    assert.match(
      source,
      /const persist = path\.join\(runRoot, "state"\);/,
      `${relative} must derive state from the run root`,
    );
    assert.equal(
      count(source, "e2eRunRoot()"),
      1,
      `${relative} must not invent a second run-root source`,
    );
  }
});

test("M01-A2 static: consumer-specific SQL and session paths are run-root derived", () => {
  const atomicity = readProjectFile("e2e/atomicity.spec.ts");
  assert.match(atomicity, /wranglerRows<[^>]+>\(\s*persist,/s);

  const duplicates = readProjectFile("e2e/duplicates.spec.ts");
  assert.match(
    duplicates,
    /const storageState = path\.join\(runRoot, "admin-state\.json"\);/,
  );
  assert.match(duplicates, /wranglerRows<[^>]+>\(\s*persist,/s);
  assert.equal(count(duplicates, "browser.newContext({ storageState })"), 2);

  const dossier = readProjectFile("e2e/dossier-grid.spec.ts");
  assert.equal(count(dossier, "wranglerSql(persist,"), 3);

  const invoiceLock = readProjectFile("e2e/invoice-lock.spec.ts");
  assert.match(
    invoiceLock,
    /const storageState = path\.join\(runRoot, "admin-state\.json"\);/,
  );
  assert.match(invoiceLock, /wranglerSql\(persist,/);
  assert.equal(count(invoiceLock, "browser.newContext({ storageState })"), 1);

  const security = readProjectFile("e2e/security.spec.ts");
  assert.match(
    security,
    /function sql\(command: string\) \{\s*return wranglerSql\(persist, command\);\s*\}/s,
  );

  const shellGrid = readProjectFile("e2e/shell-grid.spec.ts");
  assert.equal(count(shellGrid, "wranglerSql(persist,"), 2);

  const operations = readProjectFile("e2e/operations.spec.ts");
  assert.match(
    operations,
    /wranglerSql\("\.wrangler\/state", "SELECT 1"\)\)\.toThrow\(\/PROTECTED_STATE_FORBIDDEN\/\)/,
  );
  assert.match(operations, /wranglerSql\(persist, "SELECT email FROM user"\)/);
  assert.ok(!operations.includes("DEVELOPER_STATE_FORBIDDEN"));
});

test("M01-A2 static: legacy isolation test rejects historic roots and server fallback", () => {
  const source = readProjectFile("tests/isolation-guard.test.ts");
  assert.match(
    source,
    /assertIsolatedPersist\("\.wrangler-e2e\/state"\)\)\.toThrow\(\/PROTECTED_STATE_FORBIDDEN\/\)/,
  );
  assert.match(source, /expect\(server\)\.not\.toContain\("\.wrangler-e2e\/state"\)/);
  assert.match(source, /expect\(server\)\.toContain\("EXPORTFLOW_E2E_ROOT"\)/);
  assert.match(source, /expect\(server\)\.toContain\("EXPORTFLOW_E2E_ROOT_REQUIRED"\)/);
  assert.match(source, /PROJECT_ROOT_REQUIRED/);
  assert.match(source, /\.wrangler-safety-20261021-m01a2/);
  assert.ok(
    !/assertIsolatedPersist\("\.wrangler-e2e\/state"\)\)\.not\.toThrow/.test(source),
    "the legacy test must not accept the historic root",
  );
  assert.ok(
    !/expect\(server\)\.toContain\("\.wrangler-e2e\/state"\)/.test(source),
    "the legacy test must not require the historic path in the server",
  );
});

test("M01-A2 static: helper, server and Playwright config agree on the run-root child layout", () => {
  const helpers = readProjectFile("e2e/helpers.ts");
  const server = readProjectFile("scripts/e2e-server.mjs");
  const config = readProjectFile("playwright.config.ts");

  assert.match(helpers, /export function e2eRunRoot\(\): string \{/);
  assert.match(helpers, /EXPORTFLOW_E2E_ROOT_REQUIRED/);
  assert.match(helpers, /assertIsolatedPersist\(explicit, \{ root, requireRunMarker: true \}/);
  assert.match(helpers, /path\.join\(runRoot, "stamp\.txt"\)/);
  assert.match(helpers, /path\.join\(runRoot, "admin\.json"\)/);

  assert.match(server, /EXPORTFLOW_E2E_ROOT_REQUIRED/);
  assert.match(server, /path\.join\(runRoot, "state"\)/);
  assert.match(server, /path\.join\(runRoot, "admin\.json"\)/);
  assert.match(server, /path\.join\(runRoot, "run\.json"\)/);

  assert.match(config, /EXPORTFLOW_E2E_ROOT_REQUIRED/);
  assert.match(config, /path\.join\(runRoot, "admin-state\.json"\)/);
  assert.match(config, /EXPORTFLOW_E2E_ROOT: runRoot/);
});

test("M01-A2 static: the seven E2E consumers contain no non-owned cleanup call", () => {
  for (const relative of E2E_CONSUMERS) {
    const source = readProjectFile(relative);
    assert.ok(
      !/\b(?:rmSync|unlinkSync|rmdirSync|rm)\s*\(/.test(source),
      `${relative} contains a cleanup call`,
    );
  }
});

// ---------------------------------------------------------------------------
// SHARED GUARD: artificial string cases only
// ---------------------------------------------------------------------------

test("M01-A2 shared guard: historic roots are rejected with PROTECTED_STATE_FORBIDDEN", () => {
  for (const target of [
    ".wrangler-e2e",
    ".wrangler-e2e/state",
    ".wrangler-e2e/admin-state.json",
    ".wrangler-e2e/stamp.txt",
    ".wrangler-perf/state",
    ".wrangler-reliability-b/state",
    ".wrangler-transition-audit-20261020-c/state",
  ]) {
    expectError(
      () => assertSharedPersist(target, { root: "C:/exportflow", requireRunMarker: true }),
      "PROTECTED_STATE_FORBIDDEN",
    );
  }
});

test("M01-A2 shared guard: developer state keeps DEVELOPER_STATE_FORBIDDEN", () => {
  for (const target of [
    ".wrangler/state",
    ".wrangler\\state",
    ".WRANGLER/STATE",
    "./.wrangler/state/",
  ]) {
    expectError(
      () => assertSharedPersist(target, { root: "C:/exportflow", requireRunMarker: true }),
      "DEVELOPER_STATE_FORBIDDEN",
    );
  }
});

test("M01-A2 shared guard: only an artificial marker root is accepted and missing root fails closed", () => {
  assert.doesNotThrow(() =>
    assertSharedPersist(
      "C:/exportflow/.wrangler-safety-20261021-m01a2/state",
      { root: "C:/exportflow", requireRunMarker: true },
    ),
  );
  expectError(
    () =>
      assertSharedPersist("C:/exportflow/.wrangler-safety-20261021-m01a2/state", {
        requireRunMarker: true,
      }),
    "PROJECT_ROOT_REQUIRED",
  );
  expectError(
    () => assertSharedPersist("", { root: "C:/exportflow", requireRunMarker: true }),
    "PERSIST_PATH_REQUIRED",
  );
  expectError(
    () => assertSharedPersist("../outside/state", { root: "C:/exportflow", requireRunMarker: true }),
    "PERSIST_OUTSIDE_PROJECT",
  );
});

test("M01-A2 shared guard: Windows path edges preserve historic denial and prefix boundaries", () => {
  const cases = [
    [".wrangler-e2e\\state", "C:/exportflow"],
    ["C:\\exportflow\\.wrangler-e2e\\state", "C:/exportflow"],
    ["C:/exportflow/foo/../.wrangler-e2e/state", "C:/exportflow"],
    [".WRANGLER-E2E/STATE", "C:/exportflow"],
    ["\\\\server\\share\\.wrangler-e2e\\state", "\\\\server\\share\\"],
    ["\\\\?\\C:\\.wrangler-e2e\\state", "\\\\?\\C:\\"],
  ];
  for (const [target, root] of cases) {
    expectError(
      () => assertSharedPersist(target, { root, requireRunMarker: true }),
      "PROTECTED_STATE_FORBIDDEN",
    );
  }

  // Prefix boundary: ".wrangler-e2e-old" is not the protected historical root.
  assert.equal(isHistoricalTestRoot(".wrangler-e2e-old/state"), false);
  assert.equal(isSharedProtected(".wrangler-e2e-old/state"), false);
  assert.doesNotThrow(() =>
    assertSharedPersist(".wrangler-e2e-old/state", {
      root: "C:/exportflow",
      requireRunMarker: false,
    }),
  );
  expectError(
    () =>
      assertSharedPersist(".wrangler-e2e-old/state", {
        root: "C:/exportflow",
        requireRunMarker: true,
      }),
    "AUDIT_ROOT_REQUIRED",
  );
});

// ---------------------------------------------------------------------------
// STRONG GUARD: one fresh OS-temp sandbox owned by this test only
// ---------------------------------------------------------------------------

test("M01-A2 strong guard: temp-owned root accepted and historic/non-owned roots refused", () => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "exportflow-m01a2-consumer-"));
  try {
    const root = path.join(sandbox, "root");
    mkdirSync(root);
    const owned = path.join(root, `${RUN_MARKER}m01a2`);
    mkdirSync(owned);

    assert.doesNotThrow(() => assertStrongPersist(owned, { root }));
    assert.doesNotThrow(() => assertStrongPersist(path.join(owned, "state"), { root }));

    expectError(
      () => assertStrongPersist(".wrangler-e2e/state", { root }),
      "PROTECTED_STATE_FORBIDDEN",
    );
    expectError(
      () => assertStrongPersist(".wrangler/state", { root }),
      "PROTECTED_STATE_FORBIDDEN",
    );
    expectError(
      () => assertStrongPersist("some-other-dir/state", { root }),
      "AUDIT_ROOT_REQUIRED",
    );
    expectError(
      () => assertStrongPersist(path.join(root, "..", "outside"), { root }),
      "PERSIST_OUTSIDE_PROJECT",
    );
    expectError(() => assertStrongPersist("", { root }), "PERSIST_PATH_REQUIRED");
    expectError(() => assertStrongPersist("some-dir", { root: "  " }), "PROJECT_ROOT_REQUIRED");

    assert.equal(isStrongProtected(".wrangler-e2e/state", root), true);
    assert.equal(isStrongProtected(path.join(root, ".wrangler-e2e-old"), root), false);
  } finally {
    // Remove only this test's fresh OS-temp sandbox, after proving ownership.
    assert.ok(sandbox.startsWith(os.tmpdir()), "sandbox must live under the OS temp directory");
    assert.ok(
      path.basename(sandbox).startsWith("exportflow-m01a2-consumer-"),
      "sandbox must carry this test's unique prefix",
    );
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("M01-A2 strong guard: lexical denial remains ahead of canonical filesystem access", () => {
  const source = readProjectFile("scripts/isolation-guard.mjs");
  const lexical = source.indexOf("isProtectedRelative(lexicalRelative)");
  const canonical = source.indexOf("canonicalExistingAncestor(lexicalTarget)");
  assert.ok(lexical > 0, "lexical denylist check not found");
  assert.ok(canonical > lexical, "canonicalization must run after the lexical gate");
});
