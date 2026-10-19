import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("staging preflight", () => {
  it("refuses remote work while env.staging is absent", { timeout: 20_000 }, () => {
    let code = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, ["scripts/staging-preflight.mjs"], { encoding: "utf8" });
    } catch (error) {
      const failed = error as { status?: number; stderr?: string; stdout?: string };
      code = failed.status ?? 1;
      output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
    }
    expect(code).toBe(2);
    expect(output).toContain("CLOUD CHECKPOINT BLOCKED");
    expect(output).not.toMatch(/secret|token|aws/i);
  });
});