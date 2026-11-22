// Calendar helpers on plain "YYYY-MM-DD" strings (no time zones, no Date arithmetic surprises).
export type ISODate = string;

export function toISO(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseISO(date: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseISO(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(date: ISODate, days: number): ISODate {
  const { year, month, day } = parseISO(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Adds months, keeping the day but clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: ISODate, months: number, wantedDay?: number): ISODate {
  const { year, month, day } = parseISO(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return toISO(y, m, Math.min(wantedDay ?? day, daysInMonth(y, m)));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

export function monthStart(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: ISODate): ISODate {
  const { year, month } = parseISO(date);
  return toISO(year, month, daysInMonth(year, month));
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function inRange(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
};
const MONTHS_LONG = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};

export function monthLabel(month: number, lang: "en" | "fr", long = false): string {
  return (long ? MONTHS_LONG : MONTHS)[lang][month - 1];
}

export function formatDate(date: ISODate, lang: "en" | "fr", options: { weekday?: boolean; year?: boolean } = {}): string {
  const { year, month, day } = parseISO(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", {
    timeZone: "UTC",
    weekday: options.weekday ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: options.year === false ? undefined : "numeric",
  });
}
