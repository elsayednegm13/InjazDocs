import { minorToDecimalString, normalizeDecimalInput, parseDecimalToMinor } from "@shared/money";
import {
  calculatePackingLineWeights,
  reconcileTradeTotals,
  shouldIncludePiecesInReconciliation,
  type ExtraAccessory,
  type PackingLineType,
  type ReconciliationSummary,
} from "@shared/trade-documents";

export type { ExtraAccessory, PackingLineType };

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
  piece_weight_grams?: number | null;
  unit_net_weight_grams?: number | null;
  bag_weight_grams?: number | null;
  poster_weight_grams?: number | null;
  other_accessory_weight_grams?: number | null;
  extra_accessories_json?: string | null;
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
  lineType: PackingLineType;
  description: string;
  hsCode: string;
  barcode?: string;
  packages: string;
  perPackage: string;
  unitNetKg: string;
  bagKg: string;
  posterKg: string;
  otherAccessoryKg: string;
  extraAccessories: ExtraAccessory[];
  manualOverride: boolean;
  includePiecesInReconciliation: boolean;
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
  return minorToDecimalString(Math.max(0, Math.trunc(Number(grams) || 0)), 3);
}

export function kgToGrams(value: string) {
  const text = normalizeDecimalInput(value || "0");
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN;
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
}

export function safeGrams(value: string) {
  const grams = kgToGrams(value);
  return Number.isFinite(grams) && grams >= 0 ? grams : 0;
}

export function computeDraftPackingWeights(line: PackingDraftLine) {
  const packagesCount = Number.isInteger(Number(line.packages)) && Number(line.packages) >= 0 ? Number(line.packages) : 0;
  const packingPerPackage = Number.isInteger(Number(line.perPackage)) && Number(line.perPackage) >= 0 ? Number(line.perPackage) : 0;
  const unitNetWeightGrams = safeGrams(line.unitNetKg);
  const bagWeightGrams = safeGrams(line.bagKg);
  const posterWeightGrams = safeGrams(line.posterKg);
  const otherAccessoryWeightGrams = safeGrams(line.otherAccessoryKg);
  const explicitGross = safeGrams(line.grossKg);
  const explicitNet = safeGrams(line.netKg);
  return calculatePackingLineWeights({
    packagesCount,
    packingPerPackage,
    unitNetWeightGrams,
    bagWeightGrams,
    posterWeightGrams,
    otherAccessoryWeightGrams,
    extraAccessories: line.extraAccessories,
    manualWeightOverride: line.manualOverride,
    grossWeightGrams: explicitGross,
    netWeightGrams: explicitNet,
  });
}

export function applyDraftWeightPatch(line: PackingDraftLine, patch: Partial<PackingDraftLine>): PackingDraftLine {
  const next: PackingDraftLine = { ...line, ...patch };
  // If the user directly typed grossKg or netKg while component weights exist, enable manualOverride automatically unless patch explicitly set manualOverride.
  if (("grossKg" in patch || "netKg" in patch) && !("manualOverride" in patch)) {
    const hasComponents =
      safeGrams(next.unitNetKg) > 0 ||
      safeGrams(next.bagKg) > 0 ||
      safeGrams(next.posterKg) > 0 ||
      safeGrams(next.otherAccessoryKg) > 0 ||
      next.extraAccessories.length > 0;
    if (hasComponents) {
      next.manualOverride = true;
    }
  }
  const calc = computeDraftPackingWeights(next);
  if (!next.manualOverride && (calc.unitNetWeightGrams > 0 || calc.unitGrossWeightGrams > 0)) {
    next.netKg = kgText(calc.netWeightGrams);
    next.grossKg = kgText(calc.grossWeightGrams);
  }
  return next;
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
    const calc = computeDraftPackingWeights(line);
    const includePieces = shouldIncludePiecesInReconciliation(line.lineType, line.includePiecesInReconciliation);
    const packages = Number.isInteger(Number(line.packages)) && Number(line.packages) >= 0 ? Number(line.packages) : 0;
    return {
      pieces: includePieces ? calc.piecesCount : 0,
      packages,
      gross: calc.grossWeightGrams,
      net: calc.netWeightGrams,
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
