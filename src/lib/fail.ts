import { ApiRequestError } from "@/lib/api";

const FALLBACK: Record<string, string> = {
  DOCUMENT_TYPE_REQUIRED: "Choose a document type before adding it.",
  DOCUMENT_ALREADY_EXISTS: "This document is already on the operation. Open it or upload a new version.",
  DOCUMENT_UPLOAD_INCOMPLETE: "The upload did not finish. Retry the remaining part or choose the file again.",
  INVALID_PDF: "The file could not be read. Choose a valid PDF and try again.",
  DOCUMENT_STILL_UNAPPROVED: "The operation cannot be completed until required documents are reviewed and approved.",
  DOCUMENTS_TRACK_INCOMPLETE: "The operation cannot be completed until required documents are reviewed and approved.",
  GOODS_TRACK_INCOMPLETE: "Port arrival is not customer delivery. Record actual container delivery first.",
  BANK_TRANSITION_NOT_ALLOWED: "This step is not available until the previous stage is finished.",
  INVALID_TRANSITION: "This step is not available until the previous stage is finished.",
  OPERATION_NOT_ACCESSIBLE: "You cannot view this operation, or it is not available.",
  USER_NOT_AUTHORIZED: "You do not have permission to do this. Ask an administrator if you need access.",
  SESSION_EXPIRED: "Your session has ended. Sign in again to continue.",
  UNAUTHENTICATED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "You do not have permission to do this. Ask an administrator if you need access.",
  BOOKING_CONTAINER_COUNT_INVALID: "Check the requested container count before saving the booking.",
  GROSS_LT_NET: "Gross weight cannot be less than net weight.",
  TOO_MANY_REQUESTS: "Too many attempts in a short time. Try again later.",
  RATE_LIMITED: "Too many attempts in a short time. Try again later.",
  SERVER_TEMPORARILY_UNAVAILABLE: "The request could not be completed. Check the latest saved data before trying again.",
  CUSTOMER_TRACKING_UNAVAILABLE: "This tracking link is unavailable or has expired. Ask the company for a new link.",
  GONE: "This tracking link is unavailable or has expired. Ask the company for a new link.",
  VALIDATION_ERROR: "Check the highlighted fields and try again.",
  NETWORK_UNAVAILABLE: "Could not reach the server. Your last change may not have been saved.",
  REMINDER_STALE: "Another save changed this reminder rule. Reload it and review the current values before trying again.",
  REMINDER_SAVE_UNCONFIRMED: "The save may have finished, but the confirmation was lost. Check the latest values before trying again.",
  REMINDER_RECOMPUTE_TOO_LARGE: "This reminder rule touches too many rows to update in one safe step. No change was saved.",
  LAST_ADMIN: "The last active administrator cannot be removed or disabled.",
  INVOICE_LOCKED: "This invoice is locked because the export operation is completed. An exceptional correction is required.",
  INVOICE_VERSION: "The invoice changed since you opened it. Refresh and review the correction again.",
  INVOICE_CORRECTION_REASON: "Write the correction reason before saving.",
  CUSTOM_FIELD_REQUIRED: "Fill in the required extra fields.",
  CUSTOM_FIELD_TYPE_INVALID: "Choose a supported field type.",
  CUSTOM_FIELD_OPTION_INVALID: "Choose one of the available options.",
  CUSTOM_FIELD_UNAVAILABLE: "This extra field is unavailable.",
  CUSTOM_FIELD_DUPLICATE: "This field key is already used for that record type.",
  CUSTOM_FIELD_TARGET_INVALID: "Choose a supported record type.",
  CUSTOM_FIELD_KEY_INVALID: "Use a lowercase key with letters, numbers, and underscores.",
};

export function errorCode(error: unknown): string {
  if (error instanceof ApiRequestError) return error.code;
  if (error instanceof TypeError) return "NETWORK_UNAVAILABLE";
  return "SERVER_TEMPORARILY_UNAVAILABLE";
}

export function fieldErrorsOf(error: unknown): Record<string, string> {
  return error instanceof ApiRequestError ? error.fieldErrors : {};
}

export function fallbackFor(code: string): string {
  return FALLBACK[code] ?? FALLBACK.SERVER_TEMPORARILY_UNAVAILABLE;
}
