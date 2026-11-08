import { afterEach, describe, expect, it } from "vitest";
import { canCompleteCase } from "../../server/domain/case-completion";
import { recordCompensationIncident } from "../../server/services/compensation";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { count, createAuditDatabase, type AuditDatabase } from "../transition-2026-10-21/harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh() {
  const audit = createAuditDatabase();
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

const closeBase = {
  status: "ACTIVE" as const,
  route: "BANK_ROUTE" as const,
  bankStatus: "DOCUMENTS_DELIVERED" as const,
  directStatus: null,
  requirements: [{ required: 1, status: "APPROVED" }],
  exceptionReason: null,
  hasClosePermission: true,
};

const delivered = { status: "DELIVERED_TO_CUSTOMER" as const };

function uploadSession(audit: AuditDatabase, requirementId: string, actor = "user-admin", key = "synthetic/doc/v1.pdf") {
  const now = new Date().toISOString();
  audit.sqlite
    .prepare(
      `INSERT INTO upload_sessions (id, object_key, parent_type, parent_id, owner_user_id, filename, expected_bytes, mime, state, expires_at, created_at)
       VALUES (?, ?, 'document_requirement', ?, ?, 'synthetic.pdf', 1024, 'application/pdf', 'COMPLETED', ?, ?)`,
    )
    .run(`us-${key}`, key, requirementId, actor, now, now);
  return key;
}

