import { useTranslation } from "react-i18next";
import { errorCode, fallbackFor } from "@/lib/fail";

const STORED_PREFIXES = [
  ["Required document is not yet uploaded", "reminder.docMissing"],
  ["Upload a scanned PDF of the original", "reminder.uploadScan"],
  ["Uploaded document is waiting for review", "reminder.reviewWaiting"],
  ["Review and approve or request correction", "reminder.reviewAction"],
  ["Bank still has originals under review", "reminder.bankReview"],
  ["Record the bank decision", "reminder.bankAction"],
  ["Courier shipment needs a manual status check", "reminder.courierCheck"],
  ["Enter the latest carrier-reported status", "reminder.courierAction"],
  ["Container milestone follow-up", "reminder.container"],
  ["Update the actual container event", "reminder.containerAction"],
  ["Review booking dates and container progress", "reminder.bookingAction"],
  ["No open reminder", "reminder.none"],
  ["Complete commercial details and document checklist", "reminder.checklist"],
  ["Review checklist", "nextActionReview"],
] as const;

const DOC_NAMES: Record<string, string> = {
  "Commercial Invoice": "فاتورة تجارية",
  "Packing List": "قائمة التعبئة",
  "Certificate of Origin": "شهادة المنشأ",
  "Bill of Lading": "بوليصة الشحن",
  "Technical Certificate": "شهادة فنية",
  "Professional/Other Certificate": "شهادة مهنية / أخرى",
  "Bank Cover Letter": "خطاب تغطية بنكي",
  "Booking Confirmation": "تأكيد الحجز البحري",
};

const ACTIVITY: Record<string, string> = {
  "case.create": "activity.caseCreate",
  "case.status": "activity.caseStatus",
  "case.route": "activity.caseRoute",
  "customer.create": "activity.customerCreate",
  "customer.update": "activity.customerUpdate",
  "document.upload": "activity.documentUpload",
  "document.review": "activity.documentReview",
  "requirement.add": "activity.requirementAdd",
  "requirement.remove": "activity.requirementRemove",
  "invoice.create": "activity.invoiceCreate",
  "tracking.create": "activity.trackingCreate",
  "tracking.revoke": "activity.trackingRevoke",
  "roles.set": "activity.rolesSet",
  "overrides.set": "activity.overridesSet",
  "user.disable": "activity.userDisable",
  "user.enable": "activity.userEnable",
  "bootstrap.admin": "activity.bootstrap",
  "invoice.update": "activity.invoiceUpdate",
  "invoice.correct": "activity.invoiceCorrect",
  "booking.create": "activity.bookingCreate",
  "booking.update": "activity.bookingUpdate",
  "booking.confirmation": "activity.bookingConfirmation",
  "container.number": "activity.containerNumber",
  "container.status": "activity.containerStatus",
  "bank.transition": "activity.bankTransition",
  "courier.create": "activity.courierCreate",
  "courier.status": "activity.courierStatus",
  "role.permissions.set": "activity.rolePermissions",
  "custom_field.create": "activity.customFieldCreate",
  "custom_field.update": "activity.customFieldUpdate",
  "custom_field.save": "activity.customFieldSave",
  CASE_CREATED: "activity.caseCreate",
  CASE_STATUS: "activity.caseStatus",
  BANK_STATUS: "activity.bankTransition",
  DIRECT_STATUS: "activity.directTransition",
  COURIER_STATUS: "activity.courierStatus",
  CONTAINER_STATUS: "activity.containerStatus",
  BOOKING_CREATED: "activity.bookingCreate",
  DOCUMENT_UPLOADED: "activity.documentUpload",
  DOCUMENT_REVIEW: "activity.documentReview",
  ROUTE_CHANGED: "activity.caseRoute",
};

const RULES: Record<string, string> = {
  "rr-doc-due": "rule.docDue",
  "rr-review": "rule.review",
};

export function useCopy() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  function tx(key: string, fallback: string) {
    const value = t(key);
    return value === key ? fallback : value;
  }
  function fail(error: unknown) {
    const code = errorCode(error);
    return tx(`errors.${code}`, fallbackFor(code));
  }
  function activity(action: string, fallback?: string) {
    const key = ACTIVITY[action];
    if (!key) return fallback ?? action.replaceAll(".", " ");
    return tx(key, fallback ?? action.replaceAll(".", " "));
  }
  function ruleName(id: string, fallback: string) {
    const key = RULES[id];
    return key ? tx(key, fallback) : fallback;
  }
  function stored(text: string | null | undefined) {
    if (!text) return "";
    if (!ar) return text;
    for (const [prefix, key] of STORED_PREFIXES) {
      if (text === prefix) return tx(key, prefix);
      if (text.startsWith(`${prefix}: `)) {
        const name = text.slice(prefix.length + 2);
        return `${tx(key, prefix)}: ${DOC_NAMES[name] ?? name}`;
      }
    }
    return text;
  }
  return { ar, tx, t, i18n, stored, fail, activity, ruleName };
}

export function formatWhen(value: string | number | null | undefined, language: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
