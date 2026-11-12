import { afterEach, describe, expect, it } from "vitest";
import { filterSortPaginateList } from "../src/components/ui/list-toolbar";
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

describe("Phase 2 UX Velocity — Global Spotlight Search, Quick Scope & One-Click Clone", () => {
  it("computes quickScope counts and filters active vs archived items in filterSortPaginateList", () => {
    const rows = [
      { id: "c-1", case_reference: "EF-2026-0001", status: "DRAFT", created_at: "2026-05-01T10:00:00Z" },
      { id: "c-2", case_reference: "EF-2026-0002", status: "ACTIVE", created_at: "2026-05-02T10:00:00Z" },
      { id: "c-3", case_reference: "EF-2026-0003", status: "READY_FOR_CLOSE", created_at: "2026-05-03T10:00:00Z" },
      { id: "c-4", case_reference: "EF-2026-0004", status: "COMPLETED", created_at: "2026-05-04T10:00:00Z" },
      { id: "c-5", case_reference: "EF-2026-0005", status: "CANCELLED", created_at: "2026-05-05T10:00:00Z" },
    ];

    const activeRes = filterSortPaginateList(
      rows,
      { search: "", status: "", year: "", month: "", sortOrder: "desc", page: 1, scope: "active" },
      { isArchivedStatus: (st) => ["COMPLETED", "CANCELLED", "ARCHIVED"].includes(st) },
      2026,
    );
    expect(activeRes.scopeCounts).toEqual({ all: 5, active: 3, archive: 2 });
    expect(activeRes.totalFiltered).toBe(3);
    expect(activeRes.pagedRows.map((r) => r.id)).toEqual(["c-3", "c-2", "c-1"]);
    expect(activeRes.activeFilterCount).toBe(1);

    const archiveRes = filterSortPaginateList(
      rows,
      { search: "", status: "", year: "", month: "", sortOrder: "desc", page: 1, scope: "archive" },
      { isArchivedStatus: (st) => ["COMPLETED", "CANCELLED", "ARCHIVED"].includes(st) },
      2026,
    );
    expect(archiveRes.scopeCounts).toEqual({ all: 5, active: 3, archive: 2 });
    expect(archiveRes.totalFiltered).toBe(2);
    expect(archiveRes.pagedRows.map((r) => r.id)).toEqual(["c-5", "c-4"]);
  });

  it("enforces RBAC permissions and case visibility scope on GET /api/v1/search", async () => {
    const audit = fresh();
    const now = "2026-11-12T10:00:00.000Z";

    // Create a second officer and an unassigned case-2 that user-officer cannot access
    audit.sqlite
      .prepare(
        `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, must_change_password, is_active)
         VALUES ('user-other', 'Other Officer', 'other@example.invalid', 1, ?, ?, 0, 1)`,
      )
      .run(Date.now(), Date.now());
    audit.sqlite.prepare("INSERT INTO user_roles (user_id, role_id) VALUES ('user-other', 'role-officer')").run();

    audit.sqlite
      .prepare(
        `INSERT INTO export_cases
           (id, case_reference, customer_id, status, document_route, bank_path_status, direct_path_status,
            assigned_to, destination_country, version, created_at, updated_at, created_by)
         VALUES ('case-2', 'EF-SECRET-999', 'customer-1', 'ACTIVE', 'DIRECT_ROUTE', 'NOT_REQUIRED', 'PREPARING',
            'user-other', 'DE', 1, ?, ?, 'user-other')`,
      )
      .run(now, now);

    // Seed bookings, containers, and proformas for case-1 (assigned to user-officer) and case-2 (assigned to user-other)
    audit.sqlite
      .prepare(
        `INSERT INTO bookings (id, case_id, booking_number, status, version, created_at, updated_at)
         VALUES ('bkg-1', 'case-1', 'BKG-ALPHA-101', 'CONFIRMED', 1, ?, ?),
                ('bkg-2', 'case-2', 'BKG-ALPHA-999', 'CONFIRMED', 1, ?, ?)`,
      )
      .run(now, now, now, now);

    audit.sqlite
      .prepare(
        `INSERT INTO containers (id, booking_id, case_id, slot_index, official_number, status, version, created_at, updated_at)
         VALUES ('cnt-1', 'bkg-1', 'case-1', 1, 'MSCU1010101', 'LOADED', 1, ?, ?),
                ('cnt-2', 'bkg-2', 'case-2', 1, 'MSCU9999999', 'LOADED', 1, ?, ?)`,
      )
      .run(now, now, now, now);

    audit.sqlite
      .prepare(
        `INSERT INTO proforma_invoices
           (id, customer_id, case_id, invoice_number, invoice_date, payment_term_code, incoterm, currency, status, version, created_at, updated_at)
         VALUES ('pf-1', 'customer-1', 'case-1', 'PI-ALPHA-101', '2026-11-12', 'TT', 'FOB', 'USD', 'DRAFT', 1, ?, ?),
                ('pf-2', 'customer-1', 'case-2', 'PI-ALPHA-999', '2026-11-12', 'TT', 'FOB', 'USD', 'DRAFT', 1, ?, ?)`,
      )
      .run(now, now, now, now);

    const harness = createTestHarness(audit);

    // 1. Short query (< 2 chars) returns empty without hitting DB
    const shortRes = await harness.request({
      method: "GET",
      path: "/api/v1/search?q=E",
      actor: "user-officer",
    });
    expect(shortRes.status).toBe(200);
    const shortData = (shortRes.json as { data: Record<string, unknown[]> }).data;
    expect(shortData.cases).toEqual([]);
    expect(shortData.bookings).toEqual([]);

    // 2. Officer searches for "ALPHA" -> sees bkg-1 and pf-1 (on case-1), but NOT bkg-2 or pf-2 (on case-2)
    const officerAlpha = await harness.request({
      method: "GET",
      path: "/api/v1/search?q=ALPHA",
      actor: "user-officer",
    });
    expect(officerAlpha.status).toBe(200);
    const officerData = (officerAlpha.json as {
      data: {
        bookings: Array<{ id: string }>;
        proformas: Array<{ id: string }>;
      };
    }).data;
    expect(officerData.bookings.map((b) => b.id)).toEqual(["bkg-1"]);
    expect(officerData.proformas.map((p) => p.id)).toEqual(["pf-1"]);

    // 3. Admin searches for "ALPHA" -> has export_cases.view_all, so sees both bkg-1 & bkg-2 and pf-1 & pf-2
    const adminAlpha = await harness.request({
      method: "GET",
      path: "/api/v1/search?q=ALPHA",
      actor: "user-admin",
    });
    expect(adminAlpha.status).toBe(200);
    const adminData = (adminAlpha.json as {
      data: {
        bookings: Array<{ id: string }>;
        proformas: Array<{ id: string }>;
      };
    }).data;
    expect(adminData.bookings.map((b) => b.id).sort()).toEqual(["bkg-1", "bkg-2"]);
    expect(adminData.proformas.map((p) => p.id).sort()).toEqual(["pf-1", "pf-2"]);

    // 4. Deny customers.view on user-officer via user_permission_overrides -> customers array is empty
    audit.sqlite
      .prepare(
        `INSERT INTO user_permission_overrides (user_id, permission_key, effect)
         VALUES ('user-officer', 'customers.view', 'DENY')`,
      )
      .run();
    const deniedCust = await harness.request({
      method: "GET",
      path: "/api/v1/search?q=Existing",
      actor: "user-officer",
    });
    expect(deniedCust.status).toBe(200);
    expect((deniedCust.json as { data: { customers: unknown[] } }).data.customers).toEqual([]);

    const custSearch = await harness.request({
      method: "GET",
      path: "/api/v1/search?q=Existing",
      actor: "user-viewer",
    });
    expect(custSearch.status).toBe(200);
    const viewerData = (custSearch.json as {
      data: {
        customers: Array<{ id: string }>;
        cases: Array<{ id: string }>;
      };
    }).data;
    expect(viewerData.customers.map((c) => c.id)).toEqual(["customer-1"]);
    // user-viewer is not assigned to case-1 or case-2
    expect(viewerData.cases).toEqual([]);
  });

  it("clones an export case into a clean DRAFT with live customer snapshot, copied invoice + lines, and zeroed statuses/stamps/bookings", async () => {
    const audit = fresh();
    const now = "2026-11-12T10:00:00.000Z";

    // Update customer-1 live legal_name to verify the clone captures the LIVE customer profile
    audit.sqlite
      .prepare("UPDATE customers SET legal_name = 'Updated Live Customer Ltd' WHERE id = 'customer-1'")
      .run();

    // Mark case-1 requirement as APPROVED
    audit.sqlite
      .prepare("UPDATE operation_document_requirements SET status = 'APPROVED' WHERE id = 'requirement-1'")
      .run();

    // Add an ISSUED & stamped commercial invoice with lines, a booking, and a container on case-1
    audit.sqlite
      .prepare(
        `INSERT INTO export_invoices
           (id, case_id, invoice_number, invoice_date, customer_id, port_of_loading, port_of_discharge, destination_country,
            payment_term_code, payment_term_details, payment_term_label, shipping_method_label, origin_of_goods,
            incoterm, incoterms_edition, named_place, currency, currency_decimals,
            goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor, invoice_total_minor,
            gross_weight_grams, net_weight_grams, packages_count, trade_status, trade_revision,
            is_stamped, packing_is_stamped, edit_open, print_reference, print_fields_json, version, created_at, updated_at)
         VALUES
           ('inv-src-1', 'case-1', 'INV-2026-500', '2026-01-15', 'customer-1', 'Alexandria', 'Rotterdam', 'NL',
            'LC', 'Irrevocable LC', '100% L/C AT SIGHT', 'CFR', 'EGYPT',
            'CFR', 'Incoterms 2020', 'Rotterdam Port', 'USD', 2,
            500000, 50000, 42000, 550000,
            1200000, 1100000, 40, 'ISSUED', 3,
            1, 1, 1, 'REF-500', '[{"key":"date","enabled":true}]', 2, ?, ?)`,
      )
      .run(now, now);

    audit.sqlite
      .prepare(
        `INSERT INTO invoice_lines (id, invoice_id, line_no, description, hs_code, barcode, unit_label, quantity, unit_price_minor, line_total_minor)
         VALUES ('line-1', 'inv-src-1', 1, 'Acrylic Blankets 220x240', '6301.40', '6221001', 'PCS', 200, 1500, 300000),
                ('line-2', 'inv-src-1', 2, 'Plush Blankets 200x220', '6301.40', '6221002', 'PCS', 200, 1000, 200000)`,
      )
      .run();

    audit.sqlite
      .prepare(
        `INSERT INTO bookings (id, case_id, booking_number, status, version, created_at, updated_at)
         VALUES ('bkg-old', 'case-1', 'BKG-OLD-500', 'DEPARTED', 1, ?, ?)`,
      )
      .run(now, now);

    const harness = createTestHarness(audit);

    // Viewer without export_cases.create is forbidden
    const forbidden = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/clone",
      actor: "user-viewer",
      body: {},
    });
    expect(forbidden.status).toBe(403);

    // Officer clones case-1 with an Idempotency-Key
    const cloneRes = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/clone",
      actor: "user-officer",
      headers: { "idempotency-key": "idem-clone-case-1" },
      body: {},
    });
    expect(cloneRes.status).toBe(201);
    const cloned = (cloneRes.json as {
      data: {
        id: string;
        caseReference: string;
        invoiceId: string;
        invoiceNumber: string;
        sourceCaseId: string;
      };
    }).data;

    expect(cloned.sourceCaseId).toBe("case-1");
    expect(cloned.id).not.toBe("case-1");
    expect(cloned.caseReference).toMatch(/^EF-\d{4}-\d{4}$/);
    expect(cloned.invoiceNumber).toBe("INV-2026-500-COPY");

    // Replaying with the same Idempotency-Key returns the exact same cloned case without creating a third case
    const replayRes = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/clone",
      actor: "user-officer",
      headers: { "idempotency-key": "idem-clone-case-1" },
      body: {},
    });
    expect(replayRes.status).toBe(201);
    expect((replayRes.json as { data: { id: string } }).data.id).toBe(cloned.id);

    // Fetch full overview of the cloned case and verify every domain isolation rule
    const overviewRes = await harness.request({
      method: "GET",
      path: `/api/v1/export-cases/${cloned.id}`,
      actor: "user-officer",
    });
    expect(overviewRes.status).toBe(200);
    const overview = (overviewRes.json as {
      data: {
        case: Record<string, unknown>;
        snapshot: Record<string, unknown>;
        invoices: Array<Record<string, unknown>>;
        requirements: Array<Record<string, unknown>>;
        bookings: Array<Record<string, unknown>>;
        containers: Array<Record<string, unknown>>;
      };
    }).data;

    expect(overview.case.status).toBe("DRAFT");
    expect(overview.case.document_route).toBe("BANK_ROUTE");
    expect(overview.case.bank_path_status).toBe("PREPARING");
    const clonedCaseRow = audit.sqlite
      .prepare("SELECT destination_country FROM export_cases WHERE id = ?")
      .get(cloned.id) as { destination_country: string } | undefined;
    expect(clonedCaseRow?.destination_country).toBe("NL");
    // Live customer snapshot captured
    expect(overview.snapshot.legal_name).toBe("Updated Live Customer Ltd");
    // Requirements copied and reset to MISSING
    expect(overview.requirements).toHaveLength(1);
    expect(overview.requirements[0].status).toBe("MISSING");
    // Bookings and containers are NOT copied
    expect(overview.bookings).toEqual([]);
    expect(overview.containers).toEqual([]);
    // Commercial invoice copied as DRAFT with zeroed stamps, weights, edit_open, and actual freight
    expect(overview.invoices).toHaveLength(1);
    const inv = overview.invoices[0];
    expect(inv.invoice_number).toBe("INV-2026-500-COPY");
    expect(inv.trade_status).toBe("DRAFT");
    expect(inv.trade_revision).toBe(0);
    expect(inv.is_stamped).toBe(0);
    expect(inv.packing_is_stamped).toBe(0);
    expect(inv.edit_open).toBe(0);
    expect(inv.actual_freight_expense_minor).toBe(0);
    expect(inv.gross_weight_grams).toBe(0);
    expect(inv.net_weight_grams).toBe(0);
    expect(inv.goods_value_minor).toBe(500000);
    expect(inv.invoiced_freight_minor).toBe(50000);
    expect(inv.invoice_total_minor).toBe(550000);
    expect(inv.port_of_loading).toBe("Alexandria");
    expect(inv.port_of_discharge).toBe("Rotterdam");

    // Verify invoice_lines were copied
    const copiedLines = audit.sqlite
      .prepare("SELECT line_no, description, hs_code, quantity, unit_price_minor FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no")
      .all(cloned.invoiceId) as Array<Record<string, unknown>>;
    expect(copiedLines).toHaveLength(2);
    expect(copiedLines[0].description).toBe("Acrylic Blankets 220x240");
    expect(copiedLines[1].description).toBe("Plush Blankets 200x220");

    // Verify audit log recorded case.clone
    const auditRow = audit.sqlite
      .prepare("SELECT action FROM audit_log WHERE entity_type = 'export_case' AND entity_id = ?")
      .get(cloned.id) as { action: string } | undefined;
    expect(auditRow?.action).toBe("case.clone");
  });

  it("clones an issued proforma into an unlinked, unstamped DRAFT with copied lines and unique number", async () => {
    const audit = fresh();
    const now = "2026-11-12T10:00:00.000Z";

    audit.sqlite
      .prepare(
        `INSERT INTO proforma_invoices
           (id, customer_id, case_id, invoice_number, print_reference, invoice_date,
            origin_of_goods, port_of_loading, port_of_discharge,
            payment_term_code, payment_term_label, incoterm, shipping_method_label,
            currency, currency_decimals, fob_total_minor, sea_freight_minor, total_minor,
            is_stamped, status, issued_snapshot_json, version, created_at, updated_at)
         VALUES
           ('pf-orig', 'customer-1', 'case-1', 'PI-2026-77', 'REF-77', '2026-02-10',
            'EGYPT', 'Damietta', 'Jeddah',
            'TT', '50% ADVANCE / 50% AGAINST DOCS', 'CFR', 'CFR',
            'USD', 2, 300000, 25000, 325000,
            1, 'ISSUED', '{"frozen":true}', 3, ?, ?)`,
      )
      .run(now, now);

    audit.sqlite
      .prepare(
        `INSERT INTO proforma_lines (id, proforma_id, line_no, description, unit_label, quantity, unit_price_minor, line_total_minor)
         VALUES ('pfl-1', 'pf-orig', 1, 'Super Soft Blanket 6kg', 'PCS', 100, 3000, 300000)`,
      )
      .run();

    const harness = createTestHarness(audit);

    // First clone with Idempotency-Key
    const clone1 = await harness.request({
      method: "POST",
      path: "/api/v1/proformas/pf-orig/clone",
      actor: "user-officer",
      headers: { "idempotency-key": "idem-pf-clone-1" },
      body: {},
    });
    expect(clone1.status).toBe(201);
    const data1 = (clone1.json as {
      data: {
        id: string;
        invoice_number: string;
        status: string;
        case_id: string | null;
        is_stamped: number;
        issued_snapshot_json: string | null;
        fob_total_minor: number;
        sea_freight_minor: number;
        total_minor: number;
        port_of_loading: string;
        port_of_discharge: string;
        lines: Array<{ description: string; quantity: number; unit_price_minor: number }>;
      };
    }).data;

    expect(data1.id).not.toBe("pf-orig");
    expect(data1.invoice_number).toBe("PI-2026-77-COPY");
    expect(data1.status).toBe("DRAFT");
    expect(data1.case_id).toBeNull();
    expect(data1.is_stamped).toBe(0);
    expect(data1.issued_snapshot_json).toBeNull();
    expect(data1.fob_total_minor).toBe(300000);
    expect(data1.sea_freight_minor).toBe(25000);
    expect(data1.total_minor).toBe(325000);
    expect(data1.port_of_loading).toBe("Damietta");
    expect(data1.port_of_discharge).toBe("Jeddah");
    expect(data1.lines).toHaveLength(1);
    expect(data1.lines[0].description).toBe("Super Soft Blanket 6kg");

    // Second clone allocates PI-2026-77-COPY2 without UNIQUE collision
    const clone2 = await harness.request({
      method: "POST",
      path: "/api/v1/proformas/pf-orig/clone",
      actor: "user-officer",
      body: {},
    });
    expect(clone2.status).toBe(201);
    const data2 = (clone2.json as { data: { invoice_number: string } }).data;
    expect(data2.invoice_number).toBe("PI-2026-77-COPY2");
  });
});
