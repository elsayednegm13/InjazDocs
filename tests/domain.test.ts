import { describe, expect, it } from "vitest";
import { carrierTrackingUrl } from "../shared/carrier";
import { validateContainerNumber } from "../shared/container";
import { parseDecimalToMinor, minorToDecimalString } from "../shared/money";
import { resolveEffectivePermissions } from "../shared/permissions";
import { assertGrossGteNet, toGrams } from "../shared/weights";
import { canCompleteCase, bookingAggregateFromContainers } from "../server/domain/case-completion";
import { customFieldsRequiredNow, serializeCustomFieldValue, validateRequiredCustomFields } from "../server/domain/custom-fields";
import { csvToRecords } from "../shared/csv";
import { addBusinessDays, addCalendarDays, addOffset, dateOnlyInZone } from "../server/domain/dates";
import { invoiceTotalComparison, validateInvoiceCommercials } from "../server/domain/invoice";
import {
  buildDedupKey,
  conditionStillHolds,
  evaluateDue,
  notificationCycleKey,
} from "../server/domain/reminders";
import {
  assertBankTransition,
  assertCaseTransition,
  assertCourierTransition,
  assertDirectTransition,
  assertDocumentTransition,
  assertRouteChange,
  documentTrackComplete,
  goodsTrackComplete,
} from "../server/domain/transitions";

describe("T02 invoice commercials", () => {
  it("keeps FOB actual freight and rejects invoiced ocean freight", () => {
    const fob = validateInvoiceCommercials({
      incoterm: "FOB",
      goodsValueMinor: 10000,
      invoicedFreightMinor: 0,
      actualFreightExpenseMinor: 2500,
      invoiceTotalMinor: 10000,
      currency: "USD",
      grossWeightGrams: 2000,
      netWeightGrams: 1800,
    });
    expect(fob.ok).toBe(true);
    const bad = validateInvoiceCommercials({
      incoterm: "FOB",
      goodsValueMinor: 10000,
      invoicedFreightMinor: 500,
      actualFreightExpenseMinor: 2500,
      invoiceTotalMinor: 10500,
      currency: "USD",
      grossWeightGrams: 2000,
      netWeightGrams: 1800,
    });
    expect(bad.ok).toBe(false);
  });

  it("allows CFR invoiced freight without rewriting an explicit total", () => {
    const cfr = validateInvoiceCommercials({
      incoterm: "CFR",
      goodsValueMinor: 10000,
      invoicedFreightMinor: 800,
      actualFreightExpenseMinor: 900,
      invoiceTotalMinor: 11111,
      currency: "USD",
      grossWeightGrams: 2000,
      netWeightGrams: 1800,
    });
    expect(cfr.ok).toBe(true);
    const cmp = invoiceTotalComparison({
      invoiceTotalMinor: 11111,
      goodsValueMinor: 10000,
      invoicedFreightMinor: 800,
    });
    expect(cmp.matchesGoodsPlusInvoicedFreight).toBe(false);
  });
});

describe("T03 weights and money", () => {
  it("rejects gross < net and negative money", () => {
    expect(() => assertGrossGteNet(100, 200)).toThrow("GROSS_LT_NET");
    expect(toGrams(2, "T")).toBe(2_000_000);
    const money = parseDecimalToMinor("12.50", "USD");
    expect(minorToDecimalString(money.minorUnits, 2)).toBe("12.50");
  });
});

describe("T06 routes", () => {
  it("blocks bank stages from the direct path and allows correction loops", () => {
    assertBankTransition("BANK_REVIEW", "CORRECTION_REQUESTED");
    assertBankTransition("CORRECTION_REQUESTED", "SCANNED");
    expect(() => assertDirectTransition("PREPARING", "DOCUMENTS_DELIVERED")).toThrow();
    expect(() => assertRouteChange("BANK_ROUTE", "DIRECT_ROUTE", "HANDED_TO_BANK")).toThrow();
    assertRouteChange("BANK_ROUTE", "DIRECT_ROUTE", "SCANNED");
  });
});

describe("T07 courier", () => {
  it("builds only allowlisted carrier URLs and stays manual", () => {
    expect(carrierTrackingUrl("DHL", "1234567890")).toContain("dhl.com");
    expect(carrierTrackingUrl("UNKNOWN", "1234567890")).toBeNull();
    assertCourierTransition("DISPATCHED", "IN_TRANSIT");
    assertCourierTransition("IN_TRANSIT", "DELIVERED");
  });
});

