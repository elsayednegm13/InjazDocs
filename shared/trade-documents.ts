export type TradeTotals = {
  pieces: number;
  packages: number;
  grossGrams: number;
  netGrams: number;
};

export type ReconciliationSummary = {
  invoice: TradeTotals;
  packing: TradeTotals;
  differences: TradeTotals;
  matched: boolean;
};

export type PackingLineType = "PRODUCT" | "ACCESSORY";

export type ExtraAccessory = {
  name: string;
  weightGrams: number;
};

export type PackingWeightInput = {
  packagesCount: number;
  packingPerPackage: number;
  unitNetWeightGrams?: number | null;
  bagWeightGrams?: number | null;
  posterWeightGrams?: number | null;
  otherAccessoryWeightGrams?: number | null;
  extraAccessories?: ExtraAccessory[] | null;
  manualWeightOverride?: boolean | number | null;
  grossWeightGrams?: number | null;
  netWeightGrams?: number | null;
};

export type CalculatedPackingWeights = {
  piecesCount: number;
  unitNetWeightGrams: number;
  bagWeightGrams: number;
  posterWeightGrams: number;
  otherAccessoryWeightGrams: number;
  unitGrossWeightGrams: number;
  formulaNetWeightGrams: number;
  formulaGrossWeightGrams: number;
  netWeightGrams: number;
  grossWeightGrams: number;
  manualWeightOverride: boolean;
};

export type ContainerSlotRef = {
  id: string;
  slotIndex: number | null;
  officialNumber: string | null;
  status?: string | null;
};

export type GroupablePackingLine = {
  containerId?: string | null;
  lineType?: PackingLineType;
  packagesCount: number;
  packingPerPackage: number;
  piecesCount?: number;
  grossWeightGrams: number;
  netWeightGrams: number;
  includePiecesInReconciliation?: boolean | number | null;
};

export type ContainerPackingGroup<T extends GroupablePackingLine = GroupablePackingLine> = {
  containerId: string | null;
  slotIndex: number | null;
  officialNumber: string | null;
  status: string | null;
  lines: T[];
  totals: {
    packagesCount: number;
    piecesCount: number;
    reconciledPiecesCount: number;
    productPiecesCount: number;
    accessoryPiecesCount: number;
    grossWeightGrams: number;
    netWeightGrams: number;
  };
};

export function packingPieces(packagesCount: number, packingPerPackage: number) {
  return packagesCount * packingPerPackage;
}

export function netAboveGross(netGrams: number, grossGrams: number) {
  return netGrams > grossGrams;
}

export function sumNumbers(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

export function parseExtraAccessories(raw: unknown): ExtraAccessory[] {
  if (!raw) return [];
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const result: ExtraAccessory[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 120) : "";
    const weight = Number(record.weightGrams);
    const weightGrams = Number.isFinite(weight) && weight >= 0 ? Math.trunc(weight) : 0;
    if (!name && weightGrams === 0) continue;
    result.push({ name: name || "Accessory", weightGrams });
  }
  return result;
}

export function calculatePackingLineWeights(input: PackingWeightInput): CalculatedPackingWeights {
  const packagesCount = Math.max(0, Math.trunc(Number(input.packagesCount) || 0));
  const packingPerPackage = Math.max(0, Math.trunc(Number(input.packingPerPackage) || 0));
  const piecesCount = packingPieces(packagesCount, packingPerPackage);
  const unitNetWeightGrams = Math.max(0, Math.trunc(Number(input.unitNetWeightGrams) || 0));
  const bagWeightGrams = Math.max(0, Math.trunc(Number(input.bagWeightGrams) || 0));
  const posterWeightGrams = Math.max(0, Math.trunc(Number(input.posterWeightGrams) || 0));
  const directOther = Math.max(0, Math.trunc(Number(input.otherAccessoryWeightGrams) || 0));
  const extraList = input.extraAccessories ?? [];
  const extraSum = sumNumbers(extraList.map((item) => Math.max(0, Math.trunc(Number(item.weightGrams) || 0))));
  const otherAccessoryWeightGrams =
    extraList.length === 0
      ? directOther
      : directOther === 0 || directOther === extraSum
        ? extraSum
        : directOther + extraSum;
  const unitGrossWeightGrams = unitNetWeightGrams + bagWeightGrams + posterWeightGrams + otherAccessoryWeightGrams;
  const formulaNetWeightGrams = piecesCount * unitNetWeightGrams;
  const formulaGrossWeightGrams = piecesCount * unitGrossWeightGrams;
  const manualWeightOverride = input.manualWeightOverride === true || input.manualWeightOverride === 1;
  const hasComponentWeights = unitNetWeightGrams > 0 || bagWeightGrams > 0 || posterWeightGrams > 0 || otherAccessoryWeightGrams > 0;
  const useFormula = !manualWeightOverride && hasComponentWeights;
  const netWeightGrams = useFormula
    ? formulaNetWeightGrams
    : Math.max(0, Math.trunc(Number(input.netWeightGrams ?? formulaNetWeightGrams) || 0));
  const grossWeightGrams = useFormula
    ? formulaGrossWeightGrams
    : Math.max(0, Math.trunc(Number(input.grossWeightGrams ?? formulaGrossWeightGrams) || 0));
  return {
    piecesCount,
    unitNetWeightGrams,
    bagWeightGrams,
    posterWeightGrams,
    otherAccessoryWeightGrams,
    unitGrossWeightGrams,
    formulaNetWeightGrams,
    formulaGrossWeightGrams,
    netWeightGrams,
    grossWeightGrams,
    manualWeightOverride,
  };
}

