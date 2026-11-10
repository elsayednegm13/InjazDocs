import { afterEach, describe, expect, it } from "vitest";
import { renderCustomsBundle, renderTradePdf, type CommercialPdf, type PackingPdf, type ProformaPdf, type TradeIdentity, type TradeItem } from "../server/services/trade-document-pdf";
import { createTestHarness } from "./transition-2026-10-21/harness/app";
import { createAuditDatabase, type AuditDatabase } from "./transition-2026-10-21/harness/db";

const openDatabases: AuditDatabase[] = [];
const identity: TradeIdentity = {
  nameEn: "NANA SECRET COMPANY",
  nameAr: "نانا سيكريت",
  address: "10th of Ramadan",
  phone: "01000000000",
  email: "export@example.invalid",
  taxCard: "123",
  taxFile: "456",
  commercialRegistry: "789",
  stampLabelEn: "NANA SECRET COMPANY",
  stampLabelAr: "نانا سيكريت",
};
const buyer = { name: "Buyer", address: "Jeddah", vat: "VAT-1", phone: "050", email: "buyer@example.invalid", code: "EX-116", country: "SA" };
const bank = { accountName: "NANA SECRET", iban: "EG00TEST", bankName: "Bank", bankAddress: "Cairo", swift: "NANSXXXX" };

function item(index: number): TradeItem {
  return { description: `Blanket line ${index}\n100% POLYESTER\nHS 6301.40`, unit: "PCS", quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100 };
}

function base(draft: boolean) {
  return {
    draft,
    identity,
    buyer,
    date: "2026-11-09",
    invoiceNumber: "INV-733",
    printReference: "EX-116",
    origin: "EGYPT",
    portOfLoading: "Alexandria",
    portOfDischarge: "Jeddah",
    shippingMethod: "C&F",
    paymentTerm: "100% PAID",
    bank,
    logo: null,
    stamp: null,
    stamped: false,
    stampXRatio: 0.5,
    stampYRatio: 0.25,
    stampScale: 1,
    stampRotation: 0,
    includeFreight: true,
  };
}

