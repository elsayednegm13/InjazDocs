import { afterEach, describe, expect, it } from "vitest";
import { buildCustomerTimeline, splitCustomerTimeline, type UnifiedTimelineEvent } from "../shared/customer-timeline";
import { hashToken } from "../server/services/tracking";
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

const booking = {
  plannedEtd: "2026-11-01",
  actualEtd: null,
  plannedEta: "2026-11-04",
  actualEta: null,
};

describe("customer timeline", () => {
  it("hides arrival and courier events when the link scope turns them off", () => {
    const hidden = buildCustomerTimeline({
      showEta: false,
      showCourierTracking: false,
      showContainerNumbers: false,
      containers: [{ status: "LOADED", eventAt: "2026-11-02T10:00:00.000Z", slot: 1, officialNumber: "TLCU1234567" }],
      booking,
      courier: [{ status: "DISPATCHED", eventAt: "2026-11-03T10:00:00.000Z" }],
      documents: [],
    });
    expect(hidden.map((event) => event.code)).toEqual(["ETD", "LOADED"]);
    expect(hidden[1]?.reference).toBeNull();
    expect(splitCustomerTimeline(hidden).documents).toEqual([]);
    expect(splitCustomerTimeline(hidden).shipment.map((event) => event.code)).toEqual(["ETD", "LOADED"]);
  });

  it("keeps the customer decision on the document track and leaves the note out", () => {
    const events = buildCustomerTimeline({
      showEta: true,
      showCourierTracking: true,
      showContainerNumbers: true,
      containers: [
        { status: "LOADED", eventAt: "2026-11-02T10:00:00.000Z", slot: 1, officialNumber: "TLCU1234567" },
        { status: "DEPARTED", eventAt: "2026-11-06T10:00:00.000Z", slot: 2, officialNumber: "TLCU7654321" },
      ],
      booking,
      courier: [{ status: "DISPATCHED", eventAt: "2026-11-03T10:00:00.000Z" }],
      documents: [{
        publishedAt: "2026-11-05T10:00:00.000Z",
        typeKey: "commercial_invoice",
        decision: "ACCEPTED",
        decidedAt: "2026-11-07T10:00:00.000Z",
      }],
    });
    const tracks = splitCustomerTimeline(events);
    expect(tracks.shipment.map((event) => event.code)).toEqual(["ETD", "LOADED", "ETA", "DEPARTED"]);
    expect(tracks.documents.map((event) => `${event.code}|${event.reference ?? ""}`)).toEqual([
      "DISPATCHED|",
      "SHARED|commercial_invoice",
      "ACCEPTED|commercial_invoice",
    ]);
    expect(JSON.stringify(events)).not.toContain("SECRET");
  });

  it("returns the public timeline in date order without bank or staff fields", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const now = "2026-11-08T00:00:00.000Z";
    const token = "timeline-public-token";
    audit.sqlite
      .prepare(
        `INSERT INTO customer_tracking_links (id, case_id, token_hash, created_by, display_scope_json, created_at)
         VALUES ('link-tl', 'case-1', ?, 'user-admin', ?, ?)`,
      )
      .run(await hashToken(token), JSON.stringify({ showInvoiceReference: true, showCourierTracking: true, showContainerNumbers: true, showEta: true, showRecipientName: false, showRemarks: true }), now);
    audit.sqlite
      .prepare(
        `INSERT INTO bookings
           (id, case_id, booking_number, planned_etd, actual_eta, status, version, created_at, updated_at)
         VALUES ('booking-tl', 'case-1', 'BKG-TL-1', '2026-11-01', '2026-11-04', 'CONFIRMED', 1, ?, ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO containers
           (id, booking_id, case_id, slot_index, official_number, status, version, created_at, updated_at)
         VALUES ('container-tl', 'booking-tl', 'case-1', 1, 'TLCU1234567', 'LOADED', 1, ?, ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO container_events (id, container_id, status, event_at, is_actual, note, actor_id, created_at)
         VALUES ('event-yard', 'container-tl', 'NUMBER_ASSIGNED', '2026-10-01T00:00:00.000Z', 1, 'STAFF-ONLY-NOTE', 'user-admin', ?),
                ('event-load', 'container-tl', 'LOADED', '2026-11-02T10:00:00.000Z', 1, 'STAFF-ONLY-NOTE', 'user-admin', ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO courier_shipments
           (id, case_id, route, sender, carrier, tracking_number, status, version, created_at, updated_at)
         VALUES ('ship-tl', 'case-1', 'BANK_ROUTE', 'COMPANY', 'DHL', 'TRACK-1', 'DISPATCHED', 1, ?, ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO courier_tracking_events (id, shipment_id, status, note, event_at, actor_id, source, created_at)
         VALUES ('courier-tl', 'ship-tl', 'DISPATCHED', 'SECRET-COURIER-NOTE', '2026-11-03T10:00:00.000Z', 'user-admin', 'MANUAL', ?)`,
      )
      .run(now);
    audit.sqlite
      .prepare(
        `INSERT INTO bank_submissions (id, case_id, attempt, status, created_at, updated_at)
         VALUES ('submission-tl', 'case-1', 1, 'CORRECTION_REQUESTED', ?, ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO bank_events (id, submission_id, event_type, reason, actor_id, created_at)
         VALUES ('bank-tl', 'submission-tl', 'CORRECTION_REQUESTED', 'SECRET-BANK-REASON', 'user-admin', ?)`,
      )
      .run(now);
    audit.sqlite
      .prepare(
        `INSERT INTO export_invoices
           (id, case_id, invoice_number, invoice_date, customer_id, payment_term_code, incoterm, incoterms_edition,
            currency, currency_decimals, goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor,
            invoice_total_minor, gross_weight_grams, net_weight_grams, version, created_at, updated_at)
         VALUES ('invoice-tl', 'case-1', 'INV-TL-1', '2026-11-08', 'customer-1', 'LC', 'FOB', 'Incoterms 2020',
            'USD', 2, 424242, 0, 0, 424242, 1000, 900, 1, ?, ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO document_versions
           (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at)
         VALUES ('version-tl', 'requirement-1', 1, 'synthetic/timeline.pdf', 'internal-draft.pdf', 'application/pdf', 100, 'user-admin', 'UPLOADED', ?)`,
      )
      .run(now);
    audit.sqlite
      .prepare(
        `INSERT INTO customer_file_shares
           (id, version_id, case_id, published_at, published_by, comment, created_at, updated_at)
         VALUES ('share-tl', 'version-tl', 'case-1', '2026-11-05T10:00:00.000Z', 'user-admin', 'SECRET-SHARE-NOTE', ?, ?)`,
      )
      .run(now, now);

    const response = await harness.request({ path: `/api/v1/public/track/${token}` });
    expect(response.status).toBe(200);
    const timeline = (response.json as { data: { timeline: UnifiedTimelineEvent[] } }).data.timeline;
    expect(timeline.map((event) => `${event.occurredAt}|${event.source}|${event.code}|${event.planned}`)).toEqual([
      "2026-11-01|booking|ETD|true",
      "2026-11-02T10:00:00.000Z|container|LOADED|false",
      "2026-11-03T10:00:00.000Z|courier|DISPATCHED|false",
      "2026-11-04|booking|ETA|false",
      "2026-11-05T10:00:00.000Z|documents|SHARED|false",
    ]);
    expect(timeline[4]?.reference).toBe("commercial_invoice");
    const tracks = splitCustomerTimeline(timeline);
    expect(tracks.shipment.map((event) => event.code)).toEqual(["ETD", "LOADED", "ETA"]);
    expect(tracks.documents.map((event) => event.code)).toEqual(["DISPATCHED", "SHARED"]);
    const visible = JSON.stringify(timeline);
    for (const secret of ["SECRET-BANK-REASON", "SECRET-COURIER-NOTE", "STAFF-ONLY-NOTE", "SECRET-SHARE-NOTE", "user-admin", "424242", "internal-draft.pdf", "CORRECTION_REQUESTED"]) {
      expect(visible).not.toContain(secret);
    }
    expect(Object.keys(timeline[0] ?? {}).sort()).toEqual(["code", "occurredAt", "planned", "reference", "slot", "source"]);
  });
});
