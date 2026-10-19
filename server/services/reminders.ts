import type { ReminderCondition, ReminderInstance, ReminderRule } from "../domain/reminders";
import { buildDedupKey, computeDueAt, conditionStillHolds, evaluateDue, notificationCycleKey } from "../domain/reminders";
import { systemClock, type Clock } from "../domain/dates";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, caseVisibilitySql, requirePermission } from "./actor";

type RuleRow = {
  id: string;
  family: ReminderRule["family"];
  enabled: number;
  offset_amount: number;
  offset_direction: "BEFORE" | "AFTER";
  offset_unit: "HOURS" | "DAYS";
  day_policy: "CALENDAR" | "BUSINESS";
  condition_key: ReminderCondition;
  mandatory: number;
};

function toRule(row: RuleRow): ReminderRule {
  return {
    id: row.id,
    family: row.family,
    enabled: Boolean(row.enabled),
    offsetAmount: row.offset_amount,
    offsetDirection: row.offset_direction,
    offsetUnit: row.offset_unit,
    dayPolicy: row.day_policy,
    condition: row.condition_key,
    mandatory: Boolean(row.mandatory),
  };
}

export async function recomputeRemindersForCase(
  db: D1Database,
  env: Env,
  caseId: string,
  clock: Clock = systemClock,
  onlyRuleId?: string,
) {
  const timeZone = env.COMPANY_TIMEZONE || "Africa/Cairo";
  const exportCase = await one<{
    id: string;
    created_at: string;
    assigned_to: string | null;
    document_route: string;
    bank_path_status: string;
    direct_path_status: string | null;
  }>(db, "SELECT id, created_at, assigned_to, document_route, bank_path_status, direct_path_status FROM export_cases WHERE id = ?", caseId);
  if (!exportCase) return;

  const rules = (await all<RuleRow>(db, "SELECT * FROM reminder_rule_definitions WHERE enabled = 1"))
    .map(toRule)
    .filter((rule) => !onlyRuleId || rule.id === onlyRuleId);
  const requirements = await all<{ id: string; status: string; due_date: string | null; required: number; created_at: string; name_en: string }>(
    db,
    `SELECT r.id, r.status, r.due_date, r.required, r.created_at, t.name_en
     FROM operation_document_requirements r
     JOIN document_type_definitions t ON t.id = r.document_type_id
     WHERE r.case_id = ?`,
    caseId,
  );
  const bookings = await all<{
    id: string;
    planned_loading_date: string | null;
    cutoff_date: string | null;
    planned_etd: string | null;
    actual_etd: string | null;
    planned_eta: string | null;
    actual_eta: string | null;
  }>(db, "SELECT * FROM bookings WHERE case_id = ? AND status != 'CANCELLED'", caseId);
  const containers = await all<{ id: string; status: string; updated_at: string }>(
    db,
    "SELECT id, status, updated_at FROM containers WHERE case_id = ? AND status != 'CANCELLED'",
    caseId,
  );
  const couriers = await all<{ id: string; status: string; sent_at: string | null }>(
    db,
    "SELECT id, status, sent_at FROM courier_shipments WHERE case_id = ?",
    caseId,
  );

  const facts = {
    bankReviewPending: exportCase.bank_path_status === "BANK_REVIEW" || exportCase.bank_path_status === "HANDED_TO_BANK",
    courierDelivered: couriers.some((c) => c.status === "DELIVERED"),
    goodsDelivered: containers.length > 0 && containers.every((c) => c.status === "DELIVERED_TO_CUSTOMER"),
  };

  for (const req of requirements) {
    const documentReady = req.status !== "MISSING";
    const reviewPending = req.status === "UPLOADED" || req.status === "UNDER_REVIEW";
    for (const rule of rules) {
      if (rule.family === "DOCUMENT_REQUIREMENT_NOT_READY" && req.required) {
        await upsertInstance(db, {
          rule,
          caseId,
          targetType: "document_requirement",
          targetId: req.id,
          owner: exportCase.assigned_to,
          sourceDate: req.due_date ?? req.created_at.slice(0, 10),
          timeZone,
          generation: 1,
          conditionHolds: !documentReady,
          facts: { documentReady, reviewPending, ...facts, actualDepartureAt: null, actualArrivalAt: null },
          clock,
          reason: `Required document is not yet uploaded: ${req.name_en}`,
          nextAction: "Upload a scanned PDF of the original",
        });
      }
      if (rule.family === "DOCUMENT_REVIEW_PENDING") {
        const latest = await one<{ created_at: string }>(
          db,
          "SELECT created_at FROM document_versions WHERE requirement_id = ? ORDER BY version DESC LIMIT 1",
          req.id,
        );
        await upsertInstance(db, {
          rule,
          caseId,
          targetType: "document_requirement",
          targetId: req.id,
          owner: exportCase.assigned_to,
          sourceDate: (latest?.created_at ?? req.created_at).slice(0, 10),
          timeZone,
          generation: 1,
          conditionHolds: reviewPending,
          facts: { documentReady, reviewPending, ...facts, actualDepartureAt: null, actualArrivalAt: null },
          clock,
          reason: `Uploaded document is waiting for review: ${req.name_en}`,
          nextAction: "Review and approve or request correction",
        });
      }
    }
  }

  for (const rule of rules) {
    if (rule.family === "BANK_REVIEW_OVERDUE") {
      const handover = await one<{ created_at: string }>(
        db,
        "SELECT created_at FROM bank_events WHERE event_type = 'HANDED_TO_BANK' AND submission_id IN (SELECT id FROM bank_submissions WHERE case_id = ?) ORDER BY created_at DESC LIMIT 1",
        caseId,
      );
      await upsertInstance(db, {
        rule,
        caseId,
        targetType: "export_case",
        targetId: caseId,
        owner: exportCase.assigned_to,
        sourceDate: (handover?.created_at ?? exportCase.created_at).slice(0, 10),
        timeZone,
        generation: 1,
        conditionHolds: facts.bankReviewPending,
        facts: { documentReady: true, reviewPending: false, ...facts, actualDepartureAt: null, actualArrivalAt: null },
        clock,
        reason: "Bank still has originals under review",
        nextAction: "Record the bank decision",
      });
    }
    if (rule.family === "COURIER_STATUS_CHECK") {
      for (const courier of couriers) {
        await upsertInstance(db, {
          rule,
          caseId,
          targetType: "courier",
          targetId: courier.id,
          owner: exportCase.assigned_to,
          sourceDate: (courier.sent_at ?? nowIso()).slice(0, 10),
          timeZone,
          generation: 1,
          conditionHolds: courier.status === "DISPATCHED" || courier.status === "IN_TRANSIT",
          facts: { documentReady: true, reviewPending: false, ...facts, actualDepartureAt: null, actualArrivalAt: null },
          clock,
          reason: "Courier shipment needs a manual status check",
          nextAction: "Enter the latest carrier-reported status",
        });
      }
    }
    for (const booking of bookings) {
      const dateByFamily: Record<string, string | null> = {
        BOOKING_LOADING_APPROACHING: booking.planned_loading_date,
        BOOKING_CUTOFF_APPROACHING: booking.cutoff_date,
        BOOKING_ETD_FOLLOWUP: booking.actual_etd ?? booking.planned_etd,
        VESSEL_ETA_APPROACHING: booking.planned_eta,
        ARRIVAL_OVERDUE: booking.planned_eta,
        GOODS_DELIVERY_PENDING: booking.actual_eta,
      };
      if (!(rule.family in dateByFamily)) continue;
      const source = dateByFamily[rule.family];
      if (!source) continue;
      const generation = hashGeneration(source);
      await upsertInstance(db, {
        rule,
        caseId,
        targetType: "booking",
        targetId: booking.id,
        owner: exportCase.assigned_to,
        sourceDate: source.slice(0, 10),
        timeZone,
        generation,
        conditionHolds: conditionStillHolds({
          condition: rule.condition,
          documentReady: true,
          reviewPending: false,
          bankReviewPending: facts.bankReviewPending,
          courierDelivered: facts.courierDelivered,
          actualDepartureAt: booking.actual_etd,
          actualArrivalAt: booking.actual_eta,
          goodsDelivered: facts.goodsDelivered,
        }),
        facts: {
          documentReady: true,
          reviewPending: false,
          ...facts,
          actualDepartureAt: booking.actual_etd,
          actualArrivalAt: booking.actual_eta,
        },
        clock,
        reason: rule.family.replaceAll("_", " ").toLowerCase(),
        nextAction: "Review booking dates and container progress",
      });
    }
    if (rule.family === "CONTAINER_STATUS_FOLLOWUP") {
      for (const container of containers.filter((c) => c.status === "LOADED" || c.status === "DEPARTED")) {
        await upsertInstance(db, {
          rule,
          caseId,
          targetType: "container",
          targetId: container.id,
          owner: exportCase.assigned_to,
          sourceDate: container.updated_at.slice(0, 10),
          timeZone,
          generation: 1,
          conditionHolds: container.status !== "DELIVERED_TO_CUSTOMER",
          facts: { documentReady: true, reviewPending: false, ...facts, actualDepartureAt: null, actualArrivalAt: null },
          clock,
          reason: "Container milestone follow-up",
          nextAction: "Update the actual container event",
        });
      }
    }
  }

  const next = await one<{ next_action: string }>(
    db,
    `SELECT next_action FROM reminder_instances
     WHERE case_id = ? AND status IN ('ACTIVE','PENDING','SNOOZED','ACKNOWLEDGED')
     ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'SNOOZED' THEN 2 ELSE 3 END, due_at
     LIMIT 1`,
    caseId,
  );
  await db
    .prepare("UPDATE export_cases SET next_action = ? WHERE id = ?")
    .bind(next?.next_action ?? "No open reminder", caseId)
    .run();
}