function textOf(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

describe("trade document pdf", () => {
  it("renders the four pdf modes, a draft watermark, and a stamp image only when placed", async () => {
    const proforma: ProformaPdf = { ...base(true), kind: "proforma", incoterm: "CFR", fobMinor: 10000, freightMinor: 500, lines: [item(1)] };
    const commercial: CommercialPdf = { ...base(false), kind: "commercial", incoterm: "CFR", fobMinor: 10000, freightMinor: 500, packages: 25, grossGrams: 9000, netGrams: 7000, lines: [item(1)] };
    const packing: PackingPdf = {
      ...base(false),
      kind: "packing",
      rows: [{ slot: 1, containerNumber: "MRSU1234567", description: "Bay blankets", packages: 25, perPackage: 17, pieces: 425, grossGrams: 9000, netGrams: 7000 }],
    };
    const longCommercial: CommercialPdf = { ...commercial, lines: Array.from({ length: 48 }, (_, index) => item(index + 1)) };
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x00, 0xff, 0xd9]);
    const files = await Promise.all([
      renderTradePdf(proforma),
      renderTradePdf(commercial),
      renderTradePdf(packing),
      renderCustomsBundle(commercial, packing),
      renderTradePdf({ ...commercial, stamped: true, stamp: jpeg }),
      renderTradePdf(longCommercial),
    ]);
    for (const file of files) expect(textOf(file).startsWith("%PDF-")).toBe(true);
    expect(textOf(files[0])).toContain("DRAFT");
    expect(textOf(files[0])).toContain("(EX-116)");
    expect(textOf(files[1])).not.toContain("DRAFT");
    expect(textOf(files[1])).not.toContain("APPROVED");
    expect(textOf(files[1])).not.toContain("/ImStamp");
    expect(textOf(files[4])).toContain("DCTDecode");
    expect(textOf(files[4])).toContain("/ImStamp");
    expect(textOf(files[4])).toContain("1 0 0 1 297.64 210.47 cm");
    expect(textOf(files[4])).not.toContain("APPROVED");
    expect(textOf(files[5])).toMatch(/\/Count [2-9]/);
    expect(textOf(files[5]).split("(FACTORY)").length - 1).toBe(1);
  });

  it("stores issued invoice and packing pdfs as new document versions without removing the previous one", async () => {
    const audit = createAuditDatabase();
    openDatabases.push(audit);
    const now = "2026-11-09T00:00:00.000Z";
    audit.sqlite.prepare(
      `INSERT INTO export_invoices
         (id, case_id, invoice_number, invoice_date, customer_id, payment_term_code, payment_term_label, incoterm, shipping_method_label,
          incoterms_edition, currency, currency_decimals, goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor,
          invoice_total_minor, gross_weight_grams, net_weight_grams, packages_count, version, created_at, updated_at)
       VALUES ('invoice-pdf', 'case-1', 'INV-PDF-1', '2026-11-09', 'customer-1', 'LC', '100% PAID', 'CFR', 'C&F',
          'Incoterms 2020', 'USD', 2, 100, 0, 0, 100, 1000, 800, 1, 1, ?, ?)`,
    ).run(now, now);
    audit.sqlite.prepare(
      `INSERT INTO bookings (id, case_id, booking_number, status, version, created_at, updated_at)
       VALUES ('booking-pdf', 'case-1', 'BKG-PDF-1', 'CONFIRMED', 1, ?, ?)`,
    ).run(now, now);
    audit.sqlite.prepare(
      `INSERT INTO containers (id, booking_id, case_id, slot_index, official_number, status, version, created_at, updated_at)
       VALUES ('container-pdf', 'booking-pdf', 'case-1', 1, 'MRSU1234567', 'LOADED', 1, ?, ?)`,
    ).run(now, now);
    audit.sqlite.prepare(
      `INSERT INTO operation_document_requirements (id, case_id, document_type_id, required, status, created_at, updated_at)
       VALUES ('req-pl-pdf', 'case-1', 'dt-pl', 1, 'MISSING', ?, ?)`,
    ).run(now, now);
    audit.sqlite.prepare(
      `INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at)
       VALUES ('version-old-ci', 'requirement-1', 1, 'synthetic/old-invoice.pdf', 'old.pdf', 'application/pdf', 10, 'user-admin', 'UPLOADED', ?)`,
    ).run(now);
    const harness = createTestHarness(audit);
    expect((await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-pdf/lines",
      body: { lines: [{ description: "Invoice blanket\n100% POLYESTER", hsCode: "6301.40", unit: "PCS", quantity: 10, unitPriceMinor: 10 }] },
    })).status).toBe(200);
    expect((await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-pdf/packing-lines",
      body: { lines: [{ description: "Packed differently", containerId: "container-pdf", hsCode: "6301.40", packagesCount: 1, packingPerPackage: 10, grossWeightGrams: 1000, netWeightGrams: 800 }] },
    })).status).toBe(200);
    const issued = await harness.request({ method: "POST", path: "/api/v1/invoices/invoice-pdf/issue-trade", body: {} });
    expect(issued.status).toBe(200);
    const versions = audit.sqlite.prepare(
      `SELECT d.key AS type_key, v.version, v.review_state, v.r2_key
       FROM document_versions v
       JOIN operation_document_requirements r ON r.id = v.requirement_id
       JOIN document_type_definitions d ON d.id = r.document_type_id
       WHERE r.case_id = 'case-1' ORDER BY d.key, v.version`,
    ).all() as Array<{ type_key: string; version: number; review_state: string; r2_key: string }>;
    expect(versions.filter((row) => row.type_key === "commercial_invoice").map((row) => row.version)).toEqual([1, 2]);
    expect(versions.filter((row) => row.type_key === "packing_list")).toEqual([
      expect.objectContaining({ version: 1, review_state: "UPLOADED" }),
    ]);
    expect(versions.every((row) => row.r2_key.length > 0)).toBe(true);
    expect(audit.sqlite.prepare("SELECT COUNT(*) AS n FROM customer_file_shares").get()).toEqual({ n: 0 });
    const download = await harness.request({ path: "/api/v1/invoices/invoice-pdf/customs-pdf" });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.text.startsWith("%PDF-")).toBe(true);
    expect(download.text).toContain("/Count 2");
    expect(download.text).toContain("(Page)");
    expect(download.text).toContain("0.06 0.09 0.16 rg");
    expect(download.text).toContain("re S");
    expect(download.text).toContain("NANA");
    expect(download.text).toContain("BMISEGCXXXX");
    expect(download.text).not.toContain("0.93 0.94 0.96 rg");
  });

  it("draws Arabic buyer and item text in dark ink with a boxed grid", async () => {
    const arabic: ProformaPdf = {
      ...base(false),
      kind: "proforma",
      incoterm: "FOB",
      fobMinor: 300,
      freightMinor: 0,
      buyer: { name: "عميل التصدير", address: "جدة", vat: "", phone: "", email: "", code: "EX-01", country: "SA" },
      lines: [{ description: "بطانية تصدير\n100% POLYESTER", unit: "Piece", quantity: 2, unitPriceMinor: 150, lineTotalMinor: 300 }],
    };
    const pdf = textOf(await renderTradePdf(arabic));
    expect(pdf).toContain("0.06 0.09 0.16 rg");
    expect(pdf).toContain("re S");
    expect(pdf).toContain(" f");
    expect(pdf).toMatch(/\d+\.\d{2} \d+\.\d{2} m/);
    expect(pdf).not.toContain("0.93 0.94 0.96 rg");
  });

  it("keeps the customer table clear of the date box and prints a company stamp", async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x00, 0xff, 0xd9]);
    const description = "Blanket 2.4KG (1 ply)\n100% POLYESTER\nSIZE 180-230 / 200-240\nBARCODE 6223010920876 / 6223010920814";
    const line = (quantity: number, price: number) => ({
      description,
      unit: "Piece",
      quantity,
      unitPriceMinor: price,
      lineTotalMinor: quantity * price,
    });
    const model: ProformaPdf = {
      ...base(false),
      kind: "proforma",
      incoterm: "C&F",
      fobMinor: 1855000,
      freightMinor: 90000,
      buyerRows: [
        { label: "BILL TO", value: "Nordisk Hjalp" },
        { label: "ADDRESS", value: "Cairo, Egypt" },
        { label: "Registration number", value: "12345678910" },
        { label: "TEL", value: "+20 10 04229166" },
        { label: "BANK", value: "Buyer Bank" },
        { label: "ACCOUNT NO", value: "123456789012" },
        { label: "IBAN", value: "EG998877660000000000000001" },
        { label: "SWIFT", value: "BXDE514XXX" },
        { label: "Bank Address", value: "Turkey" },
      ],
      metaRows: [
        { label: "DATE", value: "2026-11-09" },
        { label: "INVOICE NO#", value: "610" },
      ],
      lines: [line(100, 1000), line(200, 500), line(300, 550), line(600, 1400), line(520, 1250)],
      stamp: jpeg,
      stamped: false,
    };
    const bytes = await renderTradePdf(model);
    const pdf = textOf(bytes);
    const boxes = [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      w: Number(match[3]),
      h: Number(match[4]),
    }));
    const left = boxes.filter((box) => box.x === 28 && box.w < 400);
    const right = boxes.filter((box) => box.x > 380 && box.w < 200);
    expect(left.length).toBeGreaterThan(5);
    expect(right.length).toBeGreaterThan(0);
    for (const buyer of left) {
      for (const meta of right) {
        const separated = buyer.x + buyer.w <= meta.x - 6 || meta.x + meta.w <= buyer.x - 6 || buyer.y + buyer.h <= meta.y + 0.5 || meta.y + meta.h <= buyer.y + 0.5;
        expect(separated).toBe(true);
      }
    }
    expect(pdf).toContain("(INVOICE)");
    expect(pdf).toContain("(610)");
    expect(pdf).toContain("/ImStamp");
    expect(pdf).toContain("481.28");
    expect(pdf).toContain("EG998877660000000000000001");
  });
});
