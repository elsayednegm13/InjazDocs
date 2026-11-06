import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertIsolatedPersist } from "../shared/isolation";

describe("developer state isolation", () => {
  it("refuses the developer persist path before any SQLite open", () => {
    expect(() => assertIsolatedPersist(".wrangler/state")).toThrow(/DEVELOPER_STATE_FORBIDDEN/);
    expect(() => assertIsolatedPersist(path.join(".wrangler", "state", "v3"))).toThrow(/DEVELOPER_STATE_FORBIDDEN/);
    expect(() => assertIsolatedPersist(".wrangler-e2e/state")).toThrow(/PROTECTED_STATE_FORBIDDEN/);
  });

  it("requires an explicit run-owned root and rejects missing or protected roots", () => {
    expect(() =>
      assertIsolatedPersist(path.join(".wrangler-safety-20261021-m01a2", "state"), {
        root: process.cwd(),
        requireRunMarker: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertIsolatedPersist(path.join(".wrangler-safety-20261021-m01a2", "state"), {
        requireRunMarker: true,
      }),
    ).toThrow(/PROJECT_ROOT_REQUIRED/);
    expect(() =>
      assertIsolatedPersist(path.join(".wrangler-e2e", "state"), {
        root: process.cwd(),
        requireRunMarker: true,
      }),
    ).toThrow(/PROTECTED_STATE_FORBIDDEN/);
  });

  it("keeps Playwright and the e2e server on disposable persist paths", () => {
    const server = readFileSync("scripts/e2e-server.mjs", "utf8");
    const playwright = readFileSync("playwright.config.ts", "utf8");
    expect(server).not.toContain(".wrangler-e2e/state");
    expect(server).toContain("EXPORTFLOW_E2E_ROOT");
    expect(server).toContain("EXPORTFLOW_E2E_ROOT_REQUIRED");
    expect(server).toContain("EXPORTFLOW_PERSIST");
    expect(server).not.toMatch(/persist-to["'].*\.wrangler\/state/);
    expect(playwright).toContain("scripts/e2e-server.mjs");
    expect(playwright).toContain("EXPORTFLOW_E2E_ROOT");
    expect(playwright).toContain('path.join(runRoot, "admin-state.json")');
    expect(playwright).not.toContain(".wrangler/state");
  });
});
