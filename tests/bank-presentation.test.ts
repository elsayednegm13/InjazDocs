import { afterEach, describe, expect, it } from "vitest";
import { evaluateBankPresentation } from "../shared/bank-presentation";
import { createTestHarness } from "./transition-2026-10-21/harness/app";
import { createAuditDatabase, type AuditDatabase } from "./transition-2026-10-21/harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh() {
  const audit = createAuditDatabase();
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

const invoice = {
  portOfLoading: "Alexandria",
  portOfDischarge: "Jeddah",
  paymentTerm: "TT",
};
const booking = {
  portOfLoading: "Alexandria",
  portOfDischarge: "Jeddah",
  status: "CONFIRMED",
};

describe("bank presentation check", () => {
  it("flags a port that differs between the invoice and the booking", () => {
    const found = evaluateBankPresentation({
      invoices: [invoice],
      bookings: [{ ...booking, portOfLoading: "Damietta" }],
      documents: [],
    });
    expect(found).toEqual([
      {
        code: "PORT_MISMATCH",
        field: "port_of_loading",
        invoiceValue: "Alexandria",
        bookingValue: "Damietta",
      },
    ]);
  });

  it("treats spacing and letter case as the same port", () => {
    expect(evaluateBankPresentation({
      invoices: [{ ...invoice, portOfLoading: "  Alexandria  " }],
      bookings: [{ ...booking, portOfLoading: "alexandria" }],
      documents: [],
    })).toEqual([]);
  });

  it("requires the commercial invoice and bill of lading only for LC, DP, and DA", () => {
    const documents = [{ typeKey: "commercial_invoice", status: "APPROVED" }];
    expect(evaluateBankPresentation({
      invoices: [{ ...invoice, paymentTerm: "LC" }],
      bookings: [booking],
      documents,
    }).map((item) => item.code === "DOCUMENT_NOT_READY" ? item.documentKey : item.code)).toEqual(["bill_of_lading"]);
    expect(evaluateBankPresentation({
      invoices: [{ ...invoice, paymentTerm: "TT" }],
      bookings: [booking],
      documents,
    })).toEqual([]);
    expect(evaluateBankPresentation({
      invoices: [{ ...invoice, paymentTerm: "DP" }],
      bookings: [booking],
      documents: [...documents, { typeKey: "bill_of_lading", status: "UPLOADED" }],
    })).toEqual([]);
  });

  it("records the port mismatch and still hands the documents to the bank", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const now = "2026-11-08T00:00:00.000Z";
    audit.sqlite.prepare("UPDATE export_cases SET bank_path_status = 'READY_FOR_PHYSICAL_HANDOVER' WHERE id = 'case-1'").run();
    audit.sqlite
      .prepare(
        `INSERT INTO export_invoices
           (id, case_id, invoice_number, invoice_date, customer_id, port_of_loading, port_of_discharge, payment_term_code,
            incoterm, incoterms_edition, currency, currency_decimals, goods_value_minor, invoiced_freight_minor,
            actual_freight_expense_minor, invoice_total_minor, gross_weight_grams, net_weight_grams, version, created_at, updated_at)
         VALUES ('invoice-bank', 'case-1', 'INV-BANK-1', '2026-11-08', 'customer-1', 'Alexandria', 'Jeddah', 'TT',
            'FOB', 'Incoterms 2020', 'USD', 2, 1000, 0, 0, 1000, 1000, 900, 1, ?, ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO bookings
           (id, case_id, booking_number, port_of_loading, port_of_discharge, status, version, created_at, updated_at)
         VALUES ('booking-bank', 'case-1', 'BKG-BANK-1', 'Damietta', 'Jeddah', 'CONFIRMED', 1, ?, ?)`,
      )
      .run(now, now);

    const preview = await harness.request({ path: "/api/v1/export-cases/case-1/bank/presentation-check" });
    expect(preview.status).toBe(200);
    expect(preview.text).toContain("PORT_MISMATCH");
    expect(preview.text).toContain("Damietta");

    const response = await harness.request({
      method: "POST",
      path: "/api/v1/export-cases/case-1/bank/status",
      body: { to: "HANDED_TO_BANK" },
    });
    expect(response.status).toBe(200);
    const current = audit.sqlite.prepare("SELECT status, bank_path_status FROM export_cases WHERE id = 'case-1'").get() as {
      status: string;
      bank_path_status: string;
    };
    expect(current.status).toBe("ACTIVE");
    expect(current.bank_path_status).toBe("HANDED_TO_BANK");
    const warning = audit.sqlite
      .prepare("SELECT reason FROM bank_events WHERE event_type = 'DISCREPANCY_WARNING'")
      .get() as { reason: string };
    expect(warning.reason).toContain("PORT_MISMATCH port_of_loading");
    expect(warning.reason).toContain("invoice=Alexandria");
    expect(warning.reason).toContain("booking=Damietta");
  });
});
