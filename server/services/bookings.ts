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

async function assertBookingScope(db: D1Database, actor: Actor, caseId: string | null) {
  if (caseId) await assertCaseAccess(db, actor, caseId);
}

async function planContainerCountChange(
  db: D1Database,
  actor: Actor,
  bookingId: string,
  caseId: string | null,
  version: number,
  target: number,
) {
  if (target < 0 || target > 100) {
    throw errors.validation("Enter a whole number of containers from 0 to 100.", { expectedContainers: "Enter a whole number from 0 to 100." }, "CONTAINER_COUNT_INVALID");
  }
  const slots = await all<{ id: string; slot_index: number; status: string; official_number: string | null }>(
    db,
    "SELECT id, slot_index, status, official_number FROM containers WHERE booking_id = ? ORDER BY slot_index",
    bookingId,
  );
  const active = slots.filter((slot) => slot.status !== "CANCELLED");
  if (target === active.length) return { count: target, statements: [] as D1PreparedStatement[] };
  requirePermission(actor, "containers.manage");
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (target > active.length) {
    const last = slots.reduce((max, slot) => Math.max(max, slot.slot_index), 0);
    const add = target - active.length;
    if (last + add > 100) {
      throw errors.validation("A booking cannot have more than 100 container slots.", { expectedContainers: "Choose a smaller number." }, "CONTAINER_COUNT_LIMIT");
    }
    for (let i = 0; i < add; i += 1) {
      statements.push(
        db
          .prepare(
            `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'PLANNED', 1, ?, ?
             WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND version = ?)`,
          )
          .bind(newId(), bookingId, caseId, last + 1 + i, now, now, bookingId, version),
      );
    }
  } else {
    const removable = active
      .filter((slot) => slot.status === "PLANNED" && !String(slot.official_number || "").trim())
      .sort((a, b) => b.slot_index - a.slot_index);
    const remove = active.length - target;
    if (removable.length < remove) {
      throw errors.validation(
        "Only an empty planned container can be removed. A container that already has a number or has moved on stays.",
        { expectedContainers: "Remove only empty planned containers." },
        "CONTAINER_SLOT_IN_USE",
      );
    }
    for (const slot of removable.slice(0, remove)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM containers
             WHERE id = ? AND status = 'PLANNED' AND (official_number IS NULL OR official_number = '')
               AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND version = ?)`,
          )
          .bind(slot.id, bookingId, version),
      );
    }
  }
  return { count: target, statements };
}

async function assertCaseHasNoLiveBooking(db: D1Database, caseId: string) {
  const existing = await one(
    db,
    "SELECT id FROM bookings WHERE case_id = ? AND status != 'CANCELLED'",
    caseId,
  );
  if (existing) throw errors.conflict("This export operation already has its sea booking.", "CASE_HAS_BOOKING");
}

export async function listBookings(db: D1Database, actor: Actor, query: { page?: number; pageSize?: number; q?: string; unlinked?: boolean }) {
  requirePermission(actor, "bookings.view");
  const page = normalizePage(query.page, query.pageSize);
  const vis = caseVisibilitySql(actor, "c");
  const filters = [`(b.case_id IS NULL OR (${vis.sql}))`];
  const binds: unknown[] = [...vis.binds];
  if (query.unlinked) filters.push("b.case_id IS NULL");
  if (query.q) {
    filters.push("(b.booking_number LIKE ? OR c.case_reference LIKE ? OR b.ucr LIKE ?)");
    binds.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  const rows = await all(
    db,
    `SELECT b.*, c.case_reference, cu.legal_name AS customer_name
     FROM bookings b
     LEFT JOIN export_cases c ON c.id = b.case_id
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE ${filters.join(" AND ")}
     ORDER BY COALESCE(b.planned_loading_date, b.planned_etd, b.created_at) DESC
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
  const caseId = typeof booking.case_id === "string" ? booking.case_id : null;
  if (caseId) await assertCaseAccess(db, actor, caseId);
  else requirePermission(actor, "bookings.view");
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
    caseId?: string;
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
  const caseId = input.caseId?.trim() || null;
  if (caseId) {
    await assertCaseAccess(db, actor, caseId);
    await assertCaseHasNoLiveBooking(db, caseId);
  }
  if (!Number.isInteger(input.expectedContainers) || input.expectedContainers < 0 || input.expectedContainers > 100) {
    throw errors.validation("Check the requested container count before saving the booking.", { expectedContainers: "Enter a whole number from 0 to 100." }, "BOOKING_CONTAINER_COUNT_INVALID");
  }
  const dup = await one(db, "SELECT id FROM bookings WHERE booking_number = ? AND status != 'CANCELLED'", input.bookingNumber);
  if (dup) throw errors.conflict("Booking number already exists");
  const id = newId();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO bookings (
          id, case_id, booking_number, ucr, shipping_line, vessel, voyage, port_of_loading, port_of_discharge,
          expected_containers, status, planned_loading_date, cutoff_date, planned_etd, planned_eta, notes, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        caseId,
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
      ),
  ];
  for (let i = 1; i <= input.expectedContainers; i += 1) {
    statements.push(
      db
        .prepare(
          `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'PLANNED', 1, ?, ?)`,
        )
        .bind(newId(), id, caseId, i, now, now),
    );
  }
  // One D1 batch is atomic: the booking and its slots appear together or not at all.
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/bookings_one_open_case_idx|UNIQUE constraint failed: bookings\.case_id/i.test(message)) {
      throw errors.conflict("This export operation already has its sea booking.", "CASE_HAS_BOOKING");
    }
    if (/unique|constraint/i.test(message)) {
      throw errors.conflict("Booking number already exists", "BOOKING_NUMBER_TAKEN");
    }
    throw error;
  }
  if (caseId) await writeCaseEvent(db, caseId, "BOOKING_CREATED", `Booking ${input.bookingNumber}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "booking", entityId: id, action: "booking.create", requestId });
  if (caseId) await recomputeRemindersForCase(db, env, caseId);
  return { id };
}

export async function linkBookingToCase(
  db: D1Database,
  actor: Actor,
  env: Env,
  bookingId: string,
  input: { caseId: string },
  requestId: string,
) {
  requirePermission(actor, "bookings.manage");
  const caseId = input.caseId?.trim();
  if (!caseId) throw errors.validation("Choose the export case to link.", { caseId: "CASE_REQUIRED" }, "CASE_REQUIRED");
  const parent = await assertCaseAccess(db, actor, caseId);
  if (parent.status === "COMPLETED" || parent.status === "CANCELLED" || parent.status === "ARCHIVED") {
    throw errors.conflict("Link the booking to an open export case.", "CASE_NOT_OPEN");
  }
  const booking = await one<{ id: string; case_id: string | null; booking_number: string }>(
    db,
    "SELECT id, case_id, booking_number FROM bookings WHERE id = ?",
    bookingId,
  );
  if (!booking) throw errors.notFound("Booking not found");
  if (booking.case_id) throw errors.conflict("This booking is already linked to an export case.", "BOOKING_ALREADY_LINKED");
  await assertCaseHasNoLiveBooking(db, caseId);
  const now = nowIso();
  const linked = await db.batch([
    db.prepare("UPDATE bookings SET case_id = ?, updated_at = ? WHERE id = ? AND case_id IS NULL").bind(caseId, now, bookingId),
    db.prepare("UPDATE containers SET case_id = ?, updated_at = ? WHERE booking_id = ? AND case_id IS NULL").bind(caseId, now, bookingId),
  ]);
  if (!linked[0]?.meta.changes) throw errors.conflict("This booking is already linked to an export case.", "BOOKING_ALREADY_LINKED");
  await writeCaseEvent(db, caseId, "BOOKING_LINKED", `Booking ${booking.booking_number}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "booking", entityId: bookingId, action: "booking.link", after: { caseId }, requestId });
  await recomputeRemindersForCase(db, env, caseId);
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
  const booking = await one<{ case_id: string | null; version: number; status: BookingStatus }>(
    db,
    "SELECT case_id, version, status FROM bookings WHERE id = ?",
    id,
  );
  if (!booking) throw errors.notFound("Booking not found");
  await assertBookingScope(db, actor, booking.case_id);
  if (booking.version !== input.version) throw errors.conflict("Booking was updated by someone else");
  if (input.status && input.status !== booking.status) {
    assertBookingTransition(booking.status, input.status as BookingStatus);
  }
  const nextStatus = typeof input.status === "string" ? input.status : booking.status;
  // BR-U1 / UAT-06: a booking may stay a draft without a UCR, but it can never
  // be confirmed (or moved past confirmation) without an active UCR number.
  const CONFIRMED_OR_LATER: readonly string[] = [
    "CONFIRMED",
    "LOADING_IN_PROGRESS",
    "LOADED",
    "DEPARTED",
    "ARRIVED_PORT",
    "CLOSED",
  ];
  const effectiveUcr = typeof input.ucr === "string" ? input.ucr.trim() : "";
  if (CONFIRMED_OR_LATER.includes(nextStatus) && effectiveUcr.length === 0) {
    throw errors.validation(
      "A booking cannot be confirmed without an active UCR number.",
      { ucr: "Enter the active UCR reference before confirming the booking." },
      "BOOKING_UCR_REQUIRED",
    );
  }
  if (customFieldsRequiredNow("BOOKING", nextStatus)) {
    await assertRequiredCustomFields(db, "BOOKING", id);
  }
  const duplicate = await one(
    db,
    "SELECT id FROM bookings WHERE booking_number = ? AND status != 'CANCELLED' AND id != ?",
    input.bookingNumber,
    id,
  );
  if (duplicate) throw errors.conflict("Booking number already exists", "BOOKING_NUMBER_TAKEN");
  const requestedContainers = Number(input.expectedContainers);
  const slotChange = Number.isInteger(requestedContainers)
    ? await planContainerCountChange(db, actor, id, booking.case_id, booking.version, requestedContainers)
    : { count: requestedContainers, statements: [] as D1PreparedStatement[] };
  const saved = await db.batch([
    ...slotChange.statements,
    db
      .prepare(
        `UPDATE bookings SET booking_number=?, ucr=?, shipping_line=?, vessel=?, voyage=?, port_of_loading=?, port_of_discharge=?,
          expected_containers=?, status=?, planned_loading_date=?, actual_loading_date=?, cutoff_date=?, planned_etd=?, actual_etd=?,
          planned_eta=?, actual_eta=?, notes=?, version=version+1, updated_at=?
         WHERE id=? AND version=?`,
      )
      .bind(
        input.bookingNumber,
        input.ucr ?? null,
        input.shippingLine ?? null,
        input.vessel ?? null,
        input.voyage ?? null,
        input.portOfLoading ?? null,
        input.portOfDischarge ?? null,
        slotChange.count,
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
        booking.version,
      ),
  ]);
  if (!saved.at(-1)?.meta.changes) throw errors.conflict("Booking was updated by someone else");
  await writeAudit(db, { actorId: actor.id, entityType: "booking", entityId: id, action: "booking.update", requestId });
  if (booking.case_id) await recomputeRemindersForCase(db, env, booking.case_id);
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
  const container = await one<{ id: string; case_id: string | null; status: ContainerStatus; version: number }>(
    db,
    "SELECT id, case_id, status, version FROM containers WHERE id = ?",
    containerId,
  );
  if (!container) throw errors.notFound("Container not found");
  await assertBookingScope(db, actor, container.case_id);
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
  const updated = await db
    .prepare(
      `UPDATE containers SET official_number = ?, official_number_override = ?, status = CASE WHEN status = 'PLANNED' THEN 'NUMBER_ASSIGNED' ELSE status END, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .bind(official, input.override ? 1 : 0, nowIso(), containerId, container.version)
    .run();
  if (!updated.meta.changes) throw errors.conflict("Container was updated by someone else");
  await db
    .prepare(
      `INSERT INTO container_events (id, container_id, status, event_at, is_actual, note, actor_id, created_at)
       VALUES (?, ?, 'NUMBER_ASSIGNED', ?, 1, ?, ?, ?)`,
    )
    .bind(newId(), containerId, nowIso(), input.override ? "Authorized override of ISO check" : null, actor.id, nowIso())
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "container", entityId: containerId, action: "container.number", after: { official, override: input.override }, requestId });
  if (container.case_id) await recomputeRemindersForCase(db, env, container.case_id);
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
  const container = await one<{ id: string; case_id: string | null; booking_id: string; status: ContainerStatus; version: number }>(
    db,
    "SELECT id, case_id, booking_id, status, version FROM containers WHERE id = ?",
    containerId,
  );
  if (!container) throw errors.notFound("Container not found");
  await assertBookingScope(db, actor, container.case_id);
  if (container.version !== input.version) throw errors.conflict("Container was updated by someone else");
  assertContainerTransition(container.status, input.status);
  if (customFieldsRequiredNow("CONTAINER", input.status)) {
    await assertRequiredCustomFields(db, "CONTAINER", containerId);
  }
  const now = nowIso();
  const updated = await db
    .prepare("UPDATE containers SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
    .bind(input.status, now, containerId, container.version)
    .run();
  if (!updated.meta.changes) throw errors.conflict("Container was updated by someone else");
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
  const activeSlotCount = containers.filter((c) => c.status !== "CANCELLED").length;
  // A cancellation shrinks the plan by one, and never below the slots that are
  // still active, so an old expected_containers value cannot outlive the slot.
  const expectedContainers =
    input.status === "CANCELLED"
      ? Math.max(activeSlotCount, (booking?.expected_containers ?? activeSlotCount) - 1)
      : (booking?.expected_containers ?? containers.length);
  if (input.status === "CANCELLED" && expectedContainers !== booking?.expected_containers) {
    await db
      .prepare("UPDATE bookings SET expected_containers = ?, updated_at = ? WHERE id = ?")
      .bind(expectedContainers, now, container.booking_id)
      .run();
  }
  const aggregate = bookingAggregateFromContainers(
    expectedContainers,
    containers.map((c) => ({ status: c.status, officialNumber: c.official_number })),
  );
  await db
    .prepare("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('CANCELLED','DRAFT')")
    .bind(aggregate.suggestedStatus, now, container.booking_id)
    .run();
  if (container.case_id) await writeCaseEvent(db, container.case_id, "CONTAINER_STATUS", `Container → ${input.status}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "container", entityId: containerId, action: "container.status", after: input, requestId });
  if (container.case_id) await recomputeRemindersForCase(db, env, container.case_id);
}