describe("W1 GAP-01 normal closure requires every expected container", () => {
  it("W1-01 blocks a 4/5 case even when the remaining documents and goods track look complete", () => {
    const decision = canCompleteCase({
      ...closeBase,
      containers: [delivered, delivered, delivered, delivered],
      expectedContainerCount: 5,
      deliveredContainerCount: 4,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("CONTAINERS_NOT_ALL_DELIVERED");
  });

  it("W1-02 a cancelled slot is not a delivered slot: 4 delivered + 1 cancelled is still 4/5", () => {
    const decision = canCompleteCase({
      ...closeBase,
      containers: [delivered, delivered, delivered, delivered, { status: "CANCELLED" }],
      expectedContainerCount: 5,
      deliveredContainerCount: 4,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("CONTAINERS_NOT_ALL_DELIVERED");
  });

  it("W1-03 allows completion only at 5/5", () => {
    const decision = canCompleteCase({
      ...closeBase,
      containers: [delivered, delivered, delivered, delivered, delivered],
      expectedContainerCount: 5,
      deliveredContainerCount: 5,
    });
    expect(decision).toEqual({ ok: true });
  });

  it("W1-04 an authorized exception remains the only bypass and is still permission gated", () => {
    const withoutPermission = canCompleteCase({
      ...closeBase,
      exceptionReason: "owner approved",
      hasClosePermission: false,
      containers: [delivered],
      expectedContainerCount: 5,
      deliveredContainerCount: 1,
    });
    expect(withoutPermission.ok).toBe(false);
    const withPermission = canCompleteCase({
      ...closeBase,
      exceptionReason: "owner approved",
      containers: [delivered],
      expectedContainerCount: 5,
      deliveredContainerCount: 1,
    });
    expect(withPermission).toEqual({ ok: true });
  });
});

describe("W1 GAP-05 closure never lowers the bar through expected_containers", () => {
  it("W1-05 an edited plan below the physical slot count cannot close the case", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite.prepare("UPDATE operation_document_requirements SET status = 'APPROVED' WHERE id = 'requirement-1'").run();
    audit.sqlite.prepare("UPDATE export_cases SET bank_path_status = 'DOCUMENTS_DELIVERED' WHERE id = 'case-1'").run();
    audit.sqlite
      .prepare(
        `INSERT INTO bookings (id, case_id, booking_number, ucr, expected_containers, status, version, created_at, updated_at)
         VALUES ('booking-w1', 'case-1', 'BKG-W1-0001', 'UCR-W1-1', 5, 'CONFIRMED', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    for (let i = 1; i <= 5; i += 1) {
      audit.sqlite
        .prepare(
          `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
           VALUES (?, 'booking-w1', 'case-1', ?, ?, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
        )
        .run(`container-w1-${i}`, i, i <= 4 ? "DELIVERED_TO_CUSTOMER" : "ARRIVED_PORT");
    }
    // A client tries to lower the plan to 4 while five physical slots still exist.
    audit.sqlite.prepare("UPDATE bookings SET expected_containers = 4 WHERE id = 'booking-w1'").run();

    const response = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/status",
      body: { to: "COMPLETED", version: 1 },
    });
    expect(response.status).toBe(409);
    expect(response.text).toContain("CONTAINERS_NOT_ALL_DELIVERED");
    expect(
      (audit.sqlite.prepare("SELECT status FROM export_cases WHERE id = 'case-1'").get() as { status: string }).status,
    ).toBe("ACTIVE");
  });

  it("W1-06 the same case closes when all five physical slots are delivered", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite.prepare("UPDATE operation_document_requirements SET status = 'APPROVED' WHERE id = 'requirement-1'").run();
    audit.sqlite.prepare("UPDATE export_cases SET bank_path_status = 'DOCUMENTS_DELIVERED' WHERE id = 'case-1'").run();
    audit.sqlite
      .prepare(
        `INSERT INTO bookings (id, case_id, booking_number, ucr, expected_containers, status, version, created_at, updated_at)
         VALUES ('booking-w1', 'case-1', 'BKG-W1-0001', 'UCR-W1-1', 5, 'CONFIRMED', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    for (let i = 1; i <= 5; i += 1) {
      audit.sqlite
        .prepare(
          `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
           VALUES (?, 'booking-w1', 'case-1', ?, 'DELIVERED_TO_CUSTOMER', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
        )
        .run(`container-w1-${i}`, i);
    }
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/status",
      body: { to: "COMPLETED", version: 1 },
    });
    expect(response.status).toBe(200);
    expect(
      (audit.sqlite.prepare("SELECT status FROM export_cases WHERE id = 'case-1'").get() as { status: string }).status,
    ).toBe("COMPLETED");
  });

  it("customer acceptance does not block the same closure", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite.prepare("UPDATE operation_document_requirements SET status = 'APPROVED' WHERE id = 'requirement-1'").run();
    audit.sqlite.prepare("UPDATE export_cases SET bank_path_status = 'DOCUMENTS_DELIVERED' WHERE id = 'case-1'").run();
    audit.sqlite
      .prepare(
        `INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at)
         VALUES ('version-open', 'requirement-1', 1, 'synthetic/open.pdf', 'open.pdf', 'application/pdf', 100, 'user-admin', 'UPLOADED', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    audit.sqlite
      .prepare(
        `INSERT INTO customer_file_shares (id, version_id, case_id, published_at, published_by, created_at, updated_at)
         VALUES ('share-open', 'version-open', 'case-1', '2026-10-01T00:00:00.000Z', 'user-admin', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    audit.sqlite
      .prepare(
        `INSERT INTO bookings (id, case_id, booking_number, ucr, expected_containers, status, version, created_at, updated_at)
         VALUES ('booking-w1', 'case-1', 'BKG-W1-0001', 'UCR-W1-1', 5, 'CONFIRMED', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    for (let i = 1; i <= 5; i += 1) {
      audit.sqlite
        .prepare(
          `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
           VALUES (?, 'booking-w1', 'case-1', ?, 'DELIVERED_TO_CUSTOMER', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
        )
        .run(`container-w1-${i}`, i);
    }
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/status",
      body: { to: "COMPLETED", version: 1 },
    });
    expect(response.status).toBe(200);
    expect(
      (audit.sqlite.prepare("SELECT status FROM export_cases WHERE id = 'case-1'").get() as { status: string }).status,
    ).toBe("COMPLETED");
    expect(
      (audit.sqlite.prepare("SELECT decision FROM customer_file_shares WHERE id = 'share-open'").get() as { decision: string | null }).decision,
    ).toBeNull();
  });
});

