import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "../server/auth";
import { createTestHarness } from "./transition-2026-10-21/harness/app";
import { createAuditDatabase, type AuditDatabase } from "./transition-2026-10-21/harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh() {
  const audit = createAuditDatabase();
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

describe("batch B guards", () => {
  it("rejects a short or missing session secret before building auth", () => {
    expect(() => createAuth({ BETTER_AUTH_SECRET: "" } as Env)).toThrow(/32 characters/);
    expect(() => createAuth({ BETTER_AUTH_SECRET: "test-only-better-auth-secret" } as Env)).toThrow(/32 characters/);
  });

  it("rejects a mutation that omits Origin", async () => {
    const harness = createTestHarness(fresh());
    const missing = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      omitOrigin: true,
      body: { legalName: "Origin check" },
    });
    expect(missing.status).toBe(403);
    expect((missing.json as { error: { code: string } }).error.code).toBe("USER_NOT_AUTHORIZED");
  });

  it("a test header does not open the batch probe", async () => {
    const harness = createTestHarness(fresh());
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/__test/d1-batch-probe",
      actor: null,
      headers: { "x-exportflow-fault": "d1-batch-probe" },
      body: { size: 1 },
    });
    expect(response.status).toBe(404);
  });
});
