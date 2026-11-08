import { buildCustomerTimeline } from "../../shared/customer-timeline";
import { carrierTrackingUrl } from "../../shared/carrier";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";
import { writeAudit } from "./audit";

const DEFAULT_SCOPE = {
  showInvoiceReference: true,
  showCourierTracking: true,
  showContainerNumbers: true,
  showEta: true,
  showRecipientName: false,
  showRemarks: false,
};

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createTrackingLink(
  db: D1Database,
  actor: Actor,
  caseId: string,
  input: { expiresAt?: string; scope?: Partial<typeof DEFAULT_SCOPE> },
  requestId: string,
) {
  requirePermission(actor, "tracking_links.manage");
  await assertCaseAccess(db, actor, caseId);
  const tokenBytes = new Uint8Array(24);
  crypto.getRandomValues(tokenBytes);
  const token = [...tokenBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await hashToken(token);
  const id = newId();
  await db
    .prepare(
      `INSERT INTO customer_tracking_links (id, case_id, token_hash, created_by, expires_at, display_scope_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      caseId,
      tokenHash,
      actor.id,
      input.expiresAt ?? null,
      JSON.stringify({ ...DEFAULT_SCOPE, ...input.scope, _shareToken: token }),
      nowIso(),
    )
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "tracking_link", entityId: id, action: "tracking.create", requestId });
  return { id, token };
}

export async function revokeTrackingLink(db: D1Database, actor: Actor, id: string, requestId: string) {
  requirePermission(actor, "tracking_links.manage");
  const link = await one<{ case_id: string; display_scope_json: string }>(
    db,
    "SELECT case_id, display_scope_json FROM customer_tracking_links WHERE id = ?",
    id,
  );
  if (!link) throw errors.notFound("Link not found");
  await assertCaseAccess(db, actor, link.case_id);
  const scope = JSON.parse(link.display_scope_json) as Record<string, unknown>;
  delete scope._shareToken;
  await db
    .prepare("UPDATE customer_tracking_links SET revoked_at = ?, display_scope_json = ? WHERE id = ?")
    .bind(nowIso(), JSON.stringify(scope), id)
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "tracking_link", entityId: id, action: "tracking.revoke", requestId });
}

export async function rotateTrackingLink(
  db: D1Database,
  actor: Actor,
  id: string,
  requestId: string,
) {
  const current = await one<{ case_id: string; expires_at: string | null; display_scope_json: string }>(
    db,
    "SELECT case_id, expires_at, display_scope_json FROM customer_tracking_links WHERE id = ?",
    id,
  );
  if (!current) throw errors.notFound("Link not found");
  const scope = JSON.parse(current.display_scope_json) as Record<string, unknown>;
  delete scope._shareToken;
  await revokeTrackingLink(db, actor, id, requestId);
  return createTrackingLink(db, actor, current.case_id, {
    expiresAt: current.expires_at ?? undefined,
    scope: scope as Partial<typeof DEFAULT_SCOPE>,
  }, requestId);
}

export async function listTrackingLinks(db: D1Database, actor: Actor, caseId: string) {
  requirePermission(actor, "tracking_links.manage");
  await assertCaseAccess(db, actor, caseId);
  const rows = await all<{
    id: string;
    expires_at: string | null;
    revoked_at: string | null;
    last_accessed_at: string | null;
    created_at: string;
    display_scope_json: string;
  }>(
    db,
    "SELECT id, expires_at, revoked_at, last_accessed_at, created_at, display_scope_json FROM customer_tracking_links WHERE case_id = ? ORDER BY created_at DESC",
    caseId,
  );
  return rows.map((row) => {
    const scope = JSON.parse(row.display_scope_json) as Record<string, unknown>;
    const shareToken = row.revoked_at ? null : typeof scope._shareToken === "string" ? scope._shareToken : null;
    delete scope._shareToken;
    return { ...row, display_scope_json: JSON.stringify(scope), share_token: shareToken };
  });
}

export async function consumeRateLimit(db: D1Database, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET
         hits = CASE WHEN rate_limit_buckets.window_start = excluded.window_start THEN rate_limit_buckets.hits + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING hits`,
    )
    .bind(key, windowStart)
    .first<{ hits: number }>();
  if ((row?.hits ?? 0) > limit) throw errors.rateLimited();
}

export async function openTrackingLink(db: D1Database, token: string) {
  const tokenHash = await hashToken(token);
  const link = await one<{
    id: string;
    case_id: string;
    expires_at: string | null;
    revoked_at: string | null;
    display_scope_json: string;
  }>(db, "SELECT id, case_id, expires_at, revoked_at, display_scope_json FROM customer_tracking_links WHERE token_hash = ?", tokenHash);
  if (!link || link.revoked_at || (link.expires_at && link.expires_at < nowIso())) {
    throw errors.gone("This tracking link is unavailable");
  }
  return link;
}

export async function publicTracking(db: D1Database, _env: Env, token: string, ip: string) {
  await consumeRateLimit(db, `public-track:${await hashToken(ip || "unknown")}`, 30, 60_000);
  const link = await openTrackingLink(db, token);

  const storedScope = JSON.parse(link.display_scope_json) as Record<string, unknown>;
  delete storedScope._shareToken;
  const scope = { ...DEFAULT_SCOPE, ...storedScope } as typeof DEFAULT_SCOPE;
  const exportCase = await one<{
    case_reference: string;
    document_route: string;
    bank_path_status: string;
    direct_path_status: string | null;
    destination_country: string | null;
    updated_at: string;
  }>(db, "SELECT case_reference, document_route, bank_path_status, direct_path_status, destination_country, updated_at FROM export_cases WHERE id = ?", link.case_id);
  if (!exportCase) throw errors.gone("This tracking link is unavailable");
  const invoice = await one<{ invoice_number: string; port_of_loading: string | null; port_of_discharge: string | null; invoice_total_minor: number; currency: string; currency_decimals: number }>(
    db,
    "SELECT invoice_number, port_of_loading, port_of_discharge, invoice_total_minor, currency, currency_decimals FROM export_invoices WHERE case_id = ? ORDER BY created_at LIMIT 1",
    link.case_id,
  );
  const booking = await one<{
    booking_number: string;
    planned_loading_date: string | null;
    actual_loading_date: string | null;
    planned_etd: string | null;
    actual_etd: string | null;
    planned_eta: string | null;
    actual_eta: string | null;
  }>(
    db,
    `SELECT booking_number, planned_loading_date, actual_loading_date, planned_etd, actual_etd, planned_eta, actual_eta
     FROM bookings WHERE case_id = ? AND status != 'CANCELLED'
     ORDER BY COALESCE(planned_loading_date, planned_etd, created_at) DESC LIMIT 1`,
    link.case_id,
  );
  const containers = await all<{ official_number: string | null; status: string; slot_index: number }>(
    db,
    "SELECT official_number, status, slot_index FROM containers WHERE case_id = ? AND status != 'CANCELLED' ORDER BY slot_index",
    link.case_id,
  );
  const documents = await all<{ id: string; name_en: string; name_ar: string; status: string }>(
    db,
    `SELECT r.id, d.name_en, d.name_ar, r.status
     FROM operation_document_requirements r
     JOIN document_type_definitions d ON d.id = r.document_type_id
     WHERE r.case_id = ?
     ORDER BY r.created_at ASC, r.id ASC`,
    link.case_id,
  );
  const freshness = await one<{ ts: string | null }>(
    db,
    `SELECT MAX(ts) AS ts FROM (
       SELECT updated_at AS ts FROM export_cases WHERE id = ?
       UNION ALL SELECT updated_at FROM bookings WHERE case_id = ?
       UNION ALL SELECT updated_at FROM containers WHERE case_id = ?
       UNION ALL SELECT updated_at FROM operation_document_requirements WHERE case_id = ?
     )`,
    link.case_id,
    link.case_id,
    link.case_id,
    link.case_id,
  );
  const courier = await one<{ carrier: string; tracking_number: string | null; status: string }>(
    db,
    "SELECT carrier, tracking_number, status FROM courier_shipments WHERE case_id = ? ORDER BY created_at DESC LIMIT 1",
    link.case_id,
  );
  const containerEvents = await all<{ status: string; event_at: string; slot_index: number; official_number: string | null }>(
    db,
    `SELECT e.status, e.event_at, c.slot_index, c.official_number
     FROM container_events e
     JOIN containers c ON c.id = e.container_id
     WHERE c.case_id = ? AND c.status != 'CANCELLED' AND e.is_actual = 1`,
    link.case_id,
  );
  const courierEvents = await all<{ status: string; event_at: string }>(
    db,
    `SELECT e.status, e.event_at
     FROM courier_tracking_events e
     JOIN courier_shipments s ON s.id = e.shipment_id
     WHERE s.case_id = ?`,
    link.case_id,
  );
  const sharedDocuments = await sharedDocumentEvents(db, link.case_id);
  const timeline = buildCustomerTimeline({
    showEta: scope.showEta,
    showCourierTracking: scope.showCourierTracking,
    showContainerNumbers: scope.showContainerNumbers,
    containers: containerEvents.map((row) => ({
      status: row.status,
      eventAt: row.event_at,
      slot: row.slot_index,
      officialNumber: row.official_number,
    })),
    booking: booking
      ? {
          plannedEtd: booking.planned_etd,
          actualEtd: booking.actual_etd,
          plannedEta: booking.planned_eta,
          actualEta: booking.actual_eta,
        }
      : null,
    courier: courierEvents.map((row) => ({ status: row.status, eventAt: row.event_at })),
    documents: sharedDocuments.map((row) => ({
      publishedAt: row.publishedAt,
      typeKey: row.typeKey,
      decision: row.decision,
      decidedAt: row.decidedAt,
    })),
  });
  const settings = await one<{ exporter_display_name: string }>(db, "SELECT exporter_display_name FROM company_settings WHERE id = 'default'");

  await db.prepare("UPDATE customer_tracking_links SET last_accessed_at = ? WHERE id = ?").bind(nowIso(), link.id).run();
  await db
    .prepare("INSERT INTO tracking_link_access_events (id, link_id, accessed_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(newId(), link.id, nowIso(), await hashToken(ip), "redacted")
    .run();

  return {
    caseReference: exportCase.case_reference,
    invoiceNumber: scope.showInvoiceReference ? invoice?.invoice_number ?? null : null,
    exporterDisplayName: settings?.exporter_display_name ?? "Exporter",
    destinationCountry: exportCase.destination_country,
    portOfLoading: invoice?.port_of_loading ?? null,
    portOfDischarge: invoice?.port_of_discharge ?? null,
    documentRoute: exportCase.document_route,
    documentTrackStatus: exportCase.document_route === "BANK_ROUTE" ? exportCase.bank_path_status : exportCase.direct_path_status,
    goodsTrackStatus: summarizeGoods(containers.map((c) => c.status)),
    courierCarrier: scope.showCourierTracking ? courier?.carrier ?? null : null,
    courierTrackingNumber: scope.showCourierTracking ? courier?.tracking_number ?? null : null,
    courierStatus: scope.showCourierTracking ? courier?.status ?? null : null,
    courierTrackingUrl:
      scope.showCourierTracking && courier?.tracking_number
        ? carrierTrackingUrl(courier.carrier, courier.tracking_number)
        : null,
    bookingNumber: booking?.booking_number ?? null,
    plannedLoadingDate: booking?.planned_loading_date ?? null,
    actualLoadingDate: booking?.actual_loading_date ?? null,
    plannedEtd: booking?.planned_etd ?? null,
    actualEtd: booking?.actual_etd ?? null,
    plannedEta: scope.showEta ? booking?.planned_eta ?? null : null,
    actualEta: scope.showEta ? booking?.actual_eta ?? null : null,
    containers: containers.map((c) => ({
      slot: c.slot_index,
      officialNumber: scope.showContainerNumbers ? c.official_number : null,
      status: c.status,
    })),
    documents: documents.map((document) => ({
      requirementId: document.id,
      nameEn: document.name_en,
      nameAr: document.name_ar,
      status: document.status,
    })),
    timeline,
    lastUpdatedAt: freshness?.ts ?? exportCase.updated_at,
    attribution: "Data provided by the exporter. Courier and milestone dates are manually updated.",
  };
}

async function sharedDocumentEvents(db: D1Database, caseId: string): Promise<Array<{ publishedAt: string; typeKey: string; decision: string | null; decidedAt: string | null }>> {
  const sql = `SELECT s.published_at, s.decision, s.decided_at, d.key AS type_key
     FROM customer_file_shares s
     JOIN document_versions v ON v.id = s.version_id AND v.archived_at IS NULL
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     JOIN document_type_definitions d ON d.id = r.document_type_id
     WHERE s.case_id = ? AND s.unpublished_at IS NULL
       AND v.version = (
         SELECT MAX(version) FROM document_versions
         WHERE requirement_id = r.id AND archived_at IS NULL
       )`;
  const fallback = `SELECT s.published_at, s.decision, s.decided_at, d.key AS type_key
     FROM customer_file_shares s
     JOIN document_versions v ON v.id = s.version_id
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     JOIN document_type_definitions d ON d.id = r.document_type_id
     WHERE s.case_id = ? AND s.unpublished_at IS NULL
       AND v.version = (SELECT MAX(version) FROM document_versions WHERE requirement_id = r.id)`;
  try {
    const rows = await all<{ published_at: string; type_key: string; decision: string | null; decided_at: string | null }>(db, sql, caseId);
    return rows.map(shareEvent);
  } catch (error) {
    if (!isMissingShareShape(error)) throw error;
    try {
      const rows = await all<{ published_at: string; type_key: string; decision: string | null; decided_at: string | null }>(db, fallback, caseId);
      return rows.map(shareEvent);
    } catch (inner) {
      if (isMissingShareShape(inner)) return [];
      throw inner;
    }
  }
}

function shareEvent(row: { published_at: string; type_key: string; decision: string | null; decided_at: string | null }) {
  return { publishedAt: row.published_at, typeKey: row.type_key, decision: row.decision, decidedAt: row.decided_at };
}

function isMissingShareShape(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /no such (table|column)/i.test(text) && /customer_file_shares|archived_at/i.test(text);
}

function summarizeGoods(statuses: string[]): string {
  if (statuses.length === 0) return "NOT_STARTED";
  if (statuses.every((s) => s === "DELIVERED_TO_CUSTOMER")) return "DELIVERED_TO_CUSTOMER";
  if (statuses.some((s) => s === "ARRIVED_PORT" || s === "CUSTOMS_RELEASED")) return "ARRIVED_PORT";
  if (statuses.some((s) => s === "DEPARTED")) return "IN_TRANSIT";
  if (statuses.some((s) => s === "LOADED")) return "LOADED";
  return "PLANNED";
}