async function upsertInstance(
  db: D1Database,
  input: {
    rule: ReminderRule;
    caseId: string;
    targetType: string;
    targetId: string;
    owner: string | null;
    sourceDate: string;
    timeZone: string;
    generation: number;
    conditionHolds: boolean;
    facts: Omit<Parameters<typeof conditionStillHolds>[0], "condition">;
    clock: Clock;
    reason: string;
    nextAction: string;
  },
) {
  const dedupKey = buildDedupKey({
    ruleId: input.rule.id,
    sourceEntityId: input.targetId,
    conditionGeneration: input.generation,
  });
  const due = computeDueAt({ rule: input.rule, sourceDateOnly: input.sourceDate.slice(0, 10), timeZone: input.timeZone });
  const existing = await one<ReminderInstance & { snoozed_until: string | null; resolved_at: string | null; due_at: string }>(
    db,
    "SELECT * FROM reminder_instances WHERE dedup_key = ?",
    dedupKey,
  );
  const now = nowIso(input.clock.now());
  if (!input.conditionHolds) {
    if (existing && existing.status !== "RESOLVED" && existing.status !== "CANCELLED") {
      await db
        .prepare("UPDATE reminder_instances SET status = 'RESOLVED', resolved_at = ?, snoozed_until = NULL, last_evaluated_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, now, existing.id)
        .run();
    }
    await db
      .prepare(
        `UPDATE reminder_instances SET status = 'CANCELLED', last_evaluated_at = ?, updated_at = ?
         WHERE rule_id = ? AND target_id = ? AND dedup_key != ? AND status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED')`,
      )
      .bind(now, now, input.rule.id, input.targetId, dedupKey)
      .run();
    return;
  }
  await cancelOtherGenerations(db, input.rule.id, input.targetId, dedupKey, now);
  if (!existing) {
    const id = newId();
    const dueIso = due.toISOString();
    const provisional: ReminderInstance = {
      id,
      ruleId: input.rule.id,
      targetType: input.targetType,
      targetId: input.targetId,
      caseId: input.caseId,
      conditionKey: input.rule.condition,
      generation: input.generation,
      dueAt: dueIso,
      status: "PENDING",
      snoozedUntil: null,
      resolvedAt: null,
      dedupKey,
    };
    const initial = evaluateDue({ instance: provisional, conditionHolds: true, clock: input.clock });
    await db
      .prepare(
        `INSERT INTO reminder_instances (
          id, rule_id, case_id, target_type, target_id, condition_key, generation, due_at, status,
          snoozed_until, resolved_at, last_evaluated_at, dedup_key, owner_user_id, reason, next_action, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.rule.id,
        input.caseId,
        input.targetType,
        input.targetId,
        input.rule.condition,
        input.generation,
        dueIso,
        initial.status,
        now,
        dedupKey,
        input.owner,
        input.reason,
        input.nextAction,
        now,
        now,
      )
      .run();
    return;
  }
  const evaluated = evaluateDue({
    instance: {
      ...existing,
      dueAt: existing.due_at,
      snoozedUntil: existing.snoozed_until,
      resolvedAt: existing.resolved_at,
    },
    conditionHolds: true,
    clock: input.clock,
  });
  await db
    .prepare("UPDATE reminder_instances SET due_at = ?, status = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?")
    .bind(due.toISOString(), evaluated.status, now, now, existing.id)
    .run();
}

async function cancelOtherGenerations(db: D1Database, ruleId: string, targetId: string, dedupKey: string, now: string) {
  await db
    .prepare(
      `UPDATE reminder_instances SET status = 'CANCELLED', last_evaluated_at = ?, updated_at = ?
       WHERE rule_id = ? AND target_id = ? AND dedup_key != ? AND status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED')`,
    )
    .bind(now, now, ruleId, targetId, dedupKey)
    .run();
}

type DesiredReminder = {
  caseId: string;
  targetType: string;
  targetId: string;
  generation: number;
  sourceDate: string;
  owner: string | null;
  conditionHolds: boolean;
  reason: string;
  nextAction: string;
};

async function syncRuleInstances(db: D1Database, env: Env, rule: ReminderRule, desired: DesiredReminder[]) {
  const statements: D1PreparedStatement[] = [];
  if (!rule.enabled) return statements;
  const timeZone = env.COMPANY_TIMEZONE || "Africa/Cairo";
  const clock = systemClock;
  const now = nowIso(clock.now());
  const existing = await all<{
    id: string;
    dedup_key: string;
    target_id: string;
    status: ReminderInstance["status"];
    due_at: string;
    snoozed_until: string | null;
    resolved_at: string | null;
  }>(db, "SELECT id, dedup_key, target_id, status, due_at, snoozed_until, resolved_at FROM reminder_instances WHERE rule_id = ?", rule.id);
  const byKey = new Map(existing.map((row) => [row.dedup_key, row]));
  const openKeysByTarget = new Map<string, Set<string>>();
  for (const row of existing) {
    if (row.status === "RESOLVED" || row.status === "CANCELLED") continue;
    const keys = openKeysByTarget.get(row.target_id) ?? new Set<string>();
    keys.add(row.dedup_key);
    openKeysByTarget.set(row.target_id, keys);
  }
  for (const item of desired) {
    const generation = item.generation || 1;
    const dedupKey = buildDedupKey({ ruleId: rule.id, sourceEntityId: item.targetId, conditionGeneration: generation });
    const current = byKey.get(dedupKey);
    const dueIso = computeDueAt({ rule, sourceDateOnly: item.sourceDate.slice(0, 10), timeZone }).toISOString();
    const openKeys = openKeysByTarget.get(item.targetId);
    if (openKeys && [...openKeys].some((key) => key !== dedupKey)) {
      statements.push(
        db.prepare(
          `UPDATE reminder_instances SET status = 'CANCELLED', last_evaluated_at = ?, updated_at = ?
           WHERE rule_id = ? AND target_id = ? AND dedup_key != ? AND status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED')`,
        ).bind(now, now, rule.id, item.targetId, dedupKey),
      );
    }
    if (!item.conditionHolds) {
      if (current && current.status !== "RESOLVED" && current.status !== "CANCELLED") {
        statements.push(
          db.prepare(
            "UPDATE reminder_instances SET status = 'RESOLVED', resolved_at = ?, snoozed_until = NULL, last_evaluated_at = ?, updated_at = ? WHERE id = ?",
          ).bind(now, now, now, current.id),
        );
      }
    } else if (!current) {
      const id = newId();
      const initial = evaluateDue({
        instance: {
          id,
          ruleId: rule.id,
          targetType: item.targetType,
          targetId: item.targetId,
          caseId: item.caseId,
          conditionKey: rule.condition,
          generation,
          dueAt: dueIso,
          status: "PENDING",
          snoozedUntil: null,
          resolvedAt: null,
          dedupKey,
        },
        conditionHolds: true,
        clock,
      });
      statements.push(
        db.prepare(
          `INSERT INTO reminder_instances (
            id, rule_id, case_id, target_type, target_id, condition_key, generation, due_at, status,
            snoozed_until, resolved_at, last_evaluated_at, dedup_key, owner_user_id, reason, next_action, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id, rule.id, item.caseId, item.targetType, item.targetId, rule.condition, generation, dueIso,
          initial.status, now, dedupKey, item.owner, item.reason, item.nextAction, now, now,
        ),
      );
    } else {
      const evaluated = evaluateDue({
        instance: {
          id: current.id,
          ruleId: rule.id,
          targetType: item.targetType,
          targetId: item.targetId,
          caseId: item.caseId,
          conditionKey: rule.condition,
          generation,
          dueAt: dueIso,
          status: current.status,
          snoozedUntil: current.snoozed_until,
          resolvedAt: current.resolved_at,
          dedupKey,
        },
        conditionHolds: true,
        clock,
      });
      statements.push(
        db.prepare("UPDATE reminder_instances SET due_at = ?, status = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?").bind(
          dueIso, evaluated.status, now, now, current.id,
        ),
      );
    }
  }
  if (desired.length > 0) {
    statements.push(
      db.prepare(
        `UPDATE export_cases SET next_action = COALESCE((
           SELECT next_action FROM reminder_instances
           WHERE case_id = export_cases.id AND status IN ('ACTIVE','PENDING','SNOOZED','ACKNOWLEDGED')
           ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'SNOOZED' THEN 2 ELSE 3 END, due_at
           LIMIT 1
         ), 'No open reminder')
         WHERE id IN (SELECT DISTINCT case_id FROM reminder_instances WHERE rule_id = ?)`,
      ).bind(rule.id),
    );
  }
  return statements;
}

async function loadDocumentNotReady(db: D1Database): Promise<DesiredReminder[]> {
  const rows = await all<{ id: string; case_id: string; status: string; due_date: string | null; created_at: string; name_en: string; assigned_to: string | null }>(
    db,
    `SELECT r.id, r.case_id, r.status, r.due_date, r.created_at, t.name_en, c.assigned_to
     FROM operation_document_requirements r
     JOIN document_type_definitions t ON t.id = r.document_type_id
     JOIN export_cases c ON c.id = r.case_id
     WHERE r.required = 1`,
  );
  return rows.map((req) => ({
    caseId: req.case_id,
    targetType: "document_requirement",
    targetId: req.id,
    generation: 1,
    sourceDate: (req.due_date ?? req.created_at).slice(0, 10),
    owner: req.assigned_to,
    conditionHolds: req.status === "MISSING",
    reason: `Required document is not yet uploaded: ${req.name_en}`,
    nextAction: "Upload a scanned PDF of the original",
  }));
}

async function loadDocumentReview(db: D1Database): Promise<DesiredReminder[]> {
  const rows = await all<{ id: string; case_id: string; status: string; created_at: string; name_en: string; assigned_to: string | null; latest_at: string | null }>(
    db,
    `SELECT r.id, r.case_id, r.status, r.created_at, t.name_en, c.assigned_to,
       (SELECT v.created_at FROM document_versions v WHERE v.requirement_id = r.id ORDER BY v.version DESC LIMIT 1) AS latest_at
     FROM operation_document_requirements r
     JOIN document_type_definitions t ON t.id = r.document_type_id
     JOIN export_cases c ON c.id = r.case_id`,
  );
  return rows.map((req) => ({
    caseId: req.case_id,
    targetType: "document_requirement",
    targetId: req.id,
    generation: 1,
    sourceDate: (req.latest_at ?? req.created_at).slice(0, 10),
    owner: req.assigned_to,
    conditionHolds: req.status === "UPLOADED" || req.status === "UNDER_REVIEW",
    reason: `Uploaded document is waiting for review: ${req.name_en}`,
    nextAction: "Review and approve or request correction",
  }));
}

async function loadBankReview(db: D1Database): Promise<DesiredReminder[]> {
  const rows = await all<{ case_id: string; created_at: string; assigned_to: string | null; bank_path_status: string; handover_at: string | null }>(
    db,
    `SELECT c.id AS case_id, c.created_at, c.assigned_to, c.bank_path_status,
       (SELECT e.created_at FROM bank_events e
        JOIN bank_submissions s ON s.id = e.submission_id
        WHERE s.case_id = c.id AND e.event_type = 'HANDED_TO_BANK'
        ORDER BY e.created_at DESC LIMIT 1) AS handover_at
     FROM export_cases c`,
  );
  return rows.map((row) => ({
    caseId: row.case_id,
    targetType: "export_case",
    targetId: row.case_id,
    generation: 1,
    sourceDate: (row.handover_at ?? row.created_at).slice(0, 10),
    owner: row.assigned_to,
    conditionHolds: row.bank_path_status === "BANK_REVIEW" || row.bank_path_status === "HANDED_TO_BANK",
    reason: "Bank still has originals under review",
    nextAction: "Record the bank decision",
  }));
}

async function loadCourier(db: D1Database): Promise<DesiredReminder[]> {
  const rows = await all<{ id: string; case_id: string; status: string; sent_at: string | null; assigned_to: string | null }>(
    db,
    `SELECT s.id, s.case_id, s.status, s.sent_at, c.assigned_to
     FROM courier_shipments s JOIN export_cases c ON c.id = s.case_id`,
  );
  const today = nowIso().slice(0, 10);
  return rows.map((row) => ({
    caseId: row.case_id,
    targetType: "courier",
    targetId: row.id,
    generation: 1,
    sourceDate: (row.sent_at ?? today).slice(0, 10),
    owner: row.assigned_to,
    conditionHolds: row.status === "DISPATCHED" || row.status === "IN_TRANSIT",
    reason: "Courier shipment needs a manual status check",
    nextAction: "Enter the latest carrier-reported status",
  }));
}

async function loadBookingFamily(db: D1Database, family: ReminderRule["family"], condition: ReminderRule["condition"]): Promise<DesiredReminder[]> {
  const bookings = await all<{
    id: string;
    case_id: string;
    planned_loading_date: string | null;
    cutoff_date: string | null;
    planned_etd: string | null;
    actual_etd: string | null;
    planned_eta: string | null;
    actual_eta: string | null;
    assigned_to: string | null;
    bank_path_status: string;
  }>(
    db,
    `SELECT b.id, b.case_id, b.planned_loading_date, b.cutoff_date, b.planned_etd, b.actual_etd, b.planned_eta, b.actual_eta,
            c.assigned_to, c.bank_path_status
     FROM bookings b JOIN export_cases c ON c.id = b.case_id
     WHERE b.status != 'CANCELLED'`,
  );
  const containers = await all<{ case_id: string; status: string }>(db, "SELECT case_id, status FROM containers WHERE status != 'CANCELLED'");
  const couriers = await all<{ case_id: string; status: string }>(db, "SELECT case_id, status FROM courier_shipments");
  const goods = new Map<string, { n: number; delivered: number }>();
  for (const row of containers) {
    const current = goods.get(row.case_id) ?? { n: 0, delivered: 0 };
    current.n += 1;
    if (row.status === "DELIVERED_TO_CUSTOMER") current.delivered += 1;
    goods.set(row.case_id, current);
  }
  const deliveredCouriers = new Set(couriers.filter((row) => row.status === "DELIVERED").map((row) => row.case_id));
  const desired: DesiredReminder[] = [];
  for (const booking of bookings) {
    const sourceByFamily: Record<string, string | null> = {
      BOOKING_LOADING_APPROACHING: booking.planned_loading_date,
      BOOKING_CUTOFF_APPROACHING: booking.cutoff_date,
      BOOKING_ETD_FOLLOWUP: booking.actual_etd ?? booking.planned_etd,
      VESSEL_ETA_APPROACHING: booking.planned_eta,
      ARRIVAL_OVERDUE: booking.planned_eta,
      GOODS_DELIVERY_PENDING: booking.actual_eta,
    };
    const source = sourceByFamily[family];
    if (!source) continue;
    const progress = goods.get(booking.case_id);
    desired.push({
      caseId: booking.case_id,
      targetType: "booking",
      targetId: booking.id,
      generation: hashGeneration(source),
      sourceDate: source.slice(0, 10),
      owner: booking.assigned_to,
      conditionHolds: conditionStillHolds({
        condition,
        documentReady: true,
        reviewPending: false,
        bankReviewPending: booking.bank_path_status === "BANK_REVIEW" || booking.bank_path_status === "HANDED_TO_BANK",
        courierDelivered: deliveredCouriers.has(booking.case_id),
        actualDepartureAt: booking.actual_etd,
        actualArrivalAt: booking.actual_eta,
        goodsDelivered: Boolean(progress && progress.n > 0 && progress.delivered === progress.n),
      }),
      reason: family.replaceAll("_", " ").toLowerCase(),
      nextAction: "Review booking dates and container progress",
    });
  }
  return desired;
}

async function loadContainers(db: D1Database): Promise<DesiredReminder[]> {
  const rows = await all<{ id: string; case_id: string; updated_at: string; assigned_to: string | null }>(
    db,
    `SELECT k.id, k.case_id, k.updated_at, c.assigned_to
     FROM containers k JOIN export_cases c ON c.id = k.case_id
     WHERE k.status IN ('LOADED','DEPARTED')`,
  );
  return rows.map((row) => ({
    caseId: row.case_id,
    targetType: "container",
    targetId: row.id,
    generation: 1,
    sourceDate: row.updated_at.slice(0, 10),
    owner: row.assigned_to,
    conditionHolds: true,
    reason: "Container milestone follow-up",
    nextAction: "Update the actual container event",
  }));
}

async function loadDesiredForRule(db: D1Database, rule: ReminderRule): Promise<DesiredReminder[] | null> {
  switch (rule.family) {
    case "DOCUMENT_REQUIREMENT_NOT_READY":
      return loadDocumentNotReady(db);
    case "DOCUMENT_REVIEW_PENDING":
      return loadDocumentReview(db);
    case "BANK_REVIEW_OVERDUE":
      return loadBankReview(db);
    case "COURIER_STATUS_CHECK":
      return loadCourier(db);
    case "BOOKING_LOADING_APPROACHING":
    case "BOOKING_CUTOFF_APPROACHING":
    case "BOOKING_ETD_FOLLOWUP":
    case "VESSEL_ETA_APPROACHING":
    case "ARRIVAL_OVERDUE":
    case "GOODS_DELIVERY_PENDING":
      return loadBookingFamily(db, rule.family, rule.condition);
    case "CONTAINER_STATUS_FOLLOWUP":
      return loadContainers(db);
    default:
      return null;
  }
}

function hashGeneration(source: string): number {
  let n = 0;
  for (let i = 0; i < source.length; i += 1) n = (n * 31 + source.charCodeAt(i)) >>> 0;
  return n || 1;
}

const DUE_CYCLE_SQL = `
  SELECT i.id, i.case_id, i.rule_id, i.status, i.snoozed_until,
         d.repeat_every_days, d.repeat_cap,
         COALESCE(h.n, 0) AS delivered_count, h.last_at
  FROM reminder_instances i
  JOIN reminder_rule_definitions d ON d.id = i.rule_id
  LEFT JOIN (
    SELECT reminder_id, COUNT(*) AS n, MAX(created_at) AS last_at
    FROM notification_deliveries
    GROUP BY reminder_id
  ) h ON h.reminder_id = i.id
  WHERE i.status IN ('PENDING','ACTIVE','SNOOZED')
    AND i.due_at <= ?
    AND (i.snoozed_until IS NULL OR i.snoozed_until <= ?)
    AND (
      ((d.repeat_every_days IS NULL OR d.repeat_every_days <= 0) AND COALESCE(h.n, 0) = 0)
      OR (
        d.repeat_every_days > 0
        AND (d.repeat_cap IS NULL OR COALESCE(h.n, 0) < d.repeat_cap)
        AND (h.last_at IS NULL OR (julianday(?) - julianday(h.last_at)) >= d.repeat_every_days)
      )
    )
  ORDER BY i.due_at, i.id
  LIMIT 100`;

type DueCycleRow = {
  id: string;
  case_id: string;
  rule_id: string;
  status: string;
  snoozed_until: string | null;
  repeat_every_days: number | null;
  repeat_cap: number | null;
  delivered_count: number;
  last_at: string | null;
};

export async function processDueReminders(db: D1Database, env: Env, clock: Clock = systemClock) {
  const started = Date.now();
  const now = clock.now().toISOString();
  const due = await all<DueCycleRow>(db, DUE_CYCLE_SQL, now, now, now);
  const seen = new Set<string>();
  for (const row of due) {
    const key = `${row.case_id}\t${row.rule_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await recomputeRemindersForCase(db, env, row.case_id, clock, row.rule_id);
  }
  const deliverable = await all<DueCycleRow>(
    db,
    DUE_CYCLE_SQL.replace("i.status IN ('PENDING','ACTIVE','SNOOZED')", "i.status = 'ACTIVE'"),
    now,
    now,
    now,
  );
  const statements: D1PreparedStatement[] = [];
  for (const row of deliverable) {
    const cycleKey = notificationCycleKey({
      repeatEveryDays: row.repeat_every_days,
      repeatCap: row.repeat_cap,
      deliveredCount: row.delivered_count,
      lastDeliveredAt: row.last_at,
      now: clock.now(),
    });
    if (!cycleKey) continue;
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO notification_deliveries (id, reminder_id, cycle_key, channel, created_at)
         VALUES (?, ?, ?, 'IN_APP', ?)`,
      ).bind(newId(), row.id, cycleKey, now),
    );
  }
  let delivered = 0;
  if (statements.length > 0) {
    const results = await db.batch(statements);
    delivered = results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  }
  if (env.EXPORTFLOW_TRACE === "1") {
    console.log(`[exportflow-handler] reminder-cron scanned=${due.length} recomputed=${seen.size} delivered=${delivered} ms=${Date.now() - started}`);
  }
  return { scanned: due.length, delivered };
}

export async function snoozeReminder(
  db: D1Database,
  actor: Actor,
  id: string,
  until: string,
) {
  requirePermission(actor, "reminders.manage_own");
  const row = await one<{ id: string; case_id: string; status: string }>(
    db,
    "SELECT id, case_id, status FROM reminder_instances WHERE id = ?",
    id,
  );
  if (!row) throw errors.notFound("Reminder not found");
  await assertCaseAccess(db, actor, row.case_id);
  if (row.status === "RESOLVED" || row.status === "CANCELLED") {
    throw errors.conflict("Resolved reminders cannot be snoozed");
  }
  await db
    .prepare("UPDATE reminder_instances SET status = 'SNOOZED', snoozed_until = ?, updated_at = ? WHERE id = ?")
    .bind(until, nowIso(), id)
    .run();
}

export async function listReminders(db: D1Database, actor: Actor, filter: string) {
  requirePermission(actor, "reminders.view");
  const scope = actor.permissions.has("export_cases.view_all") ? "" : "AND (r.owner_user_id = ? OR c.assigned_to = ? OR c.created_by = ?)";
  const binds = actor.permissions.has("export_cases.view_all") ? [] : [actor.id, actor.id, actor.id];
  const statusFilter =
    filter === "overdue"
      ? "AND r.status = 'ACTIVE' AND r.due_at < datetime('now')"
      : filter === "snoozed"
        ? "AND r.status = 'SNOOZED'"
        : filter === "resolved"
          ? "AND r.status IN ('RESOLVED','CANCELLED')"
          : "AND r.status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED')";
  return all(
    db,
    `SELECT r.*, c.case_reference FROM reminder_instances r
     JOIN export_cases c ON c.id = r.case_id
     WHERE 1=1 ${statusFilter} ${scope}
     ORDER BY r.due_at ASC LIMIT 200`,
    ...binds,
  );
}

export async function listNotifications(db: D1Database, actor: Actor) {
  requirePermission(actor, "reminders.view");
  const vis = caseVisibilitySql(actor, "c");
  return all(
    db,
    `SELECT d.id, d.created_at, d.reminder_id, r.reason, r.next_action, r.case_id, c.case_reference,
            CASE WHEN nr.read_at IS NULL THEN 0 ELSE 1 END AS is_read
     FROM notification_deliveries d
     JOIN reminder_instances r ON r.id = d.reminder_id
     JOIN export_cases c ON c.id = r.case_id
     LEFT JOIN notification_reads nr ON nr.delivery_id = d.id AND nr.user_id = ?
     WHERE r.status NOT IN ('RESOLVED', 'CANCELLED') AND ${vis.sql}
     ORDER BY d.created_at DESC LIMIT 100`,
    actor.id,
    ...vis.binds,
  );
}

export async function markNotificationRead(db: D1Database, actor: Actor, deliveryId: string) {
  requirePermission(actor, "reminders.view");
  const row = await one<{ case_id: string }>(
    db,
    `SELECT r.case_id AS case_id
     FROM notification_deliveries d
     JOIN reminder_instances r ON r.id = d.reminder_id
     WHERE d.id = ?`,
    deliveryId,
  );
  if (!row) throw errors.notFound("Notification not found");
  await assertCaseAccess(db, actor, row.case_id);
  await db
    .prepare("INSERT OR IGNORE INTO notification_reads (user_id, delivery_id, read_at) VALUES (?, ?, ?)")
    .bind(actor.id, deliveryId, nowIso())
    .run();
}

export async function listRules(db: D1Database) {
  return all(db, "SELECT * FROM reminder_rule_definitions ORDER BY family");
}

type StoredRule = RuleRow & { repeat_every_days: number | null; repeat_cap: number | null };

type RuleExpectation = {
  enabled: boolean;
  offsetAmount: number;
  offsetDirection: "BEFORE" | "AFTER";
  offsetUnit: "HOURS" | "DAYS";
  repeatEveryDays: number | null;
  repeatCap: number | null;
};

function expectationMatches(row: StoredRule, expected: RuleExpectation) {
  return Boolean(row.enabled) === expected.enabled
    && row.offset_amount === expected.offsetAmount
    && row.offset_direction === expected.offsetDirection
    && row.offset_unit === expected.offsetUnit
    && (row.repeat_every_days ?? null) === expected.repeatEveryDays
    && (row.repeat_cap ?? null) === expected.repeatCap;
}

function ruleSnapshotGuard(db: D1Database, row: StoredRule) {
  return db.prepare(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM reminder_rule_definitions
       WHERE id = ?
         AND enabled = ?
         AND offset_amount = ?
         AND offset_direction = ?
         AND offset_unit = ?
         AND ((? IS NULL AND repeat_every_days IS NULL) OR repeat_every_days = ?)
         AND ((? IS NULL AND repeat_cap IS NULL) OR repeat_cap = ?)
     ) THEN 1 ELSE (1/0) END`,
  ).bind(
    row.id,
    row.enabled,
    row.offset_amount,
    row.offset_direction,
    row.offset_unit,
    row.repeat_every_days,
    row.repeat_every_days,
    row.repeat_cap,
    row.repeat_cap,
  );
}

async function waitForReminderGate(db: D1Database, fault: string | undefined) {
  if (fault !== "reminder-hold") return;
  await db.prepare("CREATE TABLE IF NOT EXISTS _cf0654_gate (id INTEGER PRIMARY KEY, open INTEGER NOT NULL)").run();
  await db.prepare("INSERT OR IGNORE INTO _cf0654_gate (id, open) VALUES (1, 0)").run();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const gate = await one<{ open: number }>(db, "SELECT open FROM _cf0654_gate WHERE id = 1");
    if (gate?.open === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw errors.conflict("The reminder test gate was not released.", "REMINDER_TEST_FAULT");
}

function asExpectation(value: unknown): RuleExpectation {
  if (!value || typeof value !== "object") {
    throw errors.conflict(
      "Reload this reminder rule before saving. The screen did not send the values it was showing.",
      "REMINDER_STALE",
    );
  }
  const raw = value as Record<string, unknown>;
  const direction = raw.offsetDirection;
  const unit = raw.offsetUnit;
  if (typeof raw.enabled !== "boolean" || typeof raw.offsetAmount !== "number" || !Number.isFinite(raw.offsetAmount)) {
    throw errors.conflict("Reload this reminder rule before saving. The shown values were incomplete.", "REMINDER_STALE");
  }
  if (direction !== "BEFORE" && direction !== "AFTER") {
    throw errors.conflict("Reload this reminder rule before saving. The shown direction was incomplete.", "REMINDER_STALE");
  }
  if (unit !== "HOURS" && unit !== "DAYS") {
    throw errors.conflict("Reload this reminder rule before saving. The shown unit was incomplete.", "REMINDER_STALE");
  }
  const repeatEveryDays = raw.repeatEveryDays == null ? null : raw.repeatEveryDays;
  const repeatCap = raw.repeatCap == null ? null : raw.repeatCap;
  if (repeatEveryDays != null && typeof repeatEveryDays !== "number") {
    throw errors.conflict("Reload this reminder rule before saving. The shown repeat interval was incomplete.", "REMINDER_STALE");
  }
  if (repeatCap != null && typeof repeatCap !== "number") {
    throw errors.conflict("Reload this reminder rule before saving. The shown repeat cap was incomplete.", "REMINDER_STALE");
  }
  return {
    enabled: raw.enabled,
    offsetAmount: raw.offsetAmount,
    offsetDirection: direction,
    offsetUnit: unit,
    repeatEveryDays,
    repeatCap,
  };
}

async function commitRuleBatch(db: D1Database, fault: string | undefined, statements: D1PreparedStatement[]) {
  try {
    await db.batch(statements);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/division by zero/i.test(text)) {
      throw errors.conflict(
        "Another save changed this reminder rule. Reload it and review the current values before trying again.",
        "REMINDER_STALE",
      );
    }
    throw error;
  }
  if (fault === "reminder-after-commit") {
    throw errors.coded(
      503,
      "REMINDER_SAVE_UNCONFIRMED",
      "The save may have finished, but the confirmation was lost. Check the latest values before trying again.",
    );
  }
}

export async function updateRule(
  db: D1Database,
  actor: Actor,
  env: Env,
  id: string,
  input: {
    enabled?: boolean;
    offsetAmount?: number;
    offsetDirection?: "BEFORE" | "AFTER";
    offsetUnit?: "HOURS" | "DAYS";
    repeatEveryDays?: number | null;
    repeatCap?: number | null;
    expected?: unknown;
  },
  requestedFault?: string | null,
) {
  const fault = (env.EXPORTFLOW_FIXTURE === "cp0654" || env.EXPORTFLOW_FIXTURE === "cp0654b") && requestedFault
    ? requestedFault
    : env.EXPORTFLOW_TEST_FAULTS;
  requirePermission(actor, "reminders.manage_rules");
  if (input.offsetAmount !== undefined && (!Number.isFinite(input.offsetAmount) || input.offsetAmount < -365 || input.offsetAmount > 365)) {
    throw errors.validation("Enter an offset between -365 and 365.", { offsetAmount: "REMINDER_OFFSET" }, "REMINDER_OFFSET");
  }
  if (input.offsetDirection && input.offsetDirection !== "BEFORE" && input.offsetDirection !== "AFTER") {
    throw errors.validation("Choose before or after the event.", { offsetDirection: "REMINDER_DIRECTION" }, "REMINDER_DIRECTION");
  }
  if (input.offsetUnit && input.offsetUnit !== "HOURS" && input.offsetUnit !== "DAYS") {
    throw errors.validation("Choose hours or days.", { offsetUnit: "REMINDER_UNIT" }, "REMINDER_UNIT");
  }
  if (input.repeatEveryDays != null && (!Number.isInteger(input.repeatEveryDays) || input.repeatEveryDays < 1 || input.repeatEveryDays > 90)) {
    throw errors.validation("Repeat interval must be 1 to 90 days, or empty for once.", { repeatEveryDays: "REMINDER_REPEAT" }, "REMINDER_REPEAT");
  }
  if (input.repeatCap != null && (!Number.isInteger(input.repeatCap) || input.repeatCap < 1 || input.repeatCap > 50)) {
    throw errors.validation("Repeat cap must be 1 to 50.", { repeatCap: "REMINDER_CAP" }, "REMINDER_CAP");
  }
  const expected = asExpectation(input.expected);
  const ruleRow = await one<StoredRule>(db, "SELECT * FROM reminder_rule_definitions WHERE id = ?", id);
  if (!ruleRow) throw errors.notFound("Rule not found");
  if (!expectationMatches(ruleRow, expected)) {
    throw errors.conflict(
      "Another save changed this reminder rule. Reload it and review the current values before trying again.",
      "REMINDER_STALE",
    );
  }
  await waitForReminderGate(db, fault);
  const merged: RuleRow = {
    ...ruleRow,
    enabled: input.enabled === undefined ? ruleRow.enabled : input.enabled ? 1 : 0,
    offset_amount: input.offsetAmount ?? ruleRow.offset_amount,
    offset_direction: input.offsetDirection ?? ruleRow.offset_direction,
    offset_unit: input.offsetUnit ?? ruleRow.offset_unit,
  };
  const rule = toRule(merged);
  const definition = db.prepare(
    `UPDATE reminder_rule_definitions SET
      enabled = COALESCE(?, enabled),
      offset_amount = COALESCE(?, offset_amount),
      offset_direction = COALESCE(?, offset_direction),
      offset_unit = COALESCE(?, offset_unit),
      repeat_every_days = CASE WHEN ? = 1 THEN ? ELSE repeat_every_days END,
      repeat_cap = CASE WHEN ? = 1 THEN ? ELSE repeat_cap END
     WHERE id = ?`,
  ).bind(
    input.enabled === undefined ? null : input.enabled ? 1 : 0,
    input.offsetAmount ?? null,
    input.offsetDirection ?? null,
    input.offsetUnit ?? null,
    input.repeatEveryDays === undefined ? 0 : 1,
    input.repeatEveryDays ?? null,
    input.repeatCap === undefined ? 0 : 1,
    input.repeatCap ?? null,
    id,
  );
  if (fault === "reminder-before-batch") {
    throw errors.conflict("The reminder change was not saved.", "REMINDER_TEST_FAULT");
  }
  const recomputeStarted = Date.now();
  const desired = await loadDesiredForRule(db, rule);
  if (desired) {
    const statements = [ruleSnapshotGuard(db, ruleRow), definition, ...(await syncRuleInstances(db, env, rule, desired))];
    if (fault === "reminder-batch-poison") {
      statements.push(db.prepare("INSERT INTO _cf0653_missing_table (id) VALUES (1)"));
    }
    if (statements.length > 2000) {
      throw errors.conflict(
        "This reminder rule touches too many rows to update in one safe step. No change was saved.",
        "REMINDER_RECOMPUTE_TOO_LARGE",
      );
    }
    await commitRuleBatch(db, fault, statements);
    if (env.EXPORTFLOW_TRACE === "1") {
      console.log(`[exportflow-handler] reminder-recompute end mode=single-batch family=${rule.family} statements=${statements.length} rows=${desired.length} ms=${Date.now() - recomputeStarted}`);
    }
    return;
  }
  await commitRuleBatch(db, fault, [ruleSnapshotGuard(db, ruleRow), definition]);
  const cases = await all<{ case_id: string }>(db, "SELECT DISTINCT case_id FROM reminder_instances WHERE rule_id = ?", id);
  if (env.EXPORTFLOW_TRACE === "1") console.log(`[exportflow-handler] reminder-recompute begin cases=${cases.length}`);
  for (const row of cases) {
    await recomputeRemindersForCase(db, env, row.case_id, systemClock, id);
  }
  if (env.EXPORTFLOW_TRACE === "1") console.log(`[exportflow-handler] reminder-recompute end cases=${cases.length} ms=${Date.now() - recomputeStarted}`);
}
