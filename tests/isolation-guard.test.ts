import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertIsolatedPersist } from "../shared/isolation";

describe("developer state isolation", () => {
  it("refuses the developer persist path before any SQLite open", () => {
    expect(() => assertIsolatedPersist(".wrangler/state")).toThrow(/DEVELOPER_STATE_FORBIDDEN/);
    expect(() => assertIsolatedPersist(path.join(".wrangler", "state", "v3"))).toThrow(/DEVELOPER_STATE_FORBIDDEN/);
    expect(() => assertIsolatedPersist(".wrangler-e2e/state")).not.toThrow();
  });

  it("keeps Playwright and the e2e server on disposable persist paths", () => {
    const server = readFileSync("scripts/e2e-server.mjs", "utf8");
    const playwright = readFileSync("playwright.config.ts", "utf8");
    expect(server).toContain(".wrangler-e2e/state");
    expect(server).toContain("EXPORTFLOW_PERSIST");
    expect(server).not.toMatch(/persist-to["'].*\.wrangler\/state/);
    expect(playwright).toContain("scripts/e2e-server.mjs");
    expect(playwright).not.toContain(".wrangler/state");
  });
});
