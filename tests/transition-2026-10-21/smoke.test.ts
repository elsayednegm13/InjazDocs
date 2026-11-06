import { afterEach, describe, expect, it } from "vitest";
import { count, createAuditDatabase, type AuditDatabase } from "./harness/db";
import { createTestHarness } from "./harness/app";

let audit: AuditDatabase | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

describe("ET-2026-10-21 harness smoke", () => {
  it("serves readiness and replays one customer without a second effect", async () => {
    audit = createAuditDatabase();
    const harness = createTestHarness(audit);

    const health = await harness.request({ path: "/api/v1/health" });
    expect(health.status).toBe(200);
    expect((health.json as { data: { schema: string } }).data.schema).toBe("ready");

    const key = "smoke-key-0001";
    const first = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: { legalName: "Smoke Customer" },
    });
    expect(first.status).toBe(201);
    expect(count(audit.sqlite, "customers")).toBe(2);

    const replay = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: { legalName: "Smoke Customer" },
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(count(audit.sqlite, "customers")).toBe(2);
  });
});
