export type WeightUnit = "G" | "KG" | "T";

export const GRAMS_PER: Record<WeightUnit, number> = {
  G: 1,
  KG: 1000,
  T: 1_000_000,
};

export function toGrams(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("INVALID_WEIGHT");
  }
  return Math.round(value * GRAMS_PER[unit]);
}

export function fromGrams(grams: number, unit: WeightUnit): number {
  return grams / GRAMS_PER[unit];
}

export function assertGrossGteNet(grossGrams: number, netGrams: number): void {
  if (grossGrams < 0 || netGrams < 0) {
    throw new Error("NEGATIVE_WEIGHT");
  }
  if (grossGrams < netGrams) {
    throw new Error("GROSS_LT_NET");
  }
}
