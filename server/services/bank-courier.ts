import { carrierTrackingUrl } from "../../shared/carrier";
import type { BankPathStatus, CourierStatus, DirectPathStatus, DocumentRoute } from "../../shared/enums";
import { assertBankTransition, assertCourierTransition, assertDirectTransition } from "../domain/transitions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";
import { writeAudit, writeCaseEvent } from "./audit";
import { recomputeRemindersForCase } from "./reminders";

export async function transitionBank(
  db: D1Database,
  actor: Actor,
  env: Env,
  caseId: string,
  to: BankPathStatus,
  input: { bankName?: string; reason?: string },
  requestId: string,
) {
  requirePermission(actor, "bank.manage");
  const current = await assertCaseAccess(db, actor, caseId);
  if (current.document_route !== "BANK_ROUTE") {
    throw errors.conflict("Bank path is not used for the direct document route");
  }
  assertBankTransition(current.bank_path_status as BankPathStatus, to);
  await db
    .prepare("UPDATE export_cases SET bank_path_status = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .bind(to, nowIso(), caseId)
    .run();
  let submission = await one<{ id: string; attempt: number }>(
    db,
    "SELECT id, attempt FROM bank_submissions WHERE case_id = ? ORDER BY attempt DESC LIMIT 1",
    caseId,
  );
  if (!submission || to === "READY_FOR_PHYSICAL_HANDOVER" && current.bank_path_status === "CORRECTION_REQUESTED") {
    const attempt = (submission?.attempt ?? 0) + 1;
    const id = newId();
    await db
      .prepare(
        `INSERT INTO bank_submissions (id, case_id, attempt, bank_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, caseId, attempt, input.bankName ?? null, to, nowIso(), nowIso())
      .run();
    submission = { id, attempt };
  } else if (submission) {
    await db
      .prepare("UPDATE bank_submissions SET status = ?, bank_name = COALESCE(?, bank_name), handed_over_at = ?, handed_over_by = ?, updated_at = ? WHERE id = ?")
      .bind(
        to,
        input.bankName ?? null,
        to === "HANDED_TO_BANK" ? nowIso() : null,
        to === "HANDED_TO_BANK" ? actor.id : null,
        nowIso(),
        submission.id,
      )
      .run();
  }
  if (submission) {
    await db
      .prepare("INSERT INTO bank_events (id, submission_id, event_type, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId(), submission.id, to, input.reason ?? null, actor.id, nowIso())
      .run();
  }
  await writeCaseEvent(db, caseId, "BANK_STATUS", `Bank path → ${to}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "bank_submission", entityId: caseId, action: "bank.transition", after: { to }, requestId });
  await recomputeRemindersForCase(db, env, caseId);
}

export async function transitionDirect(
  db: D1Database,
  actor: Actor,
  env: Env,
  caseId: string,
  to: DirectPathStatus,
  _requestId: string,
) {
  requirePermission(actor, "export_cases.edit");
  const current = await assertCaseAccess(db, actor, caseId);
  if (current.document_route !== "DIRECT_ROUTE") {
    throw errors.conflict("Direct path is not used for the bank document route");
  }
  assertDirectTransition((current.direct_path_status ?? "PREPARING") as DirectPathStatus, to);
  await db
    .prepare("UPDATE export_cases SET direct_path_status = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .bind(to, nowIso(), caseId)
    .run();
  await writeCaseEvent(db, caseId, "DIRECT_STATUS", `Direct path → ${to}`, actor.id);
  await recomputeRemindersForCase(db, env, caseId);
}

export async function listCourier(db: D1Database, actor: Actor, caseId: string) {
  requirePermission(actor, "courier.view");
  await assertCaseAccess(db, actor, caseId);
  const shipments = await all<{ id: string; carrier: string; tracking_number: string | null; status: string }>(
    db,
    "SELECT * FROM courier_shipments WHERE case_id = ? ORDER BY created_at DESC",
    caseId,
  );
  const result = [];
  for (const shipment of shipments) {
    const events = await all(db, "SELECT * FROM courier_tracking_events WHERE shipment_id = ? ORDER BY event_at", shipment.id);
    result.push({
      ...shipment,
      trackingUrl: shipment.tracking_number ? carrierTrackingUrl(shipment.carrier, shipment.tracking_number) : null,
      events,
      source: "MANUAL",
    });
  }
  return result;
}

export async function createCourier(
  db: D1Database,
  actor: Actor,
  env: Env,
  caseId: string,
  input: {
    sender: "COMPANY" | "BANK";
    carrier: string;
    trackingNumber?: string;
    recipientSummary?: string;
    sentAt?: string;
    expectedAt?: string;
  },
  requestId: string,
) {
  requirePermission(actor, "courier.manage");
  const current = await assertCaseAccess(db, actor, caseId);
  if (input.sender === "BANK" && current.document_route !== "BANK_ROUTE") {
    throw errors.validation("Bank can only dispatch on the bank document route");
  }
  if (input.trackingNumber && !carrierTrackingUrl(input.carrier, input.trackingNumber) && input.trackingNumber.length > 0) {
    throw errors.validation("Carrier is not on the allowlist, so no tracking URL will be generated. Enter a supported carrier (DHL, UPS, FEDEX, ARAMEX, TNT) or leave tracking as reference-only.");
  }
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO courier_shipments (
        id, case_id, route, sender, carrier, tracking_number, recipient_summary, status, sent_at, expected_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NOT_DISPATCHED', ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      caseId,
      current.document_route,
      input.sender,
      input.carrier.toUpperCase(),
      input.trackingNumber ?? null,
      input.recipientSummary ?? null,
      input.sentAt ?? null,
      input.expectedAt ?? null,
      now,
      now,
    )
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "courier", entityId: id, action: "courier.create", requestId });
  await recomputeRemindersForCase(db, env, caseId);
  return { id };
}

