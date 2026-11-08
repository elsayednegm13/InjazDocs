const COLLECTION_TERMS = new Set(["LC", "DP", "DA"]);
const READY_DOCUMENT = new Set(["UPLOADED", "UNDER_REVIEW", "APPROVED"]);

export type PresentationDiscrepancy =
  | {
      code: "PORT_MISMATCH";
      field: "port_of_loading" | "port_of_discharge";
      invoiceValue: string;
      bookingValue: string;
    }
  | { code: "DOCUMENT_NOT_READY"; documentKey: "commercial_invoice" | "bill_of_lading" }
  | { code: "PRESENTATION_BASIS_MISSING"; field: "invoice" | "booking" };

export function evaluateBankPresentation(input: {
  invoices: Array<{ portOfLoading: string | null; portOfDischarge: string | null; paymentTerm: string }>;
  bookings: Array<{ portOfLoading: string | null; portOfDischarge: string | null; status: string }>;
  documents: Array<{ typeKey: string; status: string }>;
}): PresentationDiscrepancy[] {
  const found: PresentationDiscrepancy[] = [];
  const invoice = input.invoices[0];
  const booking = input.bookings.find((row) => row.status !== "CANCELLED");
  if (!invoice) found.push({ code: "PRESENTATION_BASIS_MISSING", field: "invoice" });
  if (!booking) found.push({ code: "PRESENTATION_BASIS_MISSING", field: "booking" });
  if (invoice && booking) {
    const ports = [
      ["port_of_loading", invoice.portOfLoading, booking.portOfLoading],
      ["port_of_discharge", invoice.portOfDischarge, booking.portOfDischarge],
    ] as const;
    for (const [field, invoiceValue, bookingValue] of ports) {
      if (normalizePort(invoiceValue) === normalizePort(bookingValue)) continue;
      found.push({
        code: "PORT_MISMATCH",
        field,
        invoiceValue: invoiceValue ?? "",
        bookingValue: bookingValue ?? "",
      });
    }
  }
  if (invoice && COLLECTION_TERMS.has(invoice.paymentTerm)) {
    for (const documentKey of ["commercial_invoice", "bill_of_lading"] as const) {
      const ready = input.documents.some((row) => row.typeKey === documentKey && READY_DOCUMENT.has(row.status));
      if (!ready) found.push({ code: "DOCUMENT_NOT_READY", documentKey });
    }
  }
  return found;
}

export function discrepancyReason(item: PresentationDiscrepancy) {
  if (item.code === "PORT_MISMATCH") {
    return `PORT_MISMATCH ${item.field} invoice=${item.invoiceValue} booking=${item.bookingValue}`;
  }
  if (item.code === "DOCUMENT_NOT_READY") return `DOCUMENT_NOT_READY ${item.documentKey}`;
  return `PRESENTATION_BASIS_MISSING ${item.field}`;
}

function normalizePort(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
