// Totals and results, computed exactly like the spreadsheet (amounts before GST/QST, paid & unpaid,
// by entry date). Every total is a sum of integer cents.
import { ratio, type Cents } from "./cents";
import { PARTS_PURCHASES_ID, PARTS_SALES_ID } from "./categories";
import { inRange } from "./dates";
import { cashDate, type DateRange, type MoneyEntry } from "./types";

export type Summary = {
  byCategory: Record<string, Cents>;
  incomeCents: Cents;
  expenseCents: Cents;
  /** "What I kept" = Net profit (before tax) = Total income − Total expenses. */
  profitCents: Cents;
  gstCollectedCents: Cents;
  qstCollectedCents: Cents;
  gstPaidCents: Cents;
  qstPaidCents: Cents;
  count: number;
};

export type Results = {
  profitCents: Cents;
  /** Net profit ÷ Total income (null when income is 0, like the sheet's IF(..=0,"")). */
  profitMargin: number | null;
  /** (Parts sales − Parts purchases) ÷ Parts sales. */
  partsMargin: number | null;
  /** Total expenses ÷ Total income. */
  expensesShare: number | null;
  /** (Income − previous income) ÷ previous income. */
  incomeGrowth: number | null;
};

export function emptySummary(): Summary {
  return { byCategory: {}, incomeCents: 0, expenseCents: 0, profitCents: 0, gstCollectedCents: 0, qstCollectedCents: 0, gstPaidCents: 0, qstPaidCents: 0, count: 0 };
}

export function addToSummary(summary: Summary, entry: MoneyEntry): void {
  summary.byCategory[entry.categoryId] = (summary.byCategory[entry.categoryId] ?? 0) + entry.netCents;
  if (entry.kind === "in") {
    summary.incomeCents += entry.netCents;
    summary.gstCollectedCents += entry.gstCents;
    summary.qstCollectedCents += entry.qstCents;
  } else {
    summary.expenseCents += entry.netCents;
    summary.gstPaidCents += entry.gstCents;
    summary.qstPaidCents += entry.qstCents;
  }
  summary.profitCents = summary.incomeCents - summary.expenseCents;
  summary.count += 1;
}

export function isLive(entry: MoneyEntry): boolean {
  return !entry.deletedAt;
}

export function summarize(entries: MoneyEntry[], range: DateRange): Summary {
  const summary = emptySummary();
  for (const entry of entries) if (isLive(entry) && inRange(entry.date, range.start, range.end)) addToSummary(summary, entry);
  return summary;
}

export function results(summary: Summary, previousIncomeCents?: Cents | null): Results {
  const partsSales = summary.byCategory[PARTS_SALES_ID] ?? 0;
  const partsPurchases = summary.byCategory[PARTS_PURCHASES_ID] ?? 0;
  return {
    profitCents: summary.profitCents,
    profitMargin: ratio(summary.profitCents, summary.incomeCents),
    partsMargin: ratio(partsSales - partsPurchases, partsSales),
    expensesShare: ratio(summary.expenseCents, summary.incomeCents),
    incomeGrowth: previousIncomeCents === undefined || previousIncomeCents === null ? null : ratio(summary.incomeCents - previousIncomeCents, previousIncomeCents),
  };
}

/** % change for the ↑/↓ badges. null when there is nothing to compare with. */
export function change(current: Cents, previous: Cents): number | null {
  return ratio(current - previous, Math.abs(previous));
}

export type StatementColumn = DateRange & { key: string };
export type Statement = {
  columns: StatementColumn[];
  cells: Record<string, Summary>; // by column key
  total: Summary; // the "Year" column = sum of the columns
  results: Record<string, Results>;
  totalResults: Results;
};

/** The spreadsheet layout: one Summary per column (months or quarters) + a Year column. */
export function statement(entries: MoneyEntry[], columns: StatementColumn[], previousOfFirstIncome?: Cents | null): Statement {
  const cells: Record<string, Summary> = {};
  for (const column of columns) cells[column.key] = emptySummary();
  for (const entry of entries) {
    if (!isLive(entry)) continue;
    const column = columns.find((c) => inRange(entry.date, c.start, c.end));
    if (column) addToSummary(cells[column.key], entry);
  }
  const total = emptySummary();
  for (const column of columns) mergeInto(total, cells[column.key]);
  const res: Record<string, Results> = {};
  columns.forEach((column, index) => {
    const previous = index === 0 ? previousOfFirstIncome : cells[columns[index - 1].key].incomeCents;
    res[column.key] = results(cells[column.key], index === 0 ? (previous ?? null) : previous);
  });
  return { columns, cells, total, results: res, totalResults: results(total) };
}

export function mergeInto(target: Summary, source: Summary): void {
  for (const [id, cents] of Object.entries(source.byCategory)) target.byCategory[id] = (target.byCategory[id] ?? 0) + cents;
  target.incomeCents += source.incomeCents;
  target.expenseCents += source.expenseCents;
  target.profitCents = target.incomeCents - target.expenseCents;
  target.gstCollectedCents += source.gstCollectedCents;
  target.qstCollectedCents += source.qstCollectedCents;
  target.gstPaidCents += source.gstPaidCents;
  target.qstPaidCents += source.qstPaidCents;
  target.count += source.count;
}

export type CashFlowPoint = { key: string; inflowCents: Cents; outflowCents: Cents; netCents: Cents };

/** Cash basis (paid only, taxes included, by the day it was paid) — like Wave's cash-flow card. */
export function cashFlow(entries: MoneyEntry[], months: Array<DateRange & { key: string }>): CashFlowPoint[] {
  return months.map((month) => {
    let inflow = 0;
    let outflow = 0;
    for (const entry of entries) {
      if (!isLive(entry) || !entry.paid) continue;
      const date = cashDate(entry);
      if (!inRange(date, month.start, month.end)) continue;
      if (entry.kind === "in") inflow += entry.totalCents;
      else outflow += entry.totalCents;
    }
    return { key: month.key, inflowCents: inflow, outflowCents: outflow, netCents: inflow - outflow };
  });
}

/** Money that actually moved in a range, taxes included (for the bank check). */
export function cashNet(entries: MoneyEntry[], range: DateRange): Cents {
  let net = 0;
  for (const entry of entries) {
    if (!isLive(entry) || !entry.paid) continue;
    if (!inRange(cashDate(entry), range.start, range.end)) continue;
    net += entry.kind === "in" ? entry.totalCents : -entry.totalCents;
  }
  return net;
}

/** Sales taxes for a period: collected on money in, minus paid on money out (input tax credits). */
export function taxesOwed(summary: Summary) {
  const gst = summary.gstCollectedCents - summary.gstPaidCents;
  const qst = summary.qstCollectedCents - summary.qstPaidCents;
  return { gstCents: gst, qstCents: qst, totalCents: gst + qst };
}

export type PartyTotal = { party: string; cents: Cents; count: number };

export function topParties(entries: MoneyEntry[], range: DateRange, kind: "in" | "out", limit = 10): PartyTotal[] {
  const map = new Map<string, PartyTotal>();
  for (const entry of entries) {
    if (!isLive(entry) || entry.kind !== kind || !inRange(entry.date, range.start, range.end)) continue;
    const name = entry.party.trim() || "—";
    const key = name.toLowerCase();
    const current = map.get(key) ?? { party: name, cents: 0, count: 0 };
    current.cents += entry.netCents;
    current.count += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.cents - a.cents).slice(0, limit);
}
