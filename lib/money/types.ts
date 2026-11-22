import type { Cents } from "./cents";
import type { MoneyKind } from "./categories";
import type { ISODate } from "./dates";

export type MoneyEntry = {
  id: string;
  kind: MoneyKind;
  date: ISODate;
  categoryId: string;
  party: string;
  description: string;
  totalCents: Cents;
  gstCents: Cents;
  qstCents: Cents;
  /** Amount before taxes: totalCents - gstCents - qstCents. */
  netCents: Cents;
  taxesIncluded: boolean;
  paymentMethod: string | null;
  paid: boolean;
  paidOn: ISODate | null;
  receiptPath: string | null;
  recurringId: string | null;
  occurrenceDate: ISODate | null;
  source: "manual" | "recurring" | "import";
  importKey: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
};

export type MoneyCategory = {
  id: string;
  kind: MoneyKind;
  en: string;
  fr: string;
  icon: string;
  sortOrder: number;
  needsReceipt: boolean;
  taxable: boolean;
  active: boolean;
};

export type MoneySettings = {
  fiscalYearStartMonth: number; // 1-12
  taxFrequency: "monthly" | "quarterly" | "yearly";
  setupCompletedAt: string | null;
  gstNumber: string;
  qstNumber: string;
};

export type DateRange = { start: ISODate; end: ISODate };

export const DEFAULT_SETTINGS: MoneySettings = {
  fiscalYearStartMonth: 1,
  taxFrequency: "quarterly",
  setupCompletedAt: null,
  gstNumber: "",
  qstNumber: "",
};

/** The date money actually moved (cash basis): when it was paid, or the entry date. */
export function cashDate(entry: Pick<MoneyEntry, "paidOn" | "date">): ISODate {
  return entry.paidOn ?? entry.date;
}
