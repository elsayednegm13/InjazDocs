import { all, one } from "../db/sql";
import type { Actor } from "./actor";
import { caseVisibilitySql, reportVisibilitySql, requirePermission } from "./actor";
import { fingerprintCustomerImportRows } from "./import-fingerprint";

/**
 * `dashboard` keeps the operational case-visibility entitlement; the report
 * ports use the independent `reports.view_all` entitlement. Same shape, two
 * different scopes, so a report grant cannot widen the dashboard and an
 * operational view-all cannot silently widen reports.
 */
export async function overview(db: D1Database, actor: Actor, mode: "operational" | "reports" = "operational") {
  requirePermission(actor, mode === "reports" ? "reports.view" : "dashboard.view");
  const vis = mode === "reports" ? reportVisibilitySql(actor, "c") : caseVisibilitySql(actor, "c");
  const scope = vis.binds;
  // One pass over the visible cases. The joined counts stay separate because
  // they count child rows, not cases. A case-less scope still returns zeros.
  const [countResult, recentResult, dueResult] = await db.batch([
    db.prepare(
      `SELECT
      COALESCE(SUM(CASE WHEN c.status NOT IN ('CANCELLED','ARCHIVED') THEN 1 ELSE 0 END), 0) AS total_cases,
      COALESCE(SUM(CASE WHEN c.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN c.bank_path_status IN ('HANDED_TO_BANK','BANK_REVIEW') THEN 1 ELSE 0 END), 0) AS bank_pending,
      (SELECT COUNT(*) FROM operation_document_requirements d JOIN export_cases c ON c.id = d.case_id WHERE d.status IN ('MISSING','UPLOADED','UNDER_REVIEW','NEEDS_CORRECTION') AND d.required = 1 AND ${vis.sql}) AS docs_pending,
      (SELECT COUNT(*) FROM courier_shipments s JOIN export_cases c ON c.id = s.case_id WHERE s.status IN ('DISPATCHED','IN_TRANSIT') AND ${vis.sql}) AS courier_open,
      (SELECT COUNT(*) FROM reminder_instances r JOIN export_cases c ON c.id = r.case_id WHERE r.status = 'ACTIVE' AND r.due_at < datetime('now') AND ${vis.sql}) AS overdue
      FROM (SELECT 1) AS anchor
      LEFT JOIN export_cases c ON ${vis.sql}`,
    ).bind(...scope, ...scope, ...scope, ...scope),
    db.prepare(
      `SELECT e.id, e.event_type, e.summary, e.created_at, e.case_id, c.case_reference
       FROM case_events e JOIN export_cases c ON c.id = e.case_id
       WHERE ${vis.sql}
       ORDER BY e.created_at DESC LIMIT 12`,
    ).bind(...scope),
    db.prepare(
      `SELECT r.id, r.reason, r.next_action, r.due_at, r.status, c.case_reference, r.case_id, r.owner_user_id, u.name AS owner_name
     FROM reminder_instances r
     JOIN export_cases c ON c.id = r.case_id
     LEFT JOIN user u ON u.id = r.owner_user_id
     WHERE r.status IN ('ACTIVE','PENDING') AND ${vis.sql}
     ORDER BY r.due_at ASC LIMIT 24`,
    ).bind(...vis.binds),
  ]);
  const counts = (countResult.results?.[0] ?? null) as {
    total_cases: number;
    completed: number;
    docs_pending: number;
    bank_pending: number;
    courier_open: number;
    overdue: number;
  } | null;
  const recent = recentResult.results ?? [];
  const due = dueResult.results ?? [];
  return { counts, recent, due };
}

