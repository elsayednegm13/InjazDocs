export type MoneyMinor = {
  minorUnits: bigint;
  currency: string;
  decimals: number;
};

const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  EGP: 2,
  AED: 2,
  SAR: 2,
  JPY: 0,
  KWD: 3,
};

export function currencyDecimals(code: string): number {
  return CURRENCY_DECIMALS[code.toUpperCase()] ?? 2;
}

export function parseDecimalToMinor(value: string, currency: string): MoneyMinor {
  const decimals = currencyDecimals(currency);
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("INVALID_DECIMAL");
  }
  const negative = trimmed.startsWith("-");
  const [wholeRaw, fracRaw = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  if (fracRaw.length > decimals) {
    throw new Error("TOO_MANY_FRACTION_DIGITS");
  }
  const frac = fracRaw.padEnd(decimals, "0");
  const minor = BigInt(wholeRaw || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
  return {
    minorUnits: negative ? -minor : minor,
    currency: currency.toUpperCase(),
    decimals,
  };
}

export function minorToDecimalString(minorUnits: bigint | number | string, decimals: number): string {
  const value = BigInt(minorUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, "0");
  const body = decimals === 0 ? whole.toString() : `${whole.toString()}.${fracStr}`;
  return negative ? `-${body}` : body;
}

export function assertNonNegativeMinor(minorUnits: bigint | number, field: string): void {
  if (BigInt(minorUnits) < 0n) {
    throw new Error(`NEGATIVE_${field}`);
  }
}

export function sameCurrency(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}
