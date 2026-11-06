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

const COMPANY_TIME_ZONE = "Africa/Cairo";

/** Wall-clock offset of `timeZone` at `instant`: local time minus UTC, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  let hour = value("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), hour, value("minute"), value("second"));
  return asUtc - instant.getTime();
}

export function zonedStartOfDayUtc(dateOnly: string, timeZone: string): Date {
  const zone = timeZone || COMPANY_TIME_ZONE;
  const { y, m, d } = parseDateOnly(dateOnly);
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = utcMidnight - zoneOffsetMs(new Date(utcMidnight), zone);
  const adjusted = utcMidnight - zoneOffsetMs(new Date(utc), zone);
  if (adjusted !== utc) utc = adjusted;
  return new Date(utc);
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
  const zone = input.timeZone || COMPANY_TIME_ZONE;
  if (input.unit === "HOURS") {
    const signed = input.direction === "BEFORE" ? -input.amount : input.amount;
    return new Date(zonedStartOfDayUtc(input.dateOnly, zone).getTime() + signed * 60 * 60 * 1000);
  }
  const signed = input.direction === "BEFORE" ? -input.amount : input.amount;
  const next =
    input.policy === "BUSINESS"
      ? addBusinessDays(input.dateOnly, signed)
      : addCalendarDays(input.dateOnly, signed);
  // 08:00 in the company zone, so a day offset stays on that civil day.
  return new Date(zonedStartOfDayUtc(next, zone).getTime() + 8 * 60 * 60 * 1000);
}
