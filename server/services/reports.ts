import { all, one } from "../db/sql";
import type { Actor } from "./actor";
import { caseVisibilitySql, requirePermission } from "./actor";

export async function overview(db: D1Database, actor: Actor) {
  requirePermission(actor, "dashboard.view");
  const vis = caseVisibilitySql(actor, "c");
  const scope = vis.binds;
  const [countResult, recentResult, dueResult] = await db.batch([
    db.prepare(
      `SELECT
      (SELECT COUNT(*) FROM export_cases c WHERE status NOT IN ('CANCELLED','ARCHIVED') AND ${vis.sql}) AS total_cases,
      (SELECT COUNT(*) FROM export_cases c WHERE status = 'COMPLETED' AND ${vis.sql}) AS completed,
      (SELECT COUNT(*) FROM operation_document_requirements d JOIN export_cases c ON c.id = d.case_id WHERE d.status IN ('MISSING','UPLOADED','UNDER_REVIEW','NEEDS_CORRECTION') AND d.required = 1 AND ${vis.sql}) AS docs_pending,
      (SELECT COUNT(*) FROM export_cases c WHERE c.bank_path_status IN ('HANDED_TO_BANK','BANK_REVIEW') AND ${vis.sql}) AS bank_pending,
      (SELECT COUNT(*) FROM courier_shipments s JOIN export_cases c ON c.id = s.case_id WHERE s.status IN ('DISPATCHED','IN_TRANSIT') AND ${vis.sql}) AS courier_open,
      (SELECT COUNT(*) FROM reminder_instances r JOIN export_cases c ON c.id = r.case_id WHERE r.status = 'ACTIVE' AND r.due_at < datetime('now') AND ${vis.sql}) AS overdue`,
    ).bind(...scope, ...scope, ...scope, ...scope, ...scope, ...scope),
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
  const bank = await all<{ case_id: string; handed: string; decided: string | null }>(
    db,
    `SELECT s.case_id, e1.created_at AS handed, e2.created_at AS decided
     FROM bank_submissions s
     JOIN bank_events e1 ON e1.submission_id = s.id AND e1.event_type = 'HANDED_TO_BANK'
     LEFT JOIN bank_events e2 ON e2.submission_id = s.id AND e2.event_type IN ('BANK_APPROVED','CORRECTION_REQUESTED')`,
  );
  const delays = bank
    .filter((row) => row.decided)
    .map((row) => (new Date(row.decided!).getTime() - new Date(row.handed).getTime()) / 86400000);
  const averageBankReviewDays = delays.length
    ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
    : null;
  const incompleteDocs = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM operation_document_requirements WHERE required = 1 AND status NOT IN ('APPROVED','WAIVED')",
  );
  const bookings = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM bookings WHERE status != 'CANCELLED'");
  const containers = await one<{ delivered: number; open: number }>(
    db,
    `SELECT
      SUM(CASE WHEN status = 'DELIVERED_TO_CUSTOMER' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status NOT IN ('DELIVERED_TO_CUSTOMER','CANCELLED') THEN 1 ELSE 0 END) AS open
     FROM containers`,
  );
  return {
    averageBankReviewDays,
    incompleteRequiredDocuments: incompleteDocs?.n ?? 0,
    bookingVolume: bookings?.n ?? 0,
    containersDelivered: containers?.delivered ?? 0,
    containersInTransit: containers?.open ?? 0,
    note: "Bank review average is computed only when both handover and decision timestamps exist.",
  };
}

export async function casesCsv(db: D1Database, actor: Actor): Promise<string> {
  requirePermission(actor, "reports.export");
  const rows = await all<Record<string, string>>(
    db,
    `SELECT c.case_reference, cu.legal_name, c.status, c.document_route, c.destination_country,
            c.bank_path_status, c.direct_path_status, GROUP_CONCAT(i.invoice_number) AS invoices
     FROM export_cases c
     JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN export_invoices i ON i.case_id = c.id
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
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
  const valid: { legalName: string; countryCode?: string; phone?: string }[] = [];
  rows.forEach((row, index) => {
    const legalName = row.legal_name || row.legalName || row.name;
    if (!legalName) errors.push({ row: index + 2, code: "LEGAL_NAME_REQUIRED", message: "A legal name is required on this row." });
    else valid.push({ legalName, countryCode: row.country_code || row.country, phone: row.phone });
  });
  return { valid, errors, canCommit: errors.length === 0 };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