describe("W1 GAP-02 a new version never inherits the previous approval", () => {
  it("W1-07 attaching a file to an APPROVED requirement returns it to UPLOADED and keeps history", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite.prepare("UPDATE operation_document_requirements SET status = 'APPROVED' WHERE id = 'requirement-1'").run();
    audit.sqlite
      .prepare(
        `INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at)
         VALUES ('version-old', 'requirement-1', 1, 'synthetic/old.pdf', 'old.pdf', 'application/pdf', 100, 'user-admin', 'APPROVED', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    audit.sqlite
      .prepare(
        `INSERT INTO document_reviews (id, version_id, reviewer_id, decision, comment, created_at)
         VALUES ('review-old', 'version-old', 'user-admin', 'APPROVED', 'synthetic', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    const key = uploadSession(audit, "requirement-1");

    const response = await harness.request({
      method: "POST",
      path: "/api/v1/document-requirements/requirement-1/versions",
      body: { r2Key: key, originalName: "new.pdf", contentType: "application/pdf", byteSize: 1024 },
    });
    expect(response.status).toBe(201);
    const requirement = audit.sqlite
      .prepare("SELECT status FROM operation_document_requirements WHERE id = 'requirement-1'")
      .get() as { status: string };
    expect(requirement.status).toBe("UPLOADED");
    expect(count(audit.sqlite, "document_versions", "requirement_id = 'requirement-1'")).toBe(2);
    expect(count(audit.sqlite, "document_reviews", "version_id = 'version-old'")).toBe(1);
  });

  it("W1-08 the approved version itself is untouched and still recorded as approved", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite.prepare("UPDATE operation_document_requirements SET status = 'APPROVED' WHERE id = 'requirement-1'").run();
    audit.sqlite
      .prepare(
        `INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at)
         VALUES ('version-old', 'requirement-1', 1, 'synthetic/old.pdf', 'old.pdf', 'application/pdf', 100, 'user-admin', 'APPROVED', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    const key = uploadSession(audit, "requirement-1");
    await harness.request({
      method: "POST",
      path: "/api/v1/document-requirements/requirement-1/versions",
      body: { r2Key: key, originalName: "new.pdf", contentType: "application/pdf", byteSize: 1024 },
    });
    const old = audit.sqlite
      .prepare("SELECT review_state FROM document_versions WHERE id = 'version-old'")
      .get() as { review_state: string };
    expect(old.review_state).toBe("APPROVED");
  });
});

describe("W1-CLOSE the review decision is recorded on the latest version", () => {
  it("W1-20 approving a version updates document_versions.review_state and keeps the review history", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const key = uploadSession(audit, "requirement-1");
    const attached = await harness.request({
      method: "POST",
      path: "/api/v1/document-requirements/requirement-1/versions",
      body: { r2Key: key, originalName: "review.pdf", contentType: "application/pdf", byteSize: 1024 },
    });
    expect(attached.status).toBe(201);
    const version = audit.sqlite
      .prepare("SELECT id FROM document_versions WHERE requirement_id = 'requirement-1'")
      .get() as { id: string };

    const underReview = await harness.request({
      method: "POST",
      path: "/api/v1/document-requirements/requirement-1/review",
      body: { decision: "UNDER_REVIEW" },
    });
    expect(underReview.status).toBe(200);
    const approved = await harness.request({
      method: "POST",
      path: "/api/v1/document-requirements/requirement-1/review",
      body: { decision: "APPROVED" },
    });
    expect(approved.status).toBe(200);

    const row = audit.sqlite
      .prepare("SELECT review_state FROM document_versions WHERE id = ?")
      .get(version.id) as { review_state: string };
    expect(row.review_state).toBe("APPROVED");
    expect(count(audit.sqlite, "document_reviews", "version_id = ?", version.id)).toBe(2);
    const requirement = audit.sqlite
      .prepare("SELECT status FROM operation_document_requirements WHERE id = 'requirement-1'")
      .get() as { status: string };
    expect(requirement.status).toBe("APPROVED");
  });
});

describe("W1 GAP-03 requirement deletion is guarded inside the DELETE", () => {
  it("W1-09 an unused requirement can be deleted", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite
      .prepare(
        `INSERT INTO document_type_definitions (id, key, name_en, name_ar, active)
         VALUES ('dt-w1-unused', 'w1_unused', 'Unused', 'غير مستخدم', 1)`,
      )
      .run();
    audit.sqlite
      .prepare(
        `INSERT INTO operation_document_requirements (id, case_id, document_type_id, required, status, created_at, updated_at)
         VALUES ('requirement-unused', 'case-1', 'dt-w1-unused', 0, 'MISSING', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    const response = await harness.request({ method: "DELETE", path: "/api/v1/document-requirements/requirement-unused" });
    expect(response.status).toBe(200);
    expect(count(audit.sqlite, "operation_document_requirements", "id = 'requirement-unused'")).toBe(0);
  });

  it("W1-10 a requirement with versions is rejected and its history survives", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite
      .prepare(
        `INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at)
         VALUES ('version-keep', 'requirement-1', 1, 'synthetic/keep.pdf', 'keep.pdf', 'application/pdf', 100, 'user-admin', 'UPLOADED', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    const response = await harness.request({ method: "DELETE", path: "/api/v1/document-requirements/requirement-1" });
    expect(response.status).toBe(409);
    expect(response.text).toContain("REQUIREMENT_HAS_VERSIONS");
    expect(count(audit.sqlite, "operation_document_requirements", "id = 'requirement-1'")).toBe(1);
    expect(count(audit.sqlite, "document_versions", "id = 'version-keep'")).toBe(1);
  });

  it("W1-11 the guard is part of the single DELETE statement, not a pre-check", async () => {
    const audit = fresh();
    const statements: string[] = [];
    const proxy = new Proxy(audit.db, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            statements.push(sql);
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, property);
      },
    });
    const harness = createTestHarness({ ...audit, db: proxy as AuditDatabase["db"] });
    await harness.request({ method: "DELETE", path: "/api/v1/document-requirements/requirement-1" });
    const deleteStatement = statements.find((sql) => sql.trim().toUpperCase().startsWith("DELETE FROM OPERATION_DOCUMENT_REQUIREMENTS"));
    expect(deleteStatement).toBeDefined();
    expect(deleteStatement?.toUpperCase()).toContain("NOT EXISTS");
    expect(deleteStatement?.toUpperCase()).toContain("DOCUMENT_VERSIONS");
  });
});

describe("W1 GAP-04 a booking cannot be confirmed without an active UCR", () => {
  it("W1-12 a draft booking without a UCR is allowed, confirmation without one is rejected", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/bookings",
      body: { caseId: "case-1", bookingNumber: "BKG-W1-UCR", expectedContainers: 1 },
    });
    expect(created.status).toBe(201);
    const bookingId = (created.json as { data: { id: string } }).data.id;
    const row = audit.sqlite.prepare("SELECT status, ucr FROM bookings WHERE id = ?").get(bookingId) as {
      status: string;
      ucr: string | null;
    };
    expect(row.status).toBe("DRAFT");
    expect(row.ucr).toBeNull();

    const blocked = await harness.request({
      method: "PUT",
      path: `/api/v1/bookings/${bookingId}`,
      body: { bookingNumber: "BKG-W1-UCR", expectedContainers: 1, status: "CONFIRMED", version: 1 },
    });
    expect(blocked.status).toBe(422);
    expect(blocked.text).toContain("BOOKING_UCR_REQUIRED");
    expect(
      (audit.sqlite.prepare("SELECT status FROM bookings WHERE id = ?").get(bookingId) as { status: string }).status,
    ).toBe("DRAFT");

    const confirmed = await harness.request({
      method: "PUT",
      path: `/api/v1/bookings/${bookingId}`,
      body: { bookingNumber: "BKG-W1-UCR", ucr: "UCR-W1-OK", expectedContainers: 1, status: "CONFIRMED", version: 1 },
    });
    expect(confirmed.status).toBe(200);
    expect(
      (audit.sqlite.prepare("SELECT status FROM bookings WHERE id = ?").get(bookingId) as { status: string }).status,
    ).toBe("CONFIRMED");
  });

  it("W1-13 a confirmed booking cannot have its UCR silently cleared", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/bookings",
      body: { caseId: "case-1", bookingNumber: "BKG-W1-UCR2", ucr: "UCR-W1-KEEP", expectedContainers: 1 },
    });
    const bookingId = (created.json as { data: { id: string } }).data.id;
    await harness.request({
      method: "PUT",
      path: `/api/v1/bookings/${bookingId}`,
      body: { bookingNumber: "BKG-W1-UCR2", ucr: "UCR-W1-KEEP", expectedContainers: 1, status: "CONFIRMED", version: 1 },
    });
    const cleared = await harness.request({
      method: "PUT",
      path: `/api/v1/bookings/${bookingId}`,
      body: { bookingNumber: "BKG-W1-UCR2", expectedContainers: 1, status: "CONFIRMED", version: 2 },
    });
    expect(cleared.status).toBe(422);
    expect(cleared.text).toContain("BOOKING_UCR_REQUIRED");
    expect(
      (audit.sqlite.prepare("SELECT ucr FROM bookings WHERE id = ?").get(bookingId) as { ucr: string }).ucr,
    ).toBe("UCR-W1-KEEP");
  });
});

describe("W1 GAP-08 last root administrator protection is atomic", () => {
  async function createAdmin(audit: AuditDatabase, harness: ReturnType<typeof createTestHarness>, email: string) {
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/users",
      body: { email, name: "Second Root", password: "temporary-pass-123", roleKeys: ["administrator"] },
    });
    expect(created.status).toBe(201);
    return (created.json as { data: { id: string } }).data.id;
  }

  it("W1-14 the last active root admin cannot be disabled", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const response = await harness.request({ method: "POST", path: "/api/v1/users/user-admin/active", body: { active: false } });
    expect(response.status).toBe(409);
    expect(response.text).toContain("LAST_ADMIN");
    expect(
      (audit.sqlite.prepare("SELECT is_active FROM user WHERE id = 'user-admin'").get() as { is_active: number }).is_active,
    ).toBe(1);
  });

  it("W1-15 a second root admin can be disabled, then the remaining one is protected", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const second = await createAdmin(audit, harness, "root2@example.invalid");
    const first = await harness.request({ method: "POST", path: `/api/v1/users/${second}/active`, body: { active: false } });
    expect(first.status).toBe(200);
    const secondAttempt = await harness.request({ method: "POST", path: "/api/v1/users/user-admin/active", body: { active: false } });
    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.text).toContain("LAST_ADMIN");
  });

  it("W1-16 two concurrent disables leave at least one active root admin", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const a = await createAdmin(audit, harness, "root-a@example.invalid");
    const b = await createAdmin(audit, harness, "root-b@example.invalid");
    const results = await Promise.all([
      harness.request({ method: "POST", path: `/api/v1/users/${a}/active`, body: { active: false } }),
      harness.request({ method: "POST", path: `/api/v1/users/${b}/active`, body: { active: false } }),
      harness.request({ method: "POST", path: "/api/v1/users/user-admin/active", body: { active: false } }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200).length).toBe(2);
    expect(statuses.filter((s) => s === 409).length).toBe(1);
    const activeRoots = audit.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM user u
          WHERE u.is_active = 1
            AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                        WHERE ur.user_id = u.id AND rp.permission_key = 'users.manage')
            AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                        WHERE ur.user_id = u.id AND rp.permission_key = 'roles.manage')`,
      )
      .get() as { n: number };
    expect(activeRoots.n).toBe(1);
  });
});

describe("W1 GAP-09 a failed incident store is reported, not hidden", () => {
  it("W1-17 returns persisted:false and still yields a correlation id", async () => {
    const broken = {
      prepare() {
        throw new Error("induced incident store failure");
      },
    } as unknown as D1Database;
    const result = await recordCompensationIncident(broken, {
      operation: "USER_CREATE",
      stage: "W1_INDUCED",
      detail: "synthetic",
    });
    expect(result.persisted).toBe(false);
    expect(result.correlationId.length).toBeGreaterThan(10);
  });

  it("W1-18 a healthy store reports persisted:true and writes one redacted row", async () => {
    const audit = fresh();
    const result = await recordCompensationIncident(audit.db, {
      operation: "USER_CREATE",
      stage: "W1_HEALTHY",
      detail: "synthetic",
    });
    expect(result.persisted).toBe(true);
    const row = audit.sqlite
      .prepare("SELECT correlation_id, operation, stage FROM auth_compensation_incidents WHERE correlation_id = ?")
      .get(result.correlationId) as { correlation_id: string; operation: string; stage: string };
    expect(row.operation).toBe("USER_CREATE");
    expect(row.stage).toBe("W1_HEALTHY");
  });
});