export async function attachBookingConfirmation(
  db: D1Database,
  actor: Actor,
  bookingId: string,
  input: { r2Key: string; originalName: string },
  requestId: string,
) {
  requirePermission(actor, "bookings.manage");
  const booking = await one<{ case_id: string | null }>(db, "SELECT case_id FROM bookings WHERE id = ?", bookingId);
  if (!booking) throw errors.notFound("Booking not found");
  await assertBookingScope(db, actor, booking.case_id);
  const owned = await one<{ filename: string }>(
    db,
    "SELECT filename FROM upload_sessions WHERE object_key = ? AND owner_user_id = ? AND parent_type = 'booking' AND parent_id = ? AND state = 'COMPLETED'",
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
    .bind(id, bookingId, input.r2Key, owned.filename, nowIso())
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "booking", entityId: bookingId, action: "booking.confirmation", requestId });
  return { id };
}

export async function addContainerSlots(db: D1Database, actor: Actor, bookingId: string, count: number) {
  requirePermission(actor, "containers.manage");
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw errors.validation("Enter a whole number of containers from 1 to 100.", { count: "Enter a whole number from 1 to 100." }, "CONTAINER_COUNT_INVALID");
  }
  const booking = await one<{ case_id: string | null; expected_containers: number }>(
    db,
    "SELECT case_id, expected_containers FROM bookings WHERE id = ?",
    bookingId,
  );
  if (!booking) throw errors.notFound("Booking not found");
  await assertBookingScope(db, actor, booking.case_id);
  const last = await one<{ n: number }>(db, "SELECT MAX(slot_index) AS n FROM containers WHERE booking_id = ?", bookingId);
  const start = (last?.n ?? 0) + 1;
  if (start + count - 1 > 100) {
    throw errors.validation("A booking cannot have more than 100 container slots.", { count: "Choose a smaller number." }, "CONTAINER_COUNT_LIMIT");
  }
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < count; i += 1) {
    statements.push(
      db
        .prepare(
          `INSERT INTO containers (id, booking_id, case_id, slot_index, status, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'PLANNED', 1, ?, ?)`,
        )
        .bind(newId(), bookingId, booking.case_id, start + i, now, now),
    );
  }
  statements.push(
    db
      .prepare("UPDATE bookings SET expected_containers = expected_containers + ?, updated_at = ? WHERE id = ?")
      .bind(count, now, bookingId),
  );
  try {
    // Slots and the expected count change in one transaction, so a failed
    // insert cannot leave a booking reporting a count it does not have.
    await db.batch(statements);
  } catch (error) {
    if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
      throw errors.conflict("Container slots changed in another session. Refresh and try again.", "CONTAINER_SLOT_CONFLICT");
    }
    throw error;
  }
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
     LEFT JOIN export_cases c ON c.id = b.case_id
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE b.status != 'CANCELLED'
       AND (b.case_id IS NULL OR (${vis.sql}))
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
     LEFT JOIN export_cases c ON c.id = ct.case_id
     WHERE (ct.case_id IS NULL OR (${vis.sql}))
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
