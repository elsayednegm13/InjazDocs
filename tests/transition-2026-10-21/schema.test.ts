import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetSchemaReadinessCache } from "../../server/services/schema";
import { createTestHarness } from "./harness/app";
import { count, createAuditDatabase, type AuditDatabase } from "./harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh(upTo: string) {
  const audit = createAuditDatabase({ upTo });
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

describe("schema readiness gate", () => {
  it("a pre-0008 database answers live but refuses mutations with SCHEMA_UPGRADE_REQUIRED", async () => {
    const audit = fresh("0007");
    const harness = createTestHarness(audit);
    const health = await harness.request({ method: "GET", path: "/api/v1/health", actor: null });
    expect(health.status).toBe(503);
    expect((health.json as { data: { schema: string } }).data.schema).toBe("upgrade_required");

    const live = await harness.request({ method: "GET", path: "/api/v1/health/live", actor: null });
    expect(live.status).toBe(200);

    const mutation = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      body: { legalName: "Schema Gate Customer" },
    });
    expect(mutation.status).toBe(503);
    expect((mutation.json as { error: { code: string } }).error.code).toBe("SCHEMA_UPGRADE_REQUIRED");
    expect(count(audit.sqlite, "customers")).toBe(1);
  });

  it("after the additive 0008 migration the same database accepts mutations", async () => {
    const audit = fresh("0007");
    audit.sqlite.exec(
      readFileSync(path.join(process.cwd(), "drizzle", "migrations", "0008_replay_safety_and_import_identity.sql"), "utf8"),
    );
    resetSchemaReadinessCache(audit.db);
    const harness = createTestHarness(audit);
    const health = await harness.request({ method: "GET", path: "/api/v1/health", actor: null });
    expect(health.status).toBe(200);
    expect((health.json as { data: { schema: string } }).data.schema).toBe("ready");
    const mutation = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      body: { legalName: "Schema Gate Customer" },
    });
    expect(mutation.status).toBe(201);
    expect(count(audit.sqlite, "customers")).toBe(2);
  });
});
