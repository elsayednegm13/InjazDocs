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

export function packingPieces(packagesCount: number, packingPerPackage: number) {
  return packagesCount * packingPerPackage;
}

export function netAboveGross(netGrams: number, grossGrams: number) {
  return netGrams > grossGrams;
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

export function sumNumbers(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}
