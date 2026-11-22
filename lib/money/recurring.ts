// Bills that repeat. Pure date logic: which occurrences are due, catching up if the app wasn't opened,
// never producing a date twice (the database also has a unique (recurring_id, occurrence_date) key).
import type { Cents } from "./cents";
import type { MoneyKind } from "./categories";
import { addDays, addMonths, monthKey, parseISO, type ISODate } from "./dates";

export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export const FREQUENCIES: Frequency[] = ["weekly", "biweekly", "monthly", "quarterly", "yearly"];

export type RecurringRule = {
  id: string;
  name: string;
  kind: MoneyKind;
  categoryId: string;
  party: string;
  amountCents: Cents;
  taxesIncluded: boolean;
  frequency: Frequency;
  /** First occurrence; monthly/quarterly/yearly keep its day (31 → last day of shorter months). */
  startDate: ISODate;
  endDate: ISODate | null;
  paused: boolean;
  autoPaid: boolean;
  paymentMethod: string | null;
  skippedDates: ISODate[];
  deletedAt: string | null;
};

const MAX_OCCURRENCES = 1000;

/** All scheduled dates from the start up to `until` (inclusive), ignoring pause/skip. */
export function scheduledDates(rule: Pick<RecurringRule, "frequency" | "startDate" | "endDate">, until: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const startDay = parseISO(rule.startDate).day;
  const last = rule.endDate && rule.endDate < until ? rule.endDate : until;
  for (let index = 0; index < MAX_OCCURRENCES; index += 1) {
    const date = nthDate(rule.frequency, rule.startDate, startDay, index);
    if (date > last) break;
    out.push(date);
  }
  return out;
}

function nthDate(frequency: Frequency, start: ISODate, startDay: number, index: number): ISODate {
  switch (frequency) {
    case "weekly": return addDays(start, index * 7);
    case "biweekly": return addDays(start, index * 14);
    case "monthly": return addMonths(start, index, startDay);
    case "quarterly": return addMonths(start, index * 3, startDay);
    case "yearly": return addMonths(start, index * 12, startDay);
  }
}

/**
 * Occurrences that should exist by `today` but don't yet: the catch-up list.
 * Skipped dates, paused/deleted rules and closed (locked) months are left out.
 */
export function pendingOccurrences(rule: RecurringRule, existingDates: Iterable<ISODate>, today: ISODate, lockedMonths: Set<string> = new Set()): ISODate[] {
  if (rule.paused || rule.deletedAt || rule.amountCents <= 0) return [];
  const existing = new Set(existingDates);
  const skipped = new Set(rule.skippedDates);
  return scheduledDates(rule, today).filter((date) => !existing.has(date) && !skipped.has(date) && !lockedMonths.has(monthKey(date)));
}

/** The next scheduled date on or after `from` (null if the bill has ended). */
export function nextOccurrence(rule: Pick<RecurringRule, "frequency" | "startDate" | "endDate" | "skippedDates" | "paused">, from: ISODate): ISODate | null {
  if (rule.paused) return null;
  const skipped = new Set(rule.skippedDates);
  const startDay = parseISO(rule.startDate).day;
  for (let index = 0; index < MAX_OCCURRENCES * 5; index += 1) {
    const date = nthDate(rule.frequency, rule.startDate, startDay, index);
    if (rule.endDate && date > rule.endDate) return null;
    if (date >= from && !skipped.has(date)) return date;
  }
  return null;
}

/** When a paused bill is resumed, the dates it missed while paused are skipped (not back-filled). */
export function datesToSkipOnResume(rule: Pick<RecurringRule, "frequency" | "startDate" | "endDate">, pausedOn: ISODate, resumedOn: ISODate): ISODate[] {
  return scheduledDates(rule, addDays(resumedOn, -1)).filter((date) => date >= pausedOn);
}

/** Rough monthly cost (for the bills list header). Display only. */
export function monthlyEquivalentCents(rule: Pick<RecurringRule, "frequency" | "amountCents">): Cents {
  switch (rule.frequency) {
    case "weekly": return Math.round((rule.amountCents * 52) / 12);
    case "biweekly": return Math.round((rule.amountCents * 26) / 12);
    case "monthly": return rule.amountCents;
    case "quarterly": return Math.round(rule.amountCents / 3);
    case "yearly": return Math.round(rule.amountCents / 12);
  }
}