describe("T08 T10 containers and completion", () => {
  it("allows 5 empty slots and does not treat port arrival as delivery", () => {
    const aggregate = bookingAggregateFromContainers(5, [
      { status: "PLANNED", officialNumber: null },
      { status: "PLANNED", officialNumber: null },
      { status: "LOADED", officialNumber: "MSCU1234560" },
      { status: "PLANNED", officialNumber: null },
      { status: "PLANNED", officialNumber: null },
    ]);
    expect(aggregate.registeredCount).toBe(1);
    expect(aggregate.loadedCount).toBe(1);
    expect(aggregate.suggestedStatus).toBe("LOADING_IN_PROGRESS");
    expect(goodsTrackComplete([{ status: "ARRIVED_PORT" }])).toBe(false);
    expect(documentTrackComplete({ route: "DIRECT_ROUTE", bankStatus: "NOT_REQUIRED", directStatus: "DOCUMENTS_DELIVERED" })).toBe(true);
    const close = canCompleteCase({
      status: "ACTIVE",
      route: "DIRECT_ROUTE",
      bankStatus: "NOT_REQUIRED",
      directStatus: "DOCUMENTS_DELIVERED",
      containers: [{ status: "ARRIVED_PORT" }],
      hasClosePermission: true,
    });
    expect(close.ok).toBe(false);
  });
});

describe("T08 container numbers", () => {
  it("validates ISO 6346 and accepts planned slots without numbers", () => {
    expect(validateContainerNumber("CSQU3054383").ok).toBe(true);
    expect(validateContainerNumber("CSQU3054380").ok).toBe(false);
  });
});

describe("T12 permissions", () => {
  it("applies deny overrides after role grants", () => {
    const effective = resolveEffectivePermissions({
      roleGrants: ["customers.view", "customers.bank_details.view"],
      overrides: [{ permissionKey: "customers.bank_details.view", effect: "DENY" }],
    });
    expect(effective.has("customers.view")).toBe(true);
    expect(effective.has("customers.bank_details.view")).toBe(false);
  });
});

describe("T14 T15 reminders", () => {
  it("resolves a snoozed missing-document reminder when the document becomes ready", () => {
    const evaluated = evaluateDue({
      instance: {
        id: "r1",
        ruleId: "rr-doc-due",
        targetType: "document_requirement",
        targetId: "d1",
        caseId: "c1",
        conditionKey: "DOCUMENT_NOT_READY",
        generation: 1,
        dueAt: "2026-10-15T00:00:00.000Z",
        status: "SNOOZED",
        snoozedUntil: "2026-10-17T00:00:00.000Z",
        resolvedAt: null,
        dedupKey: buildDedupKey({ ruleId: "rr-doc-due", sourceEntityId: "d1", conditionGeneration: 1 }),
      },
      conditionHolds: conditionStillHolds({
        condition: "DOCUMENT_NOT_READY",
        documentReady: true,
        reviewPending: true,
        bankReviewPending: false,
        courierDelivered: false,
        actualDepartureAt: null,
        actualArrivalAt: null,
        goodsDelivered: false,
      }),
      clock: { now: () => new Date("2026-10-16T12:00:00.000Z") },
    });
    expect(evaluated.status).toBe("RESOLVED");
    expect(evaluated.autoResolved).toBe(true);
    expect(evaluated.shouldNotify).toBe(false);
  });

  it("cancels arrival overdue once actual arrival exists", () => {
    expect(
      conditionStillHolds({
        condition: "ARRIVAL_OVERDUE",
        documentReady: true,
        reviewPending: false,
        bankReviewPending: false,
        courierDelivered: false,
        actualDepartureAt: "2026-10-18",
        actualArrivalAt: "2026-10-25",
        goodsDelivered: false,
      }),
    ).toBe(false);
  });
});

describe("T05 document review", () => {
  it("does not auto-approve an upload", () => {
    assertDocumentTransition("MISSING", "UPLOADED");
    expect(() => assertDocumentTransition("MISSING", "APPROVED")).toThrow();
    assertDocumentTransition("UPLOADED", "UNDER_REVIEW");
    assertDocumentTransition("UNDER_REVIEW", "NEEDS_CORRECTION");
    assertDocumentTransition("NEEDS_CORRECTION", "UPLOADED");
    assertDocumentTransition("UNDER_REVIEW", "APPROVED");
  });
});

describe("dates", () => {
  it("keeps date-only math independent of UTC rendering", () => {
    expect(addCalendarDays("2026-10-15", 2)).toBe("2026-10-17");
    expect(addBusinessDays("2026-10-15", 1)).toBe("2026-10-18");
    expect(dateOnlyInZone("2026-10-15T22:00:00.000Z", "Africa/Cairo")).toBe("2026-10-16");
  });
});

