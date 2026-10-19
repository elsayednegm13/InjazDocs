export const CASE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const DOCUMENT_REQUIREMENT_STATUSES = [
  "MISSING",
  "UPLOADED",
  "UNDER_REVIEW",
  "APPROVED",
  "NEEDS_CORRECTION",
  "WAIVED",
] as const;
export type DocumentRequirementStatus = (typeof DOCUMENT_REQUIREMENT_STATUSES)[number];

export const DOCUMENT_ROUTES = ["BANK_ROUTE", "DIRECT_ROUTE"] as const;
export type DocumentRoute = (typeof DOCUMENT_ROUTES)[number];

export const BANK_PATH_STATUSES = [
  "NOT_REQUIRED",
  "PREPARING",
  "SCANNED",
  "READY_FOR_PHYSICAL_HANDOVER",
  "HANDED_TO_BANK",
  "BANK_REVIEW",
  "CORRECTION_REQUESTED",
  "BANK_APPROVED",
  "COURIER_DISPATCHED",
  "DOCUMENTS_DELIVERED",
] as const;
export type BankPathStatus = (typeof BANK_PATH_STATUSES)[number];

export const DIRECT_PATH_STATUSES = [
  "PREPARING",
  "SCANNED",
  "INTERNAL_REVIEW",
  "READY_FOR_DISPATCH",
  "COURIER_DISPATCHED",
  "DOCUMENTS_DELIVERED",
] as const;
export type DirectPathStatus = (typeof DIRECT_PATH_STATUSES)[number];

export const COURIER_STATUSES = [
  "NOT_DISPATCHED",
  "DISPATCHED",
  "IN_TRANSIT",
  "DELIVERY_EXCEPTION",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
] as const;
export type CourierStatus = (typeof COURIER_STATUSES)[number];

export const BOOKING_STATUSES = [
  "DRAFT",
  "REQUESTED",
  "CONFIRMED",
  "LOADING_IN_PROGRESS",
  "LOADED",
  "DEPARTED",
  "ARRIVED_PORT",
  "CLOSED",
  "CANCELLED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const CONTAINER_STATUSES = [
  "PLANNED",
  "NUMBER_ASSIGNED",
  "GATED_IN",
  "LOADED",
  "DEPARTED",
  "ARRIVED_PORT",
  "CUSTOMS_RELEASED",
  "DELIVERED_TO_CUSTOMER",
  "CANCELLED",
  "EXCEPTION",
] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

export const INCOTERMS = ["FOB", "CFR"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export const PAYMENT_TERM_CODES = ["TT", "LC", "DP", "DA", "OTHER"] as const;
export type PaymentTermCode = (typeof PAYMENT_TERM_CODES)[number];

export const REMINDER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SNOOZED",
  "ACKNOWLEDGED",
  "RESOLVED",
  "CANCELLED",
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_TRIGGER_FAMILIES = [
  "DOCUMENT_REQUIREMENT_NOT_READY",
  "DOCUMENT_REVIEW_PENDING",
  "BANK_REVIEW_OVERDUE",
  "COURIER_STATUS_CHECK",
  "BOOKING_LOADING_APPROACHING",
  "BOOKING_CUTOFF_APPROACHING",
  "BOOKING_ETD_FOLLOWUP",
  "CONTAINER_STATUS_FOLLOWUP",
  "VESSEL_ETA_APPROACHING",
  "ARRIVAL_OVERDUE",
  "GOODS_DELIVERY_PENDING",
  "CUSTOM_FOLLOWUP",
] as const;
export type ReminderTriggerFamily = (typeof REMINDER_TRIGGER_FAMILIES)[number];

export const DAY_POLICIES = ["CALENDAR", "BUSINESS"] as const;
export type DayPolicy = (typeof DAY_POLICIES)[number];

export const OFFSET_DIRECTIONS = ["BEFORE", "AFTER"] as const;
export type OffsetDirection = (typeof OFFSET_DIRECTIONS)[number];

export const TIME_UNITS = ["HOURS", "DAYS"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export const CUSTOM_FIELD_TYPES = [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MONEY",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TARGETS = [
  "CUSTOMER",
  "EXPORT_CASE",
  "INVOICE",
  "BOOKING",
  "CONTAINER",
] as const;
export type CustomFieldTarget = (typeof CUSTOM_FIELD_TARGETS)[number];

export const UPLOAD_SESSION_STATES = [
  "INIT",
  "UPLOADING",
  "FINALIZING",
  "COMPLETED",
  "ABORTED",
  "EXPIRED",
] as const;
export type UploadSessionState = (typeof UPLOAD_SESSION_STATES)[number];

export const TRACK_COMPLETION = {
  documents: "documents",
  goods: "goods",
} as const;
