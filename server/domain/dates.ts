import type { DayPolicy } from "../../shared/enums";

export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

export function toIsoUtc(date: Date): string {
  return date.toISOString();
}

export function dateOnlyInZone(isoOrDate: string | Date, timeZone: string): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function parseDateOnly(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_DATE");
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function addCalendarDays(dateOnly: string, days: number): string {
  const { y, m, d } = parseDateOnly(dateOnly);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function isWeekend(dateOnly: string): boolean {
  const { y, m, d } = parseDateOnly(dateOnly);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 5 || day === 6;
}

export function addBusinessDays(dateOnly: string, days: number): string {
  let cursor = dateOnly;
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, step);
    if (!isWeekend(cursor)) remaining -= 1;
  }
  return cursor;
}

export function addOffset(input: {
  dateOnly: string;
  direction: "BEFORE" | "AFTER";
  amount: number;
  unit: "HOURS" | "DAYS";
  policy: DayPolicy;
  timeZone: string;
  now?: Date;
}): Date {
  if (input.unit === "HOURS") {
    const signed = input.direction === "BEFORE" ? -input.amount : input.amount;
    const { y, m, d } = parseDateOnly(input.dateOnly);
    return new Date(Date.UTC(y, m - 1, d) + signed * 60 * 60 * 1000);
  }
  const signed = input.direction === "BEFORE" ? -input.amount : input.amount;
  const next =
    input.policy === "BUSINESS"
      ? addBusinessDays(input.dateOnly, signed)
      : addCalendarDays(input.dateOnly, signed);
  const { y, m, d } = parseDateOnly(next);
  return new Date(Date.UTC(y, m - 1, d, 8, 0, 0));
}

export function zonedStartOfDayUtc(dateOnly: string, _timeZone: string): Date {
  const { y, m, d } = parseDateOnly(dateOnly);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}
