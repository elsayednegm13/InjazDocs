import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(minor: number | string, decimals: number, currency: string) {
  const value = Number(minor) / 10 ** decimals;
  return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: decimals }).format(value);
}

export function gramsLabel(grams: number) {
  if (grams >= 1_000_000) return `${(grams / 1_000_000).toFixed(3)} t`;
  return `${(grams / 1000).toFixed(3)} kg`;
}
