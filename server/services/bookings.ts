import { normalizePage } from "../../shared/api";
import { customFieldsRequiredNow } from "../domain/custom-fields";
import { assertRequiredCustomFields } from "./custom-fields";
import { validateContainerNumber } from "../../shared/container";
import type { BookingStatus, ContainerStatus } from "../../shared/enums";
import { bookingAggregateFromContainers } from "../domain/case-completion";
import { assertBookingTransition, assertContainerTransition } from "../domain/transitions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, caseVisibilitySql, requirePermission } from "./actor";
import { writeAudit, writeCaseEvent } from "./audit";
import { recomputeRemindersForCase } from "./reminders";

export async function listBookings(db: D1Database, actor: Actor, query: { page?: number; q?: string }) {
  requirePermission(actor, "bookings.view");
  const page = normalizePage(query.page);
  const vis = caseVisibilitySql(actor, "c");
  const filters = [vis.sql];
  const binds: unknown[] = [...vis.binds];
  if (query.q) {
    filters.push("(b.booking_number LIKE ? OR c.case_reference LIKE ?)");
    binds.push(`%${query.q}%`, `%${query.q}%`);
  }
  const rows = await all(
    db,
    `SELECT b.*, c.case_reference, cu.legal_name AS customer_name
     FROM bookings b
     JOIN export_cases c ON c.id = b.case_id
     JOIN customers cu ON cu.id = c.customer_id
     WHERE ${filters.join(" AND ")}
     ORDER BY COALESCE(b.planned_etd, b.created_at) DESC
     LIMIT ? OFFSET ?`,
    ...binds,
    page.pageSize,
    page.offset,
  );
  return { rows, ...page };
}

export async function getBooking(db: D1Database, actor: Actor, id: string) {
  const booking = await one<Record<string, unknown>>(db, "SELECT * FROM bookings WHERE id = ?", id);
  if (!booking) throw errors.notFound("Booking not found");
  await assertCaseAccess(db, actor, String(booking.case_id));
  const containers = await all<Record<string, unknown>>(db, "SELECT * FROM containers WHERE booking_id = ? ORDER BY slot_index", id);
  const attachments = await all(db, "SELECT * FROM booking_attachments WHERE booking_id = ?", id);
  const events = [];
  for (const container of containers) {
    const history = await all(db, "SELECT * FROM container_events WHERE container_id = ? ORDER BY event_at", container.id);
    events.push({ containerId: container.id, history });
  }
  const aggregate = bookingAggregateFromContainers(
    Number(booking.expected_containers),
    containers.map((c) => ({ status: c.status as ContainerStatus, officialNumber: (c.official_number as string | null) ?? null })),
  );
  return { booking, containers, attachments, events, aggregate };
}