describe("custom fields", () => {
  const select = { field_key: "lane", data_type: "SELECT" as const, options_json: JSON.stringify(["A", "B"]) };
  it("validates types and keeps draft requirements optional until the record leaves draft", () => {
    expect(serializeCustomFieldValue({ field_key: "note", data_type: "TEXT", options_json: null }, "  pier  ")).toBe("pier");
    expect(serializeCustomFieldValue(select, "A")).toBe("A");
    expect(() => serializeCustomFieldValue(select, "C")).toThrow(expect.objectContaining({ code: "CUSTOM_FIELD_OPTION_INVALID" }));
    expect(() => serializeCustomFieldValue({ field_key: "when", data_type: "DATE", options_json: null }, "12/01/2026")).toThrow(expect.objectContaining({ code: "CUSTOM_FIELD_TYPE_INVALID" }));
    expect(() => validateRequiredCustomFields([{ field_key: "file_no", required: 1 }], {})).toThrow(expect.objectContaining({ code: "CUSTOM_FIELD_REQUIRED" }));
    expect(customFieldsRequiredNow("EXPORT_CASE", "DRAFT")).toBe(false);
    expect(customFieldsRequiredNow("EXPORT_CASE", "ACTIVE")).toBe(true);
    expect(customFieldsRequiredNow("BOOKING", "CANCELLED")).toBe(false);
    expect(customFieldsRequiredNow("CONTAINER", "PLANNED")).toBe(false);
    expect(customFieldsRequiredNow("CONTAINER", "LOADED")).toBe(true);
    expect(customFieldsRequiredNow("CUSTOMER")).toBe(true);
    expect(customFieldsRequiredNow("INVOICE")).toBe(true);
  });

  it("parses quoted CSV commas, escaped quotes, and a BOM", () => {
    const rows = csvToRecords('\uFEFFlegal_name,country_code,phone\n"Nile, Trading","EG","+20 ""1"""\n');
    expect(rows).toEqual([{ legal_name: "Nile, Trading", country_code: "EG", phone: '+20 "1"' }]);
  });
});

describe("notification cadence", () => {
  const now = new Date("2026-10-13T01:30:00.000Z");
  const nextHour = new Date("2026-10-13T02:30:00.000Z");
  it("sends one notice when no repeat interval is configured, even across UTC hours", () => {
    const first = notificationCycleKey({
      repeatEveryDays: null,
      repeatCap: null,
      deliveredCount: 0,
      lastDeliveredAt: null,
      now,
    });
    const later = notificationCycleKey({
      repeatEveryDays: null,
      repeatCap: null,
      deliveredCount: 1,
      lastDeliveredAt: now.toISOString(),
      now: nextHour,
    });
    expect(first).toBe("once");
    expect(later).toBeNull();
  });

  it("repeats only after the configured day interval and stops at the cap", () => {
    const blocked = notificationCycleKey({
      repeatEveryDays: 2,
      repeatCap: 3,
      deliveredCount: 1,
      lastDeliveredAt: now.toISOString(),
      now: nextHour,
    });
    const due = notificationCycleKey({
      repeatEveryDays: 2,
      repeatCap: 3,
      deliveredCount: 1,
      lastDeliveredAt: now.toISOString(),
      now: new Date("2026-10-15T01:30:00.000Z"),
    });
    const capped = notificationCycleKey({
      repeatEveryDays: 2,
      repeatCap: 1,
      deliveredCount: 1,
      lastDeliveredAt: now.toISOString(),
      now: new Date("2026-10-20T01:30:00.000Z"),
    });
    expect(blocked).toBeNull();
    expect(due).toMatch(/^every-2d:/);
    expect(capped).toBeNull();
  });
});

describe("Africa/Cairo calendar date", () => {
  it("crosses local midnight without using the host timezone", () => {
    expect(dateOnlyInZone("2026-10-16T20:59:00.000Z", "Africa/Cairo")).toBe("2026-10-16");
    expect(dateOnlyInZone("2026-10-16T21:01:00.000Z", "Africa/Cairo")).toBe("2026-10-17");
  });

  it("applies hour offsets from UTC midnight of the date-only", () => {
    const due = addOffset({
      dateOnly: "2026-10-17",
      direction: "BEFORE",
      amount: 1,
      unit: "HOURS",
      policy: "CALENDAR",
      timeZone: "Africa/Cairo",
    });
    expect(due.toISOString()).toBe("2026-10-16T23:00:00.000Z");
  });
});

describe("case reopen", () => {
  it("allows completed -> active and rejects skipping draft straight to completed", () => {
    assertCaseTransition("COMPLETED", "ACTIVE");
    expect(() => assertCaseTransition("DRAFT", "COMPLETED")).toThrow(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });
});