export async function delayReport(db: D1Database, actor: Actor) {
  requirePermission(actor, "reports.view");
  const vis = reportVisibilitySql(actor, "c");
  const bank = await all<{ case_id: string; handed: string; decided: string | null }>(
    db,
    `SELECT s.case_id, e1.created_at AS handed, e2.created_at AS decided
     FROM bank_submissions s
     JOIN export_cases c ON c.id = s.case_id
     JOIN bank_events e1 ON e1.submission_id = s.id AND e1.event_type = 'HANDED_TO_BANK'
     LEFT JOIN bank_events e2 ON e2.submission_id = s.id AND e2.event_type IN ('BANK_APPROVED','CORRECTION_REQUESTED')
     WHERE ${vis.sql}`,
    ...vis.binds,
  );
  const delays = bank
    .filter((row) => row.decided)
    .map((row) => (new Date(row.decided!).getTime() - new Date(row.handed).getTime()) / 86400000);
  const averageBankReviewDays = delays.length
    ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
    : null;
  const incompleteDocs = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM operation_document_requirements d JOIN export_cases c ON c.id = d.case_id WHERE d.required = 1 AND d.status NOT IN ('APPROVED','WAIVED') AND " + vis.sql,
    ...vis.binds,
  );
  const bookings = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM bookings b JOIN export_cases c ON c.id = b.case_id WHERE b.status != 'CANCELLED' AND " + vis.sql,
    ...vis.binds,
  );
  const containers = await one<{ delivered: number; open: number }>(
    db,
    `SELECT
      SUM(CASE WHEN b.status = 'DELIVERED_TO_CUSTOMER' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN b.status NOT IN ('DELIVERED_TO_CUSTOMER','CANCELLED') THEN 1 ELSE 0 END) AS open
     FROM containers b JOIN export_cases c ON c.id = b.case_id WHERE ${vis.sql}`,
    ...vis.binds,
  );
  return {
    averageBankReviewDays,
    incompleteRequiredDocuments: incompleteDocs?.n ?? 0,
    bookingVolume: bookings?.n ?? 0,
    containersDelivered: containers?.delivered ?? 0,
    containersInTransit: containers?.open ?? 0,
    note: "Bank review average is computed only when both handover and decision timestamps exist. Aggregates cover every case only for an actor holding the explicit reports.view_all entitlement; otherwise they are scoped to the actor's assigned/created cases.",
  };
}

export async function casesCsv(db: D1Database, actor: Actor): Promise<string> {
  requirePermission(actor, "reports.export");
  // Only an explicit reports.view_all grant widens the export; otherwise the
  // actor exports their own assigned/created cases.
  const vis = reportVisibilitySql(actor, "c");
  const rows = await all<Record<string, string>>(
    db,
    `SELECT c.case_reference, cu.legal_name, c.status, c.document_route, c.destination_country,
            c.bank_path_status, c.direct_path_status, GROUP_CONCAT(i.invoice_number) AS invoices
     FROM export_cases c
     JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN export_invoices i ON i.case_id = c.id
     WHERE ${vis.sql}
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    ...vis.binds,
  );
  const header = [
    "case_reference",
    "customer",
    "status",
    "document_route",
    "destination_country",
    "bank_path_status",
    "direct_path_status",
    "invoices",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.case_reference,
        row.legal_name,
        row.status,
        row.document_route,
        row.destination_country,
        row.bank_path_status,
        row.direct_path_status,
        row.invoices,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}`;
}

export async function previewCustomerImport(rows: Record<string, string>[]) {
  const errors: { row: number; code: string; message: string }[] = [];
  const valid: { row: number; legalName: string; countryCode?: string; phone?: string }[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const legalName = row.legal_name || row.legalName || row.name;
    if (!legalName) errors.push({ row: rowNumber, code: "LEGAL_NAME_REQUIRED", message: "A legal name is required on this row." });
    else valid.push({ row: rowNumber, legalName, countryCode: row.country_code || row.country, phone: row.phone });
  });
  const identity = await fingerprintCustomerImportRows(rows);
  return {
    valid,
    errors,
    canCommit: errors.length === 0,
    fingerprint: identity.fingerprint,
    parserVersion: identity.parserVersion,
  };
}

export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Neutralise spreadsheet formula injection: a customer name such as
  // =HYPERLINK("…") must stay text when the export is opened in Excel.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
