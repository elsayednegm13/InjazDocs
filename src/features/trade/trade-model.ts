import { minorToDecimalString, normalizeDecimalInput, parseDecimalToMinor } from "@shared/money";
import { packingPieces, reconcileTradeTotals, type ReconciliationSummary } from "@shared/trade-documents";

export type BankAccount = {
  id: string;
  account_name: string;
  iban: string;
  bank_name: string;
  bank_address: string | null;
  swift_code: string | null;
  currency: string;
  is_default: number;
};

export type ProductPreset = {
  id: string;
  name: string;
  description_template: string;
  ply: string | null;
  material: string | null;
  size_label: string | null;
  barcode: string | null;
  hs_code: string | null;
  unit_label: string | null;
  default_price_minor: number;
  default_packing_per_package: number | null;
};

export type InvoiceDraftLine = {
  key: string;
  description: string;
  hsCode: string;
  barcode: string;
  unit: string;
  quantity: string;
  price: string;
};

export type PackingDraftLine = {
  key: string;
  containerId: string;
  description: string;
  hsCode: string;
  packages: string;
  perPackage: string;
  grossKg: string;
  netKg: string;
};

export function newKey() {
  return crypto.randomUUID();
}

export function moneyText(minor: number, currency = "USD") {
  return minorToDecimalString(minor, currency === "JPY" ? 0 : 2);
}

export function moneyMinor(value: string, currency = "USD") {
  return Number(parseDecimalToMinor(value.trim() || "0", currency).minorUnits);
}

export function kgText(grams: number) {
  return minorToDecimalString(grams, 3);
}

export function kgToGrams(value: string) {
  const text = normalizeDecimalInput(value || "0");
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN;
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
}

export function lineAmount(line: InvoiceDraftLine, currency: string) {
  const qty = Number(line.quantity);
  if (!Number.isInteger(qty) || qty < 0) return 0;
  try {
    return qty * moneyMinor(line.price, currency);
  } catch {
    return 0;
  }
}

export function liveReconciliation(input: {
  lines: InvoiceDraftLine[];
  packing: PackingDraftLine[];
  packages: number;
  grossGrams: number;
  netGrams: number;
  currency: string;
}): ReconciliationSummary {
  const pieces = input.lines.reduce((sum, line) => sum + (Number.isInteger(Number(line.quantity)) ? Number(line.quantity) : 0), 0);
  const packed = input.packing.map((line) => {
    const packages = Number(line.packages);
    const per = Number(line.perPackage);
    const gross = kgToGrams(line.grossKg);
    const net = kgToGrams(line.netKg);
    return {
      pieces: Number.isInteger(packages) && Number.isInteger(per) ? packingPieces(packages, per) : 0,
      packages: Number.isInteger(packages) ? packages : 0,
      gross: Number.isFinite(gross) ? gross : 0,
      net: Number.isFinite(net) ? net : 0,
    };
  });
  return reconcileTradeTotals(
    { pieces, packages: input.packages, grossGrams: input.grossGrams, netGrams: input.netGrams },
    {
      pieces: packed.reduce((sum, line) => sum + line.pieces, 0),
      packages: packed.reduce((sum, line) => sum + line.packages, 0),
      grossGrams: packed.reduce((sum, line) => sum + line.gross, 0),
      netGrams: packed.reduce((sum, line) => sum + line.net, 0),
    },
  );
}

export async function downloadPdf(path: string, filename: string) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw new Error("PDF_DOWNLOAD_FAILED");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