export async function createBooking(
  db: D1Database,
  actor: Actor,
  env: Env,
  input: {
    caseId: string;
    bookingNumber: string;
    ucr?: string;
    shippingLine?: string;
    vessel?: string;
    voyage?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    expectedContainers: number;
    plannedLoadingDate?: string;
    cutoffDate?: string;
    plannedEtd?: string;
    plannedEta?: string;
    notes?: string;
  },
  requestId: string,
) {
  requirePermission(actor, "bookings.manage");
  await assertCaseAccess(db, actor, input.caseId);
  if (!Number.isFinite(input.expectedContainers) || input.expectedContainers < 0) {
    throw errors.validation("Check the requested container count before saving the booking.", { expectedContainers: "Enter a valid container count." }, "BOOKING_CONTAINER_COUNT_INVALID");
  }
  const dup = await one(db, "SELECT id FROM bookings WHERE booking_number = ? AND status != 'CANCELLED'", input.bookingNumber);
  if (dup) throw errors.conflict("Booking number already exists");
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO bookings (
        id, case_id, booking_number, ucr, shipping_line, vessel, voyage, port_of_loading, port_of_discharge,
        expected_containers, status, planned_loading_date, cutoff_date, planned_etd, planned_eta, notes, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.caseId,
      input.bookingNumber,
      input.ucr ?? null,
      input.shippingLine ?? null,
      input.vessel ?? null,
      input.voyage ?? null,
      input.portOfLoading ?? null,
      input.portOfDischarge ?? null,
      input.expectedContainers,
      input.plannedLoadingDate ?? null,
      input.cutoffDate ?? null,
      input.plannedEtd ?? null,
      input.plannedEta ?? null,
      input.notes ?? null,
      now,
      now,
    )
    .run();
  for (let i = 1; i <= input.expectedContainers; i += 1) {
    await db
      .prepare(
        `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'PLANNED', 1, ?, ?)`,
      )
      .bind(newId(), id, input.caseId, i, now, now)
      .run();
  }
  await writeCaseEvent(db, input.caseId, "BOOKING_CREATED", `Booking ${input.bookingNumber}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "booking", entityId: id, action: "booking.create", requestId });
  await recomputeRemindersForCase(db, env, input.caseId);
  return { id };
}

export async function updateBooking(
  db: D1Database,
  actor: Actor,
  env: Env,
  id: string,
  input: Record<string, unknown> & { version: number },
  requestId: string,
) {
  requirePermission(actor, "bookings.manage");
  const booking = await one<{ case_id: string; version: number; status: BookingStatus }>(
    db,
    "SELECT case_id, version, status FROM bookings WHERE id = ?",
    id,
  );
  if (!booking) throw errors.notFound("Booking not found");
  await assertCaseAccess(db, actor, booking.case_id);
  if (booking.version !== input.version) throw errors.conflict("Booking was updated by someone else");
  if (input.status && input.status !== booking.status) {
    assertBookingTransition(booking.status, input.status as BookingStatus);
  }
  const nextStatus = typeof input.status === "string" ? input.status : booking.status;
  if (customFieldsRequiredNow("BOOKING", nextStatus)) {
    await assertRequiredCustomFields(db, "BOOKING", id);
  }
  await db
    .prepare(
      `UPDATE bookings SET booking_number=?, ucr=?, shipping_line=?, vessel=?, voyage=?, port_of_loading=?, port_of_discharge=?,
        expected_containers=?, status=?, planned_loading_date=?, actual_loading_date=?, cutoff_date=?, planned_etd=?, actual_etd=?,
        planned_eta=?, actual_eta=?, notes=?, version=version+1, updated_at=?
       WHERE id=?`,
    )
    .bind(
      input.bookingNumber,
      input.ucr ?? null,
      input.shippingLine ?? null,
      input.vessel ?? null,
      input.voyage ?? null,
      input.portOfLoading ?? null,
      input.portOfDischarge ?? null,
      input.expectedContainers,
      input.status ?? booking.status,
      input.plannedLoadingDate ?? null,
      input.actualLoadingDate ?? null,
      input.cutoffDate ?? null,
      input.plannedEtd ?? null,
      input.actualEtd ?? null,
      input.plannedEta ?? null,
      input.actualEta ?? null,
      input.notes ?? null,
      nowIso(),
      id,
    )
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "booking", entityId: id, action: "booking.update", requestId });
  await recomputeRemindersForCase(db, env, booking.case_id);
}

export async function assignContainerNumber(
  db: D1Database,
  actor: Actor,
  env: Env,
  containerId: string,
  input: { officialNumber: string; override?: boolean; version: number },
  requestId: string,
) {
  requirePermission(actor, "containers.manage");
  const container = await one<{ id: string; case_id: string; status: ContainerStatus; version: number }>(
    db,
    "SELECT id, case_id, status, version FROM containers WHERE id = ?",
    containerId,
  );
  if (!container) throw errors.notFound("Container not found");
  await assertCaseAccess(db, actor, container.case_id);
  if (container.version !== input.version) throw errors.conflict("Container was updated by someone else");
  const validation = validateContainerNumber(input.officialNumber);
  if (!validation.ok && !input.override) {
    throw errors.validation(
      validation.reason === "CHECK_DIGIT"
        ? "ISO 6346 check digit is invalid. Confirm the official number or record an authorized override."
        : "Container number format is invalid. Expected 4 letters + 7 digits.",
      { reason: validation.reason, normalized: validation.normalized },
    );
  }
  const official = validation.normalized;
  const dup = await one(
    db,
    "SELECT id FROM containers WHERE official_number = ? AND status != 'CANCELLED' AND id != ?",
    official,
    containerId,
  );
  if (dup) throw errors.conflict("This official container number is already assigned");
  if (container.status === "PLANNED") assertContainerTransition(container.status, "NUMBER_ASSIGNED");
  await db
    .prepare(
      `UPDATE containers SET official_number = ?, official_number_override = ?, status = CASE WHEN status = 'PLANNED' THEN 'NUMBER_ASSIGNED' ELSE status END, version = version + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(official, input.override ? 1 : 0, nowIso(), containerId)
    .run();
  await db
    .prepare(
      `INSERT INTO container_events (id, container_id, status, event_at, is_actual, note, actor_id, created_at)
       VALUES (?, ?, 'NUMBER_ASSIGNED', ?, 1, ?, ?, ?)`,
    )
    .bind(newId(), containerId, nowIso(), input.override ? "Authorized override of ISO check" : null, actor.id, nowIso())
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "container", entityId: containerId, action: "container.number", after: { official, override: input.override }, requestId });
  await recomputeRemindersForCase(db, env, container.case_id);
}

