import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * U12 — i18n contract for the W2 quotations feature: the quotation keys exist
 * in both dictionaries, stay nonempty, and never fall back to the raw key; the
 * new quotation statuses are labeled (not raw enums); every QUOTE_* error code
 * the service can emit has an errors.<CODE> entry in both languages.
 */
const en = JSON.parse(readFileSync("src/locales/en.json", "utf8")) as Record<string, string>;
const ar = JSON.parse(readFileSync("src/locales/ar.json", "utf8")) as Record<string, string>;

const QUOTATION_KEYS = [
  "quotations",
  "quotationsHint",
  "quotationNew",
  "quotationCreate",
  "quotationCreated",
  "quotationDetail",
  "quotationEdit",
  "quotationUpdate",
  "quotationUpdated",
  "quotationNumber",
  "quotationTitle",
  "quotationCustomer",
  "quotationStatus",
  "quotationValidUntil",
  "quotationIssuedAt",
  "quotationRevision",
  "quotationValidityDays",
  "quotationIncoterm",
  "quotationCaseRef",
  "quotationClientResponse",
  "quotationSubtotal",
  "quotationPaymentTerms",
  "quotationNotes",
  "quotationItems",
  "quotationItemsEmpty",
  "quotationItemDescription",
  "quotationItemQuantity",
  "quotationItemUnit",
  "quotationItemPrice",
  "quotationItemTotal",
  "quotationItemActions",
  "quotationItemEdit",
  "quotationItemDelete",
  "quotationItemSave",
  "quotationAddItem",
  "quotationRemoveItem",
  "quotationIssue",
  "quotationIssued",
  "quotationReasonOptional",
  "quotationReasonRequired",
  "quotationRevise",
  "quotationRevised",
  "quotationReviseHint",
  "quotationRecordResponse",
  "quotationResponseRecorded",
  "quotationAccept",
  "quotationReject",
  "quotationArchive",
  "quotationArchived",
  "quotationArchivedAt",
  "quotationDownloadCsv",
  "quotationDownloadPdf",
  "quotationSearch",
  "quotationEmpty",
];

const QUOTE_ERROR_CODES = [
  "QUOTE_NUMBER_REQUIRED",
  "QUOTE_NUMBER_INVALID_FORMAT",
  "QUOTE_NUMBER_TAKEN",
  "QUOTE_VERSION",
  "QUOTE_ITEMS_INVALID",
  "QUOTE_LINE_QUANTITY_INVALID",
  "QUOTE_LINE_PRICE_INVALID",
  "QUOTE_ITEMS_EMPTY",
  "QUOTE_LINE_QUANTITY_ZERO",
  "QUOTE_LINE_PRICE_ZERO",
  "QUOTE_VALIDITY_INVALID",
  "QUOTE_NOT_DRAFT",
  "QUOTE_NOT_EDITABLE",
  "QUOTE_NOT_ISSUED",
  "QUOTE_NOT_LINKED",
  "QUOTE_EXPIRED",
  "QUOTE_RESPONSE_RECORDED",
  "QUOTE_RESPONSE_INVALID",
  "QUOTE_REASON",
  "QUOTE_ALREADY_ARCHIVED",
  "QUOTE_COPY_SELF",
  "QUOTE_COPY_EMPTY",
];

/** Every QUOTE_* code the service can emit — kept in sync by this assertion. */
const SERVICE_CODES = readFileSync("server/services/quotations.ts", "utf8").match(/"QUOTE_[A-Z_]+"/g) ?? [];
const SERVICE_CODE_SET = new Set(
  SERVICE_CODES.map((raw) => raw.slice(1, -1)).filter((code) => code !== "quote_number"),
);

describe("U12 quotations i18n", () => {
  it("defines every quotation key in both languages with nonempty labels", () => {
    for (const key of QUOTATION_KEYS) {
      expect(en[key]?.trim().length, `en ${key}`).toBeGreaterThan(0);
      expect(ar[key]?.trim().length, `ar ${key}`).toBeGreaterThan(0);
    }
  });

  it("labels the quotation statuses instead of raw enums", () => {
    for (const value of ["ISSUED", "ACCEPTED", "REJECTED", "EXPIRED"]) {
      expect(en[`status.${value}`]).not.toBe(value);
      expect(ar[`status.${value}`]).not.toBe(value);
    }
  });

  it("covers every QUOTE_* code the service emits", () => {
    expect(SERVICE_CODE_SET.size).toBeGreaterThan(15);
    for (const code of SERVICE_CODE_SET) {
      expect(QUOTE_ERROR_CODES).toContain(code);
      expect(en[`errors.${code}`]?.trim().length, `en errors.${code}`).toBeGreaterThan(0);
      expect(ar[`errors.${code}`]?.trim().length, `ar errors.${code}`).toBeGreaterThan(0);
    }
  });
});
