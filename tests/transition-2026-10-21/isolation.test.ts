import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUN_MARKER,
  assertIsolatedPersist,
  createRunRoot,
  isProtectedPersist,
} from "../../scripts/isolation-guard.mjs";
import {
  assertIsolatedPersist as assertSharedPersist,
  isDeveloperStatePath,
} from "../../shared/isolation";

const root = process.cwd();

describe("isolation guard", () => {
  it("rejects the developer D1 store in every case and slash spelling", () => {
    for (const target of [".wrangler/state", ".WRANGLER/STATE", ".wrangler\\state", "./.wrangler/state/"]) {
      expect(isProtectedPersist(target, root)).toBe(true);
      expect(() => assertIsolatedPersist(target, { root })).toThrow("PROTECTED_STATE_FORBIDDEN");
    }
  });

  it("rejects every established test root", () => {
    for (const target of [
      ".wrangler-e2e",
      ".wrangler-perf",
      ".wrangler-reliability-b",
      ".wrangler-0653",
      ".wrangler-0654-drain",
      ".wrangler-0654-race",
      ".wrangler-transition-audit-20261020-c",
      ".wrangler-transition-audit-20261020-u",
      ".wrangler-transition-audit-20261020-p",
      ".wrangler-transition-audit-20261020-f",
      ".wrangler-transition-audit-20261020-h",
      ".wrangler-transition-audit-20261020-cwd",
    ]) {
      expect(() => assertIsolatedPersist(target, { root })).toThrow("PROTECTED_STATE_FORBIDDEN");
    }
  });

  it("accepts only a newly named run-owned root", () => {
    expect(() => assertIsolatedPersist(".wrangler-safety-20261021-d1/state", { root })).not.toThrow();
    expect(() => assertIsolatedPersist(".wrangler-e2e", { root })).toThrow();
    expect(() => assertIsolatedPersist("some-other-dir/state", { root })).toThrow("AUDIT_ROOT_REQUIRED");
    expect(() => assertIsolatedPersist(path.join(root, "..", "outside"), { root })).toThrow("PERSIST_OUTSIDE_PROJECT");
  });

  it("sanitizes run ids into a deterministic marker root", () => {
    expect(createRunRoot("D1 / Race", root)).toBe(path.join(root, `${RUN_MARKER}d1-race`));
    expect(() => createRunRoot("///", root)).toThrow("RUN_ID_REQUIRED");
  });

  it("the shared browser/worker guard also rejects the developer store", () => {
    expect(isDeveloperStatePath(".wrangler/state")).toBe(true);
    expect(isDeveloperStatePath("C:\\repo\\.wrangler\\state\\v3")).toBe(true);
    expect(isDeveloperStatePath(".wrangler-e2e")).toBe(false);
    expect(() => assertSharedPersist(".wrangler/state")).toThrow("DEVELOPER_STATE_FORBIDDEN");
  });

  it("the CLI fails closed with a non-zero exit code", () => {
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, ["scripts/isolation-guard.mjs", ".wrangler/state"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      status = failure.status ?? 1;
      stderr = failure.stderr ?? "";
    }
    expect(status).toBe(1);
    expect(stderr).toContain("ISOLATION_REFUSED");
    expect(stderr).toContain("PROTECTED_STATE_FORBIDDEN");
  });
});