export async function updateCourierStatus(
  db: D1Database,
  actor: Actor,
  env: Env,
  shipmentId: string,
  input: { status: CourierStatus; note?: string; eventAt?: string; version: number },
  requestId: string,
) {
  requirePermission(actor, "courier.manage");
  const shipment = await one<{ id: string; case_id: string; status: CourierStatus; version: number }>(
    db,
    "SELECT id, case_id, status, version FROM courier_shipments WHERE id = ?",
    shipmentId,
  );
  if (!shipment) throw errors.notFound("Shipment not found");
  await assertCaseAccess(db, actor, shipment.case_id);
  if (shipment.version !== input.version) throw errors.conflict("Courier shipment was updated by someone else");
  assertCourierTransition(shipment.status, input.status);
  const now = nowIso();
  await db
    .prepare(
      `UPDATE courier_shipments SET status = ?, delivered_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(input.status, input.status === "DELIVERED" ? now : null, now, shipmentId)
    .run();
  await db
    .prepare(
      `INSERT INTO courier_tracking_events (id, shipment_id, status, note, event_at, actor_id, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?)`,
    )
    .bind(newId(), shipmentId, input.status, input.note ?? null, input.eventAt ?? now, actor.id, now)
    .run();
  if (input.status === "DISPATCHED" || input.status === "DELIVERED") {
    const c = await one<{ document_route: DocumentRoute }>(db, "SELECT document_route FROM export_cases WHERE id = ?", shipment.case_id);
    if (c?.document_route === "BANK_ROUTE" && input.status === "DISPATCHED") {
      await db.prepare("UPDATE export_cases SET bank_path_status = 'COURIER_DISPATCHED', updated_at = ? WHERE id = ?").bind(now, shipment.case_id).run();
    }
    if (c?.document_route === "DIRECT_ROUTE" && input.status === "DISPATCHED") {
      await db.prepare("UPDATE export_cases SET direct_path_status = 'COURIER_DISPATCHED', updated_at = ? WHERE id = ?").bind(now, shipment.case_id).run();
    }
    if (input.status === "DELIVERED") {
      if (c?.document_route === "BANK_ROUTE") {
        await db.prepare("UPDATE export_cases SET bank_path_status = 'DOCUMENTS_DELIVERED', updated_at = ? WHERE id = ?").bind(now, shipment.case_id).run();
      } else {
        await db.prepare("UPDATE export_cases SET direct_path_status = 'DOCUMENTS_DELIVERED', updated_at = ? WHERE id = ?").bind(now, shipment.case_id).run();
      }
    }
  }
  await writeCaseEvent(db, shipment.case_id, "COURIER_STATUS", `Courier ${input.status} (manual)`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "courier", entityId: shipmentId, action: "courier.status", after: input, requestId });
  await recomputeRemindersForCase(db, env, shipment.case_id);
}
