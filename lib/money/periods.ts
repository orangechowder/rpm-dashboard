import { addDays, addMonths, daysBetween, monthEnd, monthLabel, parseISO, toISO, daysInMonth, type ISODate } from "./dates";
import type { DateRange, MoneySettings } from "./types";

export type PeriodPreset = "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "last12" | "custom";
export const PERIOD_PRESETS: PeriodPreset[] = ["thisMonth", "lastMonth", "thisQuarter", "thisYear", "last12", "custom"];

/** First day of the fiscal year that contains `date`. */
export function fiscalYearStart(date: ISODate, startMonth: number): ISODate {
  const { year, month } = parseISO(date);
  return toISO(month >= startMonth ? year : year - 1, startMonth, 1);
}

export function fiscalYearRange(date: ISODate, startMonth: number): DateRange {
  const start = fiscalYearStart(date, startMonth);
  return { start, end: addDays(addMonths(start, 12), -1) };
}

/** The fiscal year that starts in `startYear` (e.g. 2026 → Jan–Dec 2026, or Apr 2026–Mar 2027). */
export function fiscalYearByStartYear(startYear: number, startMonth: number): DateRange {
  const start = toISO(startYear, startMonth, 1);
  return { start, end: addDays(addMonths(start, 12), -1) };
}

export function fiscalYearLabel(range: DateRange): string {
  const a = range.start.slice(0, 4);
  const b = range.end.slice(0, 4);
  return a === b ? a : `${a}–${b.slice(2)}`;
}

/** The 12 month ranges of a fiscal year, in order. */
export function fiscalMonths(year: DateRange): Array<DateRange & { key: string; month: number }> {
  return Array.from({ length: 12 }, (_, index) => {
    const start = addMonths(year.start, index, 1);
    const { month } = parseISO(start);
    return { key: start.slice(0, 7), month, start, end: monthEnd(start) };
  });
}

/** Q1–Q4 of a fiscal year (Q1 = its first 3 months). */
export function fiscalQuarters(year: DateRange): Array<DateRange & { key: string; index: number }> {
  return [0, 1, 2, 3].map((index) => {
    const start = addMonths(year.start, index * 3, 1);
    return { key: `Q${index + 1}`, index, start, end: addDays(addMonths(start, 3), -1) };
  });
}

export function quarterRange(date: ISODate, startMonth: number): DateRange {
  const year = fiscalYearRange(date, startMonth);
  const q = fiscalQuarters(year).find((candidate) => date >= candidate.start && date <= candidate.end)!;
  return { start: q.start, end: q.end };
}

export function presetRange(preset: Exclude<PeriodPreset, "custom">, today: ISODate, settings: Pick<MoneySettings, "fiscalYearStartMonth">): DateRange {
  const start = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "thisMonth": return { start, end: monthEnd(today) };
    case "lastMonth": { const s = addMonths(start, -1, 1); return { start: s, end: monthEnd(s) }; }
    case "thisQuarter": return quarterRange(today, settings.fiscalYearStartMonth);
    case "thisYear": return fiscalYearRange(today, settings.fiscalYearStartMonth);
    case "last12": return { start: addMonths(start, -11, 1), end: monthEnd(today) };
  }
}

/** The comparable period just before: previous month / quarter / year, or the same number of days before. */
export function previousRange(range: DateRange): DateRange {
  const s = parseISO(range.start);
  const e = parseISO(range.end);
  const wholeMonths = s.day === 1 && e.day === daysInMonth(e.year, e.month);
  if (wholeMonths) {
    const months = (e.year - s.year) * 12 + (e.month - s.month) + 1;
    const start = addMonths(range.start, -months, 1);
    return { start, end: addDays(range.start, -1) };
  }
  const length = daysBetween(range.start, range.end) + 1;
  return { start: addDays(range.start, -length), end: addDays(range.start, -1) };
}

/** Same period one year earlier (for "this year vs last year"). */
export function sameRangeLastYear(range: DateRange): DateRange {
  return { start: addMonths(range.start, -12), end: addMonths(range.end, -12) };
}

/** Month ranges covering a period (for monthly charts). */
export function monthsIn(range: DateRange): Array<DateRange & { key: string; label: (lang: "en" | "fr") => string }> {
  const out: Array<DateRange & { key: string; label: (lang: "en" | "fr") => string }> = [];
  let cursor = `${range.start.slice(0, 7)}-01`;
  while (cursor <= range.end) {
    const { year, month } = parseISO(cursor);
    const start = cursor < range.start ? range.start : cursor;
    const end = monthEnd(cursor) > range.end ? range.end : monthEnd(cursor);
    out.push({ key: cursor.slice(0, 7), start, end, label: (lang) => `${monthLabel(month, lang)} '${String(year).slice(2)}` });
    cursor = addMonths(cursor, 1, 1);
  }
  return out;
}

// ---------- Sales-tax filing periods (GST/QST, filed together with Revenu Québec) ----------
export type TaxPeriod = DateRange & { dueDate: ISODate };

export function taxPeriodFor(date: ISODate, settings: Pick<MoneySettings, "taxFrequency" | "fiscalYearStartMonth">): TaxPeriod {
  let range: DateRange;
  if (settings.taxFrequency === "monthly") range = { start: `${date.slice(0, 7)}-01`, end: monthEnd(date) };
  else if (settings.taxFrequency === "quarterly") range = quarterRange(date, settings.fiscalYearStartMonth);
  else range = fiscalYearRange(date, settings.fiscalYearStartMonth);
  return { ...range, dueDate: taxDueDate(range, settings.taxFrequency) };
}

/** Monthly/quarterly: end of the month after the period. Yearly: 3 months after the year ends. */
export function taxDueDate(range: DateRange, frequency: MoneySettings["taxFrequency"]): ISODate {
  const firstOfNextMonth = addDays(range.end, 1);
  return monthEnd(addMonths(firstOfNextMonth, frequency === "yearly" ? 2 : 0, 1));
}

export function previousTaxPeriod(period: TaxPeriod, settings: Pick<MoneySettings, "taxFrequency" | "fiscalYearStartMonth">): TaxPeriod {
  return taxPeriodFor(addDays(period.start, -1), settings);
}
