import type { ReminderStatus, ReminderTriggerFamily } from "../../shared/enums";
import { addOffset, dateOnlyInZone, type Clock } from "./dates";

export type ReminderCondition =
  | "DOCUMENT_NOT_READY"
  | "DOCUMENT_REVIEW_PENDING"
  | "BANK_REVIEW_PENDING"
  | "COURIER_IN_TRANSIT"
  | "LOADING_APPROACHING"
  | "CUTOFF_APPROACHING"
  | "ETD_FOLLOWUP"
  | "CONTAINER_FOLLOWUP"
  | "ETA_APPROACHING"
  | "ARRIVAL_OVERDUE"
  | "GOODS_DELIVERY_PENDING"
  | "CUSTOM";

export type ReminderRule = {
  id: string;
  family: ReminderTriggerFamily;
  enabled: boolean;
  offsetAmount: number;
  offsetDirection: "BEFORE" | "AFTER";
  offsetUnit: "HOURS" | "DAYS";
  dayPolicy: "CALENDAR" | "BUSINESS";
  condition: ReminderCondition;
  mandatory: boolean;
};

export type ReminderInstance = {
  id: string;
  ruleId: string;
  targetType: string;
  targetId: string;
  caseId: string;
  conditionKey: ReminderCondition;
  generation: number;
  dueAt: string;
  status: ReminderStatus;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  dedupKey: string;
};

export function buildDedupKey(input: {
  ruleId: string;
  sourceEntityId: string;
  conditionGeneration: number;
}): string {
  return `${input.ruleId}:${input.sourceEntityId}:${input.conditionGeneration}`;
}

export function conditionStillHolds(input: {
  condition: ReminderCondition;
  documentReady: boolean;
  reviewPending: boolean;
  bankReviewPending: boolean;
  courierDelivered: boolean;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  goodsDelivered: boolean;
}): boolean {
  switch (input.condition) {
    case "DOCUMENT_NOT_READY":
      return !input.documentReady;
    case "DOCUMENT_REVIEW_PENDING":
      return input.reviewPending;
    case "BANK_REVIEW_PENDING":
      return input.bankReviewPending;
    case "COURIER_IN_TRANSIT":
      return !input.courierDelivered;
    case "ETD_FOLLOWUP":
      return input.actualDepartureAt !== null && input.actualArrivalAt === null;
    case "ARRIVAL_OVERDUE":
      return input.actualArrivalAt === null;
    case "GOODS_DELIVERY_PENDING":
      return input.actualArrivalAt !== null && !input.goodsDelivered;
    case "LOADING_APPROACHING":
    case "CUTOFF_APPROACHING":
    case "ETA_APPROACHING":
    case "CONTAINER_FOLLOWUP":
    case "CUSTOM":
      return true;
    default:
      return true;
  }
}

export function evaluateDue(input: {
  instance: ReminderInstance;
  conditionHolds: boolean;
  clock: Clock;
}): { status: ReminderStatus; autoResolved: boolean; shouldNotify: boolean } {
  const now = input.clock.now();
  if (!input.conditionHolds) {
    return { status: "RESOLVED", autoResolved: true, shouldNotify: false };
  }
  if (input.instance.status === "RESOLVED" || input.instance.status === "CANCELLED") {
    return { status: input.instance.status, autoResolved: false, shouldNotify: false };
  }
  if (input.instance.snoozedUntil && new Date(input.instance.snoozedUntil) > now) {
    return { status: "SNOOZED", autoResolved: false, shouldNotify: false };
  }
  if (new Date(input.instance.dueAt) <= now) {
    return {
      status: "ACTIVE",
      autoResolved: false,
      shouldNotify: input.instance.status !== "ACKNOWLEDGED",
    };
  }
  return { status: "PENDING", autoResolved: false, shouldNotify: false };
}

export function computeDueAt(input: {
  rule: ReminderRule;
  sourceDateOnly: string;
  timeZone: string;
}): Date {
  return addOffset({
    dateOnly: input.sourceDateOnly,
    direction: input.rule.offsetDirection,
    amount: input.rule.offsetAmount,
    unit: input.rule.offsetUnit,
    policy: input.rule.dayPolicy,
    timeZone: input.timeZone,
  });
}

/** One in-app notice per instance when repeat_every_days is unset. A positive interval uses that many days, not the cron hour. */
export function notificationCycleKey(input: {
  repeatEveryDays: number | null;
  repeatCap: number | null;
  deliveredCount: number;
  lastDeliveredAt: string | null;
  now: Date;
}): string | null {
  const every = input.repeatEveryDays;
  if (every == null || every <= 0) {
    return input.deliveredCount === 0 ? "once" : null;
  }
  if (input.repeatCap != null && input.repeatCap >= 0 && input.deliveredCount >= input.repeatCap) return null;
  if (input.lastDeliveredAt) {
    const elapsed = input.now.getTime() - new Date(input.lastDeliveredAt).getTime();
    if (Number.isNaN(elapsed) || elapsed < every * 24 * 60 * 60 * 1000) return null;
  }
  const bucket = Math.floor(input.now.getTime() / (every * 24 * 60 * 60 * 1000));
  return `every-${every}d:${bucket}`;
}

export function sourceDateOnlyFromInstant(iso: string, timeZone: string): string {
  return dateOnlyInZone(iso, timeZone);
}

export const DOCUMENT_READY_STATUSES = new Set(["APPROVED", "WAIVED"]);