export function shouldIncludePiecesInReconciliation(
  lineType?: PackingLineType | string | null,
  explicitFlag?: boolean | number | null,
): boolean {
  if (explicitFlag === true || explicitFlag === 1) return true;
  if (explicitFlag === false || explicitFlag === 0) return false;
  return lineType !== "ACCESSORY";
}

export function groupPackingByContainer<T extends GroupablePackingLine>(
  containers: ContainerSlotRef[],
  lines: T[],
): ContainerPackingGroup<T>[] {
  const activeContainers = containers.filter((c) => c.status !== "CANCELLED");
  const groups = new Map<string, ContainerPackingGroup<T>>();
  for (const container of activeContainers) {
    groups.set(container.id, {
      containerId: container.id,
      slotIndex: container.slotIndex ?? null,
      officialNumber: container.officialNumber ?? null,
      status: container.status ?? null,
      lines: [],
      totals: {
        packagesCount: 0,
        piecesCount: 0,
        reconciledPiecesCount: 0,
        productPiecesCount: 0,
        accessoryPiecesCount: 0,
        grossWeightGrams: 0,
        netWeightGrams: 0,
      },
    });
  }
  const unassigned: ContainerPackingGroup<T> = {
    containerId: null,
    slotIndex: null,
    officialNumber: null,
    status: null,
    lines: [],
    totals: {
      packagesCount: 0,
      piecesCount: 0,
      reconciledPiecesCount: 0,
      productPiecesCount: 0,
      accessoryPiecesCount: 0,
      grossWeightGrams: 0,
      netWeightGrams: 0,
    },
  };
  for (const line of lines) {
    const target = (line.containerId && groups.get(line.containerId)) || unassigned;
    target.lines.push(line);
    const pieces = line.piecesCount ?? packingPieces(line.packagesCount, line.packingPerPackage);
    const isAccessory = line.lineType === "ACCESSORY";
    const includePieces = shouldIncludePiecesInReconciliation(line.lineType, line.includePiecesInReconciliation);
    target.totals.packagesCount += Number(line.packagesCount) || 0;
    target.totals.piecesCount += pieces;
    if (includePieces) target.totals.reconciledPiecesCount += pieces;
    if (isAccessory) target.totals.accessoryPiecesCount += pieces;
    else target.totals.productPiecesCount += pieces;
    target.totals.grossWeightGrams += Number(line.grossWeightGrams) || 0;
    target.totals.netWeightGrams += Number(line.netWeightGrams) || 0;
  }
  const ordered = Array.from(groups.values());
  if (unassigned.lines.length > 0 || ordered.length === 0) {
    ordered.push(unassigned);
  }
  return ordered;
}

export function reconcileTradeTotals(invoice: TradeTotals, packing: TradeTotals): ReconciliationSummary {
  const differences = {
    pieces: invoice.pieces - packing.pieces,
    packages: invoice.packages - packing.packages,
    grossGrams: invoice.grossGrams - packing.grossGrams,
    netGrams: invoice.netGrams - packing.netGrams,
  };
  const matched = differences.pieces === 0 && differences.packages === 0 && differences.grossGrams === 0 && differences.netGrams === 0;
  return { invoice, packing, differences, matched };
}
