import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { count, createW2Database, type W2Database } from "./harness/db";

/**
 * U01 — D-01/D-04 permission matrix (owner-approved, no inheritance from
 * invoices/cases): the seven quotation keys exist, are granted explicitly per
 * role, and reads/mutations refuse every actor outside its row.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

describe("U01 quotation permission matrix", () => {
  it("seeds the seven keys and the explicit role grants", async () => {
    audit = createW2Database();
    for (const key of ["quotations.view", "quotations.create", "quotations.edit", "quotations.issue", "quotations.record_response", "quotations.export", "quotations.view_all"]) {
      expect(count(audit.sqlite, "permissions", "key = ?", key), key).toBe(1);
    }
    // admin and operations_manager hold all seven keys.
    expect(
      count(
        audit.sqlite,
        "role_permissions",
        "permission_key LIKE 'quotations.%' AND role_id IN (SELECT id FROM roles WHERE key IN ('administrator','operations_manager'))",
      ),
    ).toBe(14);
    // export_officer holds view/create/edit/issue/export — exactly five.
    expect(
      count(
        audit.sqlite,
        "role_permissions",
        "permission_key LIKE 'quotations.%' AND role_id = (SELECT id FROM roles WHERE key = 'export_officer')",
      ),
    ).toBe(5);
    expect(
      count(
        audit.sqlite,
        "role_permissions",
        "permission_key = 'quotations.record_response' AND role_id = (SELECT id FROM roles WHERE key = 'export_officer')",
      ),
    ).toBe(0);
    // viewer holds exactly quotations.view.
    expect(
      count(
        audit.sqlite,
        "role_permissions",
        "permission_key LIKE 'quotations.%' AND role_id = (SELECT id FROM roles WHERE key = 'viewer')",
      ),
    ).toBe(1);
  });

  it("serves the list only to actors holding quotations.view", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const admin = await harness.request({ path: "/api/v1/quotations", actor: "user-admin" });
    expect(admin.status).toBe(200);
    expect((admin.json as { data: { rows: unknown[]; total: number } }).data.rows).toEqual([]);

    const viewer = await harness.request({ path: "/api/v1/quotations", actor: "user-viewer" });
    expect(viewer.status).toBe(200);

    const outsider = await harness.request({ path: "/api/v1/quotations", actor: "user-outsider" });
    expect(outsider.status).toBe(403);
  });

  it("refuses create to actors without quotations.create regardless of case scope", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    for (const actor of ["user-viewer", "user-outsider"]) {
      const refused = await harness.request({
        method: "POST",
        path: "/api/v1/quotations",
        actor,
        body: {
          quoteNumber: "QU-REFUSED",
          customerId: "customer-1",
          items: [{ description: "Refused item", quantity: "1", unitPrice: "1" }],
        },
      });
      expect(refused.status, actor).toBe(403);
    }

    const missingPermissionRow = await harness.request({
      method: "GET",
      path: "/api/v1/quotations.csv",
      actor: "user-viewer",
    });
    expect(missingPermissionRow.status).toBe(403);
  });

  it("fails closed on the schema probe when 0010 is missing", async () => {
    audit = createW2Database({ upTo: "0009" });
    const harness = createTestHarness(audit);

    const refused = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-OLDSTORE",
        customerId: "customer-1",
        items: [{ description: "Old store item", quantity: "1", unitPrice: "1" }],
      },
    });
    expect(refused.status).toBe(503);
    expect((refused.json as { error: { code: string } }).error.code).toBe("SCHEMA_UPGRADE_REQUIRED");
  });
});
