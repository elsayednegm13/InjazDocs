import { afterEach, describe, expect, it } from "vitest";
import { hashIdempotentRequest } from "../../server/services/idempotency";
import { ApiRequestError } from "../../src/lib/api";
import { shouldReuseKey } from "../../src/lib/idempotency";
import { createTestHarness } from "./harness/app";
import { count, createAuditDatabase, type AuditDatabase } from "./harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh() {
  const audit = createAuditDatabase();
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function ledger(audit: AuditDatabase, actor: string, key: string) {
  return audit.sqlite
    .prepare("SELECT * FROM idempotency_keys WHERE actor_id = ? AND idempotency_key = ?")
    .get(actor, key) as Record<string, unknown> | undefined;
}

function customer(name: string) {
  return { legalName: name };
}

describe("D1 idempotency durable witness and replay authorization", () => {
  it("D1-01 15 simultaneous same-key writes create one customer and one witness", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-01-simultaneous-key";
    const responses = await Promise.all(
      Array.from({ length: 15 }, () =>
        harness.request({
          method: "POST",
          path: "/api/v1/customers",
          headers: { "idempotency-key": key },
          body: customer("D1-01 Customer"),
        }),
      ),
    );
    expect(responses.every((response) => response.status === 201 || response.status === 409)).toBe(true);
    expect(responses.some((response) => response.status === 201)).toBe(true);
    expect(count(audit.sqlite, "customers")).toBe(2);
    expect(count(audit.sqlite, "idempotency_keys", "actor_id = ? AND idempotency_key = ?", "user-admin", key)).toBe(1);

    const replay = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-01 Customer"),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D1-02 same key with a different body is rejected with no second effect", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-02-body-key";
    const first = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-02 First"),
    });
    expect(first.status).toBe(201);
    const second = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-02 Different"),
    });
    expect(second.status).toBe(422);
    expect((second.json as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D1-03 same key with a different method/path is rejected with no second effect", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-03-path-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          headers: { "idempotency-key": key },
          body: customer("D1-03 Customer"),
        })
      ).status,
    ).toBe(201);
    const otherPath = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases",
      headers: { "idempotency-key": key },
      body: { customerId: "customer-1" },
    });
    expect(otherPath.status).toBe(422);
    expect(count(audit.sqlite, "export_cases")).toBe(1);
  });

  it("D1-04 the same key is scoped to its actor and never replays another actor's body", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-04-actor-key";
    const officer = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: customer("D1-04 Officer"),
    });
    expect(officer.status).toBe(201);
    const admin = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-admin",
      headers: { "idempotency-key": key },
      body: customer("D1-04 Admin"),
    });
    expect(admin.status).toBe(201);
    expect(admin.headers.get("idempotent-replayed")).toBeNull();
    expect(count(audit.sqlite, "customers")).toBe(3);
  });

  it("D1-05 a disabled actor is denied replay and the witness remains", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-05-disabled-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          actor: "user-officer",
          headers: { "idempotency-key": key },
          body: customer("D1-05 Customer"),
        })
      ).status,
    ).toBe(201);
    audit.sqlite.prepare("UPDATE user SET is_active = 0 WHERE id = 'user-officer'").run();
    const denied = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: customer("D1-05 Customer"),
    });
    expect(denied.status).toBe(401);
    expect(ledger(audit, "user-officer", key)?.state).toBe("COMPLETED");
    expect(count(audit.sqlite, "customers")).toBe(2);
    audit.sqlite.prepare("UPDATE user SET is_active = 1 WHERE id = 'user-officer'").run();
    const replay = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: customer("D1-05 Customer"),
    });
    expect(replay.status).toBe(201);
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D1-06 an override edit while still authorized never deletes the witness or duplicates", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-06-override-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          actor: "user-officer",
          headers: { "idempotency-key": key },
          body: customer("D1-06 Customer"),
        })
      ).status,
    ).toBe(201);
    const override = await harness.request({
      method: "POST",
      path: "/api/v1/users/user-officer/overrides",
      actor: "user-admin",
      body: { overrides: [{ permissionKey: "customers.create", effect: "GRANT" }] },
    });
    expect(override.status).toBe(200);
    const replay = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: customer("D1-06 Customer"),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(count(audit.sqlite, "customers")).toBe(2);
    expect(ledger(audit, "user-officer", key)?.state).toBe("COMPLETED");
  });

  it("D1-07 losing and regaining a permission denies the body but keeps the witness", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-07-permission-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          actor: "user-officer",
          headers: { "idempotency-key": key },
          body: customer("D1-07 Customer"),
        })
      ).status,
    ).toBe(201);
    audit.sqlite
      .prepare("DELETE FROM role_permissions WHERE role_id = 'role-officer' AND permission_key = 'customers.create'")
      .run();
    const denied = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: customer("D1-07 Customer"),
    });
    expect(denied.status).toBe(403);
    expect(ledger(audit, "user-officer", key)?.state).toBe("COMPLETED");
    expect(count(audit.sqlite, "customers")).toBe(2);
    audit.sqlite
      .prepare("INSERT INTO role_permissions (role_id, permission_key) VALUES ('role-officer', 'customers.create')")
      .run();
    const replay = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: customer("D1-07 Customer"),
    });
    expect(replay.status).toBe(201);
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D1-08 disable then re-enable never replays while disabled and never duplicates after", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-08-active-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          actor: "user-officer",
          headers: { "idempotency-key": key },
          body: customer("D1-08 Customer"),
        })
      ).status,
    ).toBe(201);
    audit.sqlite.prepare("UPDATE user SET is_active = 0 WHERE id = 'user-officer'").run();
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          actor: "user-officer",
          headers: { "idempotency-key": key },
          body: customer("D1-08 Customer"),
        })
      ).status,
    ).toBe(401);
    audit.sqlite.prepare("UPDATE user SET is_active = 1 WHERE id = 'user-officer'").run();
    const replay = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: customer("D1-08 Customer"),
    });
    expect(replay.status).toBe(201);
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D1-09 losing case scope denies replay and preserves the witness", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-09-case-scope-key";
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/tracking-links",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: {},
    });
    expect(created.status).toBe(201);
    audit.sqlite
      .prepare("UPDATE export_cases SET assigned_to = 'user-outsider', created_by = 'user-outsider' WHERE id = 'case-1'")
      .run();
    const denied = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/tracking-links",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: {},
    });
    expect(denied.status).toBe(403);
    expect(ledger(audit, "user-officer", key)?.state).toBe("COMPLETED");
    expect(count(audit.sqlite, "customer_tracking_links")).toBe(1);
  });

  it("D1-10 a route-specific permission is enforced before cached data is returned", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-10-route-acl-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/export-cases/case-1/tracking-links",
          actor: "user-officer",
          headers: { "idempotency-key": key },
          body: {},
        })
      ).status,
    ).toBe(201);
    audit.sqlite
      .prepare("DELETE FROM role_permissions WHERE role_id = 'role-officer' AND permission_key = 'tracking_links.manage'")
      .run();
    const denied = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/tracking-links",
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: {},
    });
    expect(denied.status).toBe(403);
    expect(count(audit.sqlite, "customer_tracking_links")).toBe(1);
  });

  it("D1-11 response-cache expiry and witness expiry are distinct and bounded", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-11-ttl-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          headers: { "idempotency-key": key },
          body: customer("D1-11 Customer"),
        })
      ).status,
    ).toBe(201);
    audit.sqlite
      .prepare("UPDATE idempotency_keys SET response_expires_at = ? WHERE actor_id = 'user-admin' AND idempotency_key = ?")
      .run(new Date(Date.now() - 1000).toISOString(), key);
    const expired = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-11 Customer"),
    });
    expect(expired.status).toBe(409);
    expect((expired.json as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_RESULT_EXPIRED");
    expect(ledger(audit, "user-admin", key)?.state).toBe("COMPLETED");
    expect(count(audit.sqlite, "customers")).toBe(2);

    audit.sqlite
      .prepare("UPDATE idempotency_keys SET expires_at = ? WHERE actor_id = 'user-admin' AND idempotency_key = ?")
      .run(new Date(Date.now() - 1000).toISOString(), key);
    const afterWitness = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-11 Customer"),
    });
    expect(afterWitness.status).toBe(201);
    expect(afterWitness.headers.get("idempotent-replayed")).toBeNull();
    // This is the documented boundary: the guarantee is bounded, not eternal.
    expect(count(audit.sqlite, "customers")).toBe(3);
  });

  it("D1-12 a witness past its retention window is a new operation, never sold as eternal", async () => {
    const audit = fresh();
    const key = "d1-12-witness-key";
    const now = Date.now();
    await audit.db
      .prepare(
        `INSERT INTO idempotency_keys
           (id, actor_id, idempotency_key, method, path, request_hash, state, status_code, response_body, response_type,
            created_at, updated_at, expires_at, response_expires_at, outcome_class)
         VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 201, '{}', 'application/json', ?, ?, ?, ?, 'COMMITTED')`,
      )
      .bind(
        "d1-12-row",
        "user-admin",
        key,
        "POST",
        "/api/v1/customers",
        await hashIdempotentRequest("POST", "/api/v1/customers", JSON.stringify(customer("D1-12"))),
        new Date(now - 60_000).toISOString(),
        new Date(now - 60_000).toISOString(),
        new Date(now - 1000).toISOString(),
        new Date(now + 60_000).toISOString(),
      )
      .run();
    const harness = createTestHarness(audit);
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-12"),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("idempotent-replayed")).toBeNull();
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D1-13 a failure before business work releases the claim and retry is safe", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-13-pre-handler-key";
    const failed = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key, "x-test-fail-before-handler": "1" },
      body: customer("D1-13 Customer"),
    });
    expect(failed.status).toBe(500);
    expect(ledger(audit, "user-admin", key)).toBeUndefined();
    const retried = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-13 Customer"),
    });
    expect(retried.status).toBe(201);
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D1-14 a commit with no stored response becomes UNKNOWN and is not re-executed", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = "d1-14-unknown-key";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/customers",
          headers: { "idempotency-key": key },
          body: customer("D1-14 Customer"),
        })
      ).status,
    ).toBe(201);
    audit.sqlite
      .prepare(
        `UPDATE idempotency_keys SET state = 'IN_PROGRESS', status_code = NULL, response_body = NULL,
         response_type = NULL, response_expires_at = NULL, updated_at = ? WHERE actor_id = 'user-admin' AND idempotency_key = ?`,
      )
      .run(new Date(Date.now() - 10 * 60 * 1000).toISOString(), key);
    const retry = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-14 Customer"),
    });
    expect(retry.status).toBe(409);
    expect((retry.json as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_RESULT_UNKNOWN");
    expect(count(audit.sqlite, "customers")).toBe(2);
    expect(ledger(audit, "user-admin", key)?.state).toBe("UNKNOWN");
  });

  it("D1-15 an expired IN_PROGRESS lease becomes UNKNOWN without a second execution", async () => {
    const audit = fresh();
    const key = "d1-15-lease-key";
    const body = JSON.stringify(customer("D1-15 Customer"));
    const now = Date.now();
    await audit.db
      .prepare(
        `INSERT INTO idempotency_keys
           (id, actor_id, idempotency_key, method, path, request_hash, state, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?)`,
      )
      .bind(
        "d1-15-row",
        "user-admin",
        key,
        "POST",
        "/api/v1/customers",
        await hashIdempotentRequest("POST", "/api/v1/customers", body),
        new Date(now - 10 * 60 * 1000).toISOString(),
        new Date(now - 10 * 60 * 1000).toISOString(),
        new Date(now + 60 * 60 * 1000).toISOString(),
      )
      .run();
    const harness = createTestHarness(audit);
    const retry = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      headers: { "idempotency-key": key },
      body: customer("D1-15 Customer"),
    });
    expect(retry.status).toBe(409);
    expect((retry.json as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_RESULT_UNKNOWN");
    expect(count(audit.sqlite, "customers")).toBe(1);
    expect(ledger(audit, "user-admin", key)?.state).toBe("UNKNOWN");
  });

  it("D1-16 the client keeps its key for completed-operation and unknown states", () => {
    const error = (status: number, code: string) =>
      new ApiRequestError(status, { error: { code, message: "", requestId: "" } });
    expect(shouldReuseKey(error(409, "IDEMPOTENCY_RESULT_EXPIRED"))).toBe(true);
    expect(shouldReuseKey(error(409, "IDEMPOTENCY_RESULT_UNKNOWN"))).toBe(true);
    expect(shouldReuseKey(error(409, "IDEMPOTENCY_IN_PROGRESS"))).toBe(true);
    expect(shouldReuseKey(error(403, "IDEMPOTENCY_REPLAY_POLICY_MISSING"))).toBe(true);
    expect(shouldReuseKey(error(422, "VALIDATION_ERROR"))).toBe(false);
    expect(shouldReuseKey(error(503, "SCHEMA_UPGRADE_REQUIRED"))).toBe(true);
  });

  it("D1-17 a completed-invoice correction replay keeps one revision and current permission", async () => {
    const audit = fresh();
    audit.sqlite.prepare("UPDATE export_cases SET status = 'COMPLETED' WHERE id = 'case-1'").run();
    const now = new Date().toISOString();
    audit.sqlite
      .prepare(
        `INSERT INTO export_invoices
           (id, case_id, invoice_number, invoice_date, customer_id, payment_term_code, incoterm, incoterms_edition,
            currency, currency_decimals, goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor,
            invoice_total_minor, gross_weight_grams, net_weight_grams, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, 0, 0, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        "invoice-1",
        "case-1",
        "INV-D1-17",
        "2026-10-20",
        "customer-1",
        "TT",
        "FOB",
        "Incoterms 2020",
        "USD",
        100000,
        100000,
        1000,
        900,
        now,
        now,
      );
    const harness = createTestHarness(audit);
    const key = "d1-17-correction-key";
    const correction = {
      invoiceNumber: "INV-D1-17",
      invoiceDate: "2026-10-20",
      paymentTermCode: "TT",
      incoterm: "FOB",
      incotermsEdition: "Incoterms 2020",
      currency: "USD",
      goodsValue: "1000.00",
      invoicedFreight: "0.00",
      actualFreightExpense: "0.00",
      invoiceTotal: "1000.00",
      grossWeight: 1000,
      netWeight: 900,
      weightUnit: "KG",
      version: 1,
      reason: "Correcting a test value",
    };
    const first = await harness.request({
      method: "POST",
      path: "/api/v1/invoices/invoice-1/corrections",
      headers: { "idempotency-key": key },
      body: correction,
    });
    expect(first.status).toBe(200);
    expect(count(audit.sqlite, "invoice_revisions")).toBe(1);
    const replay = await harness.request({
      method: "POST",
      path: "/api/v1/invoices/invoice-1/corrections",
      headers: { "idempotency-key": key },
      body: correction,
    });
    expect(replay.status).toBe(200);
    expect(count(audit.sqlite, "invoice_revisions")).toBe(1);
    audit.sqlite
      .prepare("DELETE FROM role_permissions WHERE role_id = 'role-admin' AND permission_key = 'invoices.correct_completed'")
      .run();
    const denied = await harness.request({
      method: "POST",
      path: "/api/v1/invoices/invoice-1/corrections",
      headers: { "idempotency-key": key },
      body: correction,
    });
    expect(denied.status).toBe(403);
    expect(count(audit.sqlite, "invoice_revisions")).toBe(1);
  });

  it("D1-18 a courier status replay never appends a second tracking event", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/courier",
      actor: "user-officer",
      body: { sender: "COMPANY", carrier: "DHL", trackingNumber: "1234567890" },
    });
    expect(created.status).toBe(201);
    const shipmentId = (created.json as { data: { id: string } }).data.id;
    const key = "d1-18-courier-key";
    const first = await harness.request({
      method: "POST",
      path: `/api/v1/courier/${shipmentId}/status`,
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: { status: "DISPATCHED", version: 1 },
    });
    expect(first.status).toBe(200);
    expect(count(audit.sqlite, "courier_tracking_events")).toBe(1);
    const replay = await harness.request({
      method: "POST",
      path: `/api/v1/courier/${shipmentId}/status`,
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: { status: "DISPATCHED", version: 1 },
    });
    expect(replay.status).toBe(200);
    expect(count(audit.sqlite, "courier_tracking_events")).toBe(1);
    audit.sqlite
      .prepare("DELETE FROM role_permissions WHERE role_id = 'role-officer' AND permission_key = 'courier.manage'")
      .run();
    const denied = await harness.request({
      method: "POST",
      path: `/api/v1/courier/${shipmentId}/status`,
      actor: "user-officer",
      headers: { "idempotency-key": key },
      body: { status: "DISPATCHED", version: 1 },
    });
    expect(denied.status).toBe(403);
    expect(count(audit.sqlite, "courier_tracking_events")).toBe(1);
  });
});