export async function transitionContainer(
  db: D1Database,
  actor: Actor,
  env: Env,
  containerId: string,
  input: { status: ContainerStatus; eventAt?: string; note?: string; version: number },
  requestId: string,
) {
  requirePermission(actor, "containers.manage");
  const container = await one<{ id: string; case_id: string; booking_id: string; status: ContainerStatus; version: number }>(
    db,
    "SELECT id, case_id, booking_id, status, version FROM containers WHERE id = ?",
    containerId,
  );
  if (!container) throw errors.notFound("Container not found");
  await assertCaseAccess(db, actor, container.case_id);
  if (container.version !== input.version) throw errors.conflict("Container was updated by someone else");
  assertContainerTransition(container.status, input.status);
  if (customFieldsRequiredNow("CONTAINER", input.status)) {
    await assertRequiredCustomFields(db, "CONTAINER", containerId);
  }
  const now = nowIso();
  await db
    .prepare("UPDATE containers SET status = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .bind(input.status, now, containerId)
    .run();
  await db
    .prepare(
      `INSERT INTO container_events (id, container_id, status, event_at, is_actual, note, actor_id, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(newId(), containerId, input.status, input.eventAt ?? now, input.note ?? null, actor.id, now)
    .run();
  const containers = await all<{ status: ContainerStatus; official_number: string | null }>(
    db,
    "SELECT status, official_number FROM containers WHERE booking_id = ?",
    container.booking_id,
  );
  const booking = await one<{ expected_containers: number }>(db, "SELECT expected_containers FROM bookings WHERE id = ?", container.booking_id);
  const aggregate = bookingAggregateFromContainers(
    booking?.expected_containers ?? containers.length,
    containers.map((c) => ({ status: c.status, officialNumber: c.official_number })),
  );
  await db
    .prepare("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('CANCELLED','DRAFT')")
    .bind(aggregate.suggestedStatus, now, container.booking_id)
    .run();
  await writeCaseEvent(db, container.case_id, "CONTAINER_STATUS", `Container → ${input.status}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "container", entityId: containerId, action: "container.status", after: input, requestId });
  await recomputeRemindersForCase(db, env, container.case_id);
}

