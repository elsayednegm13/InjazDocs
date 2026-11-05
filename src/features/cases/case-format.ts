export function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = document.documentElement.lang.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// The document lane shows a handful of readable milestones, so every path status
// maps onto one of them. Without this a finished case (documents delivered) had
// no matching step and every bar stayed grey.
export const DOCUMENT_STEP_OF = {
  BANK_ROUTE: {
    PREPARING: "PREPARING",
    SCANNED: "AT_BANK",
    HANDED_TO_BANK: "AT_BANK",
    BANK_REVIEW: "AT_BANK",
    CORRECTION_REQUESTED: "AT_BANK",
    BANK_APPROVED: "APPROVED",
    COURIER_DISPATCHED: "DISPATCHED",
    DOCUMENTS_DELIVERED: "DELIVERED",
  } as Record<string, string>,
  DIRECT_ROUTE: {
    PREPARING: "PREPARING",
    SCANNED: "SCANNED",
    INTERNAL_REVIEW: "INTERNAL_REVIEW",
    READY_FOR_DISPATCH: "INTERNAL_REVIEW",
    COURIER_DISPATCHED: "DISPATCHED",
    DOCUMENTS_DELIVERED: "DELIVERED",
  } as Record<string, string>,
};