export async function attachBookingConfirmation(
  db: D1Database,
  actor: Actor,
  bookingId: string,
  input: { r2Key: string; originalName: string },
  requestId: string,
) {
  requirePermission(actor, "bookings.manage");
  const booking = await one<{ case_id: string }>(db, "SELECT case_id FROM bookings WHERE id = ?", bookingId);
  if (!booking) throw errors.notFound("Booking not found");
  await assertCaseAccess(db, actor, booking.case_id);
  const owned = await one(
    db,
    "SELECT id FROM upload_sessions WHERE object_key = ? AND owner_user_id = ? AND parent_type = 'booking' AND parent_id = ? AND state = 'COMPLETED'",
    input.r2Key,
    actor.id,
    bookingId,
  );
  if (!owned) throw errors.notFound("Upload is not a completed session for this booking");
  const id = newId();
  await db
    .prepare(
      `INSERT INTO booking_attachments (id, booking_id, r2_key, original_name, kind, created_at) VALUES (?, ?, ?, ?, 'BOOKING_CONFIRMATION', ?)`,
    )
    .bind(id, bookingId, input.r2Key, input.originalName, nowIso())
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "booking", entityId: bookingId, action: "booking.confirmation", requestId });
  return { id };
}

export async function addContainerSlots(db: D1Database, actor: Actor, bookingId: string, count: number) {
  requirePermission(actor, "containers.manage");
  const booking = await one<{ case_id: string; expected_containers: number }>(
    db,
    "SELECT case_id, expected_containers FROM bookings WHERE id = ?",
    bookingId,
  );
  if (!booking) throw errors.notFound("Booking not found");
  await assertCaseAccess(db, actor, booking.case_id);
  const last = await one<{ n: number }>(db, "SELECT MAX(slot_index) AS n FROM containers WHERE booking_id = ?", bookingId);
  const start = (last?.n ?? 0) + 1;
  const now = nowIso();
  for (let i = 0; i < count; i += 1) {
    await db
      .prepare(
        `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'PLANNED', 1, ?, ?)`,
      )
      .bind(newId(), bookingId, booking.case_id, start + i, now, now)
      .run();
  }
  await db
    .prepare("UPDATE bookings SET expected_containers = expected_containers + ?, updated_at = ? WHERE id = ?")
    .bind(count, now, bookingId)
    .run();
}

export async function listSchedule(db: D1Database, actor: Actor, query: { from?: string; to?: string }) {
  requirePermission(actor, "bookings.view");
  const vis = caseVisibilitySql(actor, "c");
  return all(
    db,
    `SELECT b.id, b.booking_number, b.planned_loading_date, b.actual_loading_date, b.cutoff_date,
            b.planned_etd, b.actual_etd, b.planned_eta, b.actual_eta, b.port_of_loading, b.port_of_discharge,
            c.case_reference, c.id AS case_id, cu.legal_name AS customer_name
     FROM bookings b
     JOIN export_cases c ON c.id = b.case_id
     JOIN customers cu ON cu.id = c.customer_id
     WHERE b.status != 'CANCELLED'
       AND ${vis.sql}
       AND (? IS NULL OR COALESCE(b.planned_etd, b.planned_loading_date, b.planned_eta) >= ?)
       AND (? IS NULL OR COALESCE(b.planned_etd, b.planned_loading_date, b.planned_eta) <= ?)
     ORDER BY COALESCE(b.planned_etd, b.planned_loading_date, b.planned_eta)`,
    ...vis.binds,
    query.from ?? null,
    query.from ?? null,
    query.to ?? null,
    query.to ?? null,
  );
}

export async function listContainers(db: D1Database, actor: Actor, query: { q?: string; status?: string }) {
  requirePermission(actor, "containers.view");
  const vis = caseVisibilitySql(actor, "c");
  return all(
    db,
    `SELECT ct.*, b.booking_number, c.case_reference
     FROM containers ct
     JOIN bookings b ON b.id = ct.booking_id
     JOIN export_cases c ON c.id = ct.case_id
     WHERE ${vis.sql}
       AND (? IS NULL OR ct.official_number LIKE ? OR b.booking_number LIKE ?)
       AND (? IS NULL OR ct.status = ?)
     ORDER BY ct.updated_at DESC
     LIMIT 200`,
    ...vis.binds,
    query.q ?? null,
    query.q ? `%${query.q}%` : null,
    query.q ? `%${query.q}%` : null,
    query.status ?? null,
    query.status ?? null,
  );
}
