import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/spreadsheet-sample.json";
import { divRound, formatMoney, formatPercent, parseMoney } from "./cents";
import { DEFAULT_CATEGORIES } from "./categories";
import { addMonths } from "./dates";
import { addTaxes, gstOn, manualTaxes, qstOn, splitTaxesIncluded } from "./tax";
import { cashFlow, cashNet, results, statement, summarize, taxesOwed } from "./summary";
import { fiscalMonths, fiscalQuarters, fiscalYearByStartYear, fiscalYearRange, monthsIn, presetRange, previousRange, taxDueDate, taxPeriodFor } from "./periods";
import { datesToSkipOnResume, nextOccurrence, pendingOccurrences, scheduledDates, type RecurringRule } from "./recurring";
import { checkDuplicates, guessParty, importKeys, normalizeText, similarity, suggestCategory, type ImportRow } from "./matching";
import { needsAttention, quietMonths, realProfit, summarySentence } from "./insights";
import { detectDateFormat, guessMapping, parseDate, readRows } from "./csv";
import type { MoneyCategory, MoneyEntry } from "./types";

let seq = 0;
function entry(partial: Partial<MoneyEntry> & Pick<MoneyEntry, "kind" | "date" | "categoryId" | "totalCents">): MoneyEntry {
  const gst = partial.gstCents ?? 0;
  const qst = partial.qstCents ?? 0;
  seq += 1;
  return {
    id: partial.id ?? `e${seq}`,
    party: "", description: "", taxesIncluded: false, paymentMethod: null, paid: true, paidOn: null, receiptPath: null, receiptRef: "",
    recurringId: null, occurrenceDate: null, source: "manual", importKey: null, createdBy: "Marc", createdAt: "", updatedBy: null,
    updatedAt: "", deletedAt: null, deletedBy: null,
    ...partial,
    gstCents: gst, qstCents: qst, netCents: partial.totalCents - gst - qst,
  };
}

const categories: MoneyCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({ id: c.id, kind: c.kind, en: c.en, fr: c.fr, icon: c.icon, sortOrder: i, needsReceipt: c.needsReceipt, taxable: c.taxable, taxMode: c.taxable ? "gst_qst" as const : "none" as const, active: true }));

describe("cents", () => {
  it("parses what people type, without floats", () => {
    expect(parseMoney("1234.56")).toBe(123456);
    expect(parseMoney("1,234.56")).toBe(123456);
    expect(parseMoney("1 234,56")).toBe(123456);
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("$12")).toBe(1200);
    expect(parseMoney("12,5")).toBe(1250);
    expect(parseMoney(".05")).toBe(5);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("1,234")).toBe(123400);
    expect(parseMoney("-4.10")).toBe(-410);
    expect(parseMoney("(4.10)")).toBe(-410);
    expect(parseMoney("19.99")).toBe(1999); // 19.99*100 = 1998.9999… as a float
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("1.2.3,4.5")).toBeNull();
  });
  it("formats $1,234.56 and 1 234,56 $", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-5)).toBe("−$0.05");
    expect(formatMoney(100000000)).toBe("$1,000,000.00");
    expect(formatMoney(123456, "fr")).toBe("1 234,56 $");
    expect(formatPercent(0.18)).toBe("18.0%");
    expect(formatPercent(null)).toBe("—");
  });
  it("rounds half away from zero", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 2)).toBe(2);
  });
});

describe("GST 5% + QST 9.975%", () => {
  it("adds taxes to an amount before taxes", () => {
    expect(addTaxes(10000)).toEqual({ netCents: 10000, gstCents: 500, qstCents: 998, totalCents: 11498 });
    expect(gstOn(1)).toBe(0);
    expect(qstOn(10)).toBe(1); // 0.9975 → 1
  });
  it("splits a total paid, taxes included", () => {
    expect(splitTaxesIncluded(11498)).toEqual({ netCents: 10000, gstCents: 500, qstCents: 998, totalCents: 11498 });
    expect(splitTaxesIncluded(0)).toEqual({ netCents: 0, gstCents: 0, qstCents: 0, totalCents: 0 });
  });
  it("always adds up exactly and stays within a cent of the true rates (every total from $0.01 to $2,000)", () => {
    for (let total = 1; total <= 200000; total += 1) {
      const split = splitTaxesIncluded(total);
      expect(split.netCents + split.gstCents + split.qstCents).toBe(total);
      expect(Math.abs(split.gstCents * 100 - split.netCents * 5)).toBeLessThanOrEqual(100 + 5);
      expect(Math.abs(split.qstCents * 100000 - split.netCents * 9975)).toBeLessThanOrEqual(100000 + 9975);
    }
  });
  it("round-trips: adding taxes then splitting gives the same line", () => {
    for (let net = 1; net <= 50000; net += 7) expect(splitTaxesIncluded(addTaxes(net).totalCents)).toEqual(addTaxes(net));
  });
  it("accepts receipt taxes typed by hand only when they make sense", () => {
    expect(manualTaxes(11500, 500, 1000)).toEqual({ netCents: 10000, gstCents: 500, qstCents: 1000, totalCents: 11500 });
    expect(manualTaxes(100, 80, 30)).toBeNull();
    expect(manualTaxes(100, -1, 0)).toBeNull();
  });
});

describe("matches the spreadsheet (its own formulas, sample data)", () => {
  // Build entries from the exact numbers typed into the sheet's yellow cells.
  const rowToCategory: Record<string, string> = {};
  const labels = fixture.rowLabels as Record<string, string>;
  for (const [row, label] of Object.entries(labels)) {
    const category = DEFAULT_CATEGORIES.find((c) => c.en === label);
    if (!category) throw new Error(`No category for spreadsheet row "${label}"`);
    rowToCategory[row] = category.id;
  }
  const letters = "BCDEFGHIJKLM".split("");
  const entries: MoneyEntry[] = [];
  for (const [cell, cents] of Object.entries(fixture.sample as Record<string, number>)) {
    const column = cell.match(/^[A-Z]+/)![0];
    const row = cell.slice(column.length);
    const month = letters.indexOf(column) + 1;
    const categoryId = rowToCategory[row];
    const kind = DEFAULT_CATEGORIES.find((c) => c.id === categoryId)!.kind;
    // Split each cell into 2 entries with taxes, so the test also proves taxes never leak into totals.
    const half = Math.floor(cents / 2);
    const withTax = addTaxes(half);
    entries.push(entry({ kind, categoryId, date: `2026-${String(month).padStart(2, "0")}-03`, totalCents: withTax.totalCents, gstCents: withTax.gstCents, qstCents: withTax.qstCents }));
    entries.push(entry({ kind, categoryId, date: `2026-${String(month).padStart(2, "0")}-28`, totalCents: cents - half }));
  }
  // Noise that must not count: deleted, and outside the year.
  entries.push(entry({ kind: "in", categoryId: "labour_revenue", date: "2026-03-10", totalCents: 999999, deletedAt: "2026-03-11T00:00:00Z" }));
  entries.push(entry({ kind: "in", categoryId: "labour_revenue", date: "2025-12-31", totalCents: 777777 }));

  it("has the same 4 income and 17 expense lines, in the same order", () => {
    expect(Object.values(labels)).toEqual(DEFAULT_CATEGORIES.map((c) => c.en));
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === "in")).toHaveLength(4);
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === "out")).toHaveLength(17);
  });

  const year = fiscalYearByStartYear(2026, 1);
  const monthly = statement(entries, fiscalMonths(year));
  const quarterly = statement(entries, fiscalQuarters(year));
  type Expected = { totalIncome: number; totalExpenses: number; profit: number; profitMargin: number | null; partsMargin: number | null; expensesShare: number | null; growth: number | null; rows: Record<string, number | null> };
  const check = (got: ReturnType<typeof statement>, key: string | null, expected: Expected, withGrowth: boolean) => {
    const cell = key ? got.cells[key] : got.total;
    const res = key ? got.results[key] : got.totalResults;
    expect(cell.incomeCents).toBe(expected.totalIncome);
    expect(cell.expenseCents).toBe(expected.totalExpenses);
    expect(res.profitCents).toBe(expected.profit);
    for (const [row, cents] of Object.entries(expected.rows)) expect(cell.byCategory[rowToCategory[row]] ?? 0).toBe(cents ?? 0);
    const close = (a: number | null, b: number | null) => (a === null || b === null ? expect(a).toBe(b) : expect(a).toBeCloseTo(b, 12));
    close(res.profitMargin, expected.profitMargin);
    close(res.partsMargin, expected.partsMargin);
    close(res.expensesShare, expected.expensesShare);
    if (withGrowth) close(res.incomeGrowth, expected.growth);
  };
  it("every month column (Jan–Dec), including growth vs previous month", () => {
    const months = fiscalMonths(year);
    letters.forEach((letter, index) => check(monthly, months[index].key, (fixture.monthly as Record<string, Expected>)[letter], true));
  });
  it("the Year column", () => check(monthly, null, (fixture.monthly as Record<string, Expected>).N, false));
  it("every quarter column (Q1–Q4) and its Year", () => {
    ["B", "C", "D", "E"].forEach((letter, index) => check(quarterly, `Q${index + 1}`, (fixture.quarterly as Record<string, Expected>)[letter], true));
    check(quarterly, null, (fixture.quarterly as Record<string, Expected>).F, false);
  });
  it("quarters are exactly the sum of their months, and the year the sum of quarters", () => {
    const months = fiscalMonths(year);
    fiscalQuarters(year).forEach((q, qi) => {
      const sum = months.slice(qi * 3, qi * 3 + 3).reduce((s, m) => s + monthly.cells[m.key].profitCents, 0);
      expect(quarterly.cells[q.key].profitCents).toBe(sum);
    });
    expect(quarterly.total).toEqual(monthly.total);
    expect(summarize(entries, year)).toEqual(monthly.total);
  });
});

describe("periods", () => {
  const settings = { fiscalYearStartMonth: 1 };
  it("presets", () => {
    expect(presetRange("thisMonth", "2026-11-22", settings)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(presetRange("lastMonth", "2026-03-31", settings)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(presetRange("thisQuarter", "2026-11-22", settings)).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(presetRange("thisYear", "2026-11-22", settings)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(presetRange("last12", "2026-11-22", settings)).toEqual({ start: "2025-12-01", end: "2026-11-30" });
  });
  it("fiscal year starting in April", () => {
    expect(fiscalYearRange("2026-02-10", 4)).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(fiscalQuarters(fiscalYearRange("2026-02-10", 4)).map((q) => q.start)).toEqual(["2025-04-01", "2025-07-01", "2025-10-01", "2026-01-01"]);
    expect(presetRange("thisQuarter", "2026-02-10", { fiscalYearStartMonth: 4 })).toEqual({ start: "2026-01-01", end: "2026-03-31" });
  });
  it("previous period", () => {
    expect(previousRange({ start: "2026-11-01", end: "2026-11-30" })).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(previousRange({ start: "2026-01-01", end: "2026-03-31" })).toEqual({ start: "2025-10-01", end: "2025-12-31" });
    expect(previousRange({ start: "2026-11-10", end: "2026-11-19" })).toEqual({ start: "2026-10-31", end: "2026-11-09" });
  });
  it("month list for charts", () => {
    expect(monthsIn({ start: "2025-12-01", end: "2026-11-30" }).map((m) => m.key)).toHaveLength(12);
  });
  it("tax periods and deadlines", () => {
    expect(taxPeriodFor("2026-11-22", { taxFrequency: "quarterly", fiscalYearStartMonth: 1 })).toEqual({ start: "2026-10-01", end: "2026-12-31", dueDate: "2027-01-31" });
    expect(taxPeriodFor("2026-02-10", { taxFrequency: "monthly", fiscalYearStartMonth: 1 })).toEqual({ start: "2026-02-01", end: "2026-02-28", dueDate: "2026-03-31" });
    expect(taxDueDate({ start: "2026-01-01", end: "2026-12-31" }, "yearly")).toBe("2027-03-31");
  });
  it("adds months and clamps the day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
  });
});

describe("totals, cash flow and taxes", () => {
  const list = [
    entry({ kind: "in", categoryId: "labour_revenue", date: "2026-11-02", ...addTaxes(100000), paid: false }),
    entry({ kind: "in", categoryId: "parts_sales", date: "2026-10-28", ...addTaxes(20000), paid: true, paidOn: "2026-11-03" }),
    entry({ kind: "out", categoryId: "fuel", date: "2026-11-05", ...splitTaxesIncluded(11498) }),
    entry({ kind: "out", categoryId: "insurance", date: "2026-11-06", totalCents: 25000 }),
  ];
  it("profit uses amounts before taxes, paid and unpaid (like the sheet)", () => {
    const s = summarize(list, { start: "2026-11-01", end: "2026-11-30" });
    expect(s.incomeCents).toBe(100000);
    expect(s.expenseCents).toBe(10000 + 25000);
    expect(s.profitCents).toBe(65000);
    expect(results(s).profitMargin).toBeCloseTo(0.65);
  });
  it("cash flow counts only paid money, taxes included, on the day it was paid", () => {
    const [nov] = cashFlow(list, [{ key: "2026-11", start: "2026-11-01", end: "2026-11-30" }]);
    expect(nov.inflowCents).toBe(addTaxes(20000).totalCents);
    expect(nov.outflowCents).toBe(11498 + 25000);
    expect(nov.netCents).toBe(nov.inflowCents - nov.outflowCents);
    expect(cashNet(list, { start: "2026-11-01", end: "2026-11-30" })).toBe(nov.netCents);
  });
  it("taxes to set aside = collected − paid", () => {
    const s = summarize(list, { start: "2026-11-01", end: "2026-11-30" });
    expect(taxesOwed(s)).toEqual({ gstCents: 5000 - 500, qstCents: 9975 - 998, totalCents: 5000 - 500 + 9975 - 998 });
  });
});

describe("bills that repeat", () => {
  const rule: RecurringRule = { id: "r1", name: "Truck lease", kind: "out", categoryId: "truck_payments", party: "Paccar", amountCents: 123456, taxesIncluded: true, frequency: "monthly", startDate: "2026-01-31", endDate: null, paused: false, autoPaid: true, paymentMethod: "preauthorized", skippedDates: [], deletedAt: null };
  it("monthly on the 31st falls on the last day of short months", () => {
    expect(scheduledDates(rule, "2026-05-01")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
  it("catches up everything missed, once", () => {
    const pending = pendingOccurrences(rule, ["2026-01-31"], "2026-05-02");
    expect(pending).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(pendingOccurrences(rule, ["2026-01-31", ...pending], "2026-05-02")).toEqual([]);
  });
  it("respects skips, pauses, closed months and end dates", () => {
    expect(pendingOccurrences({ ...rule, skippedDates: ["2026-03-31"] }, [], "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-04-30"]);
    expect(pendingOccurrences({ ...rule, paused: true }, [], "2026-04-30")).toEqual([]);
    expect(pendingOccurrences(rule, [], "2026-04-30", new Set(["2026-02"]))).toEqual(["2026-01-31", "2026-03-31", "2026-04-30"]);
    expect(pendingOccurrences({ ...rule, endDate: "2026-03-01" }, [], "2026-12-31")).toEqual(["2026-01-31", "2026-02-28"]);
    expect(pendingOccurrences({ ...rule, deletedAt: "x" }, [], "2026-12-31")).toEqual([]);
  });
  it("nothing in the future", () => {
    expect(pendingOccurrences({ ...rule, startDate: "2026-12-01" }, [], "2026-11-22")).toEqual([]);
  });
  it("weekly, every 2 weeks, quarterly, yearly", () => {
    expect(scheduledDates({ ...rule, frequency: "weekly", startDate: "2026-11-02" }, "2026-11-22")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(scheduledDates({ ...rule, frequency: "biweekly", startDate: "2026-11-02" }, "2026-11-30")).toEqual(["2026-11-02", "2026-11-16", "2026-11-30"]);
    expect(scheduledDates({ ...rule, frequency: "quarterly", startDate: "2026-01-15" }, "2026-12-31")).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
    expect(scheduledDates({ ...rule, frequency: "yearly", startDate: "2024-02-29" }, "2026-12-31")).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });
  it("next date and resume", () => {
    expect(nextOccurrence(rule, "2026-11-01")).toBe("2026-11-30");
    expect(nextOccurrence({ ...rule, skippedDates: ["2026-11-30"] }, "2026-11-01")).toBe("2026-12-31");
    expect(datesToSkipOnResume(rule, "2026-02-10", "2026-05-05")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });
});

describe("duplicates and supplier memory", () => {
  const existing = [
    entry({ id: "fuel1", kind: "out", categoryId: "fuel", date: "2026-11-05", totalCents: 8742, party: "Petro-Canada" }),
    entry({ id: "inv1", kind: "in", categoryId: "labour_revenue", date: "2026-10-01", totalCents: 250000, party: "Transport Bourassa" }),
    entry({ id: "imp1", kind: "out", categoryId: "phone_software", date: "2026-11-01", totalCents: 9999, importKey: "bank|2026-11-01|out|9999|bell|1" }),
  ];
  const rows: ImportRow[] = [
    { date: "2026-11-06", kind: "out", totalCents: 8742, description: "PETRO-CANADA #4412 LAVAL QC", party: "" },
    { date: "2026-11-01", kind: "out", totalCents: 9999, description: "BELL", party: "" },
    { date: "2026-11-12", kind: "in", totalCents: 250000, description: "DEPOT TRANSPORT BOURASSA", party: "" },
    { date: "2026-11-06", kind: "out", totalCents: 8743, description: "PETRO-CANADA #4412 LAVAL QC", party: "" },
    { date: "2026-11-20", kind: "out", totalCents: 450, description: "TIM HORTONS", party: "" },
    { date: "2026-11-20", kind: "out", totalCents: 450, description: "TIM HORTONS", party: "" },
  ];
  const keys = importKeys(rows, "bank");
  it("identical lines in one file stay distinct", () => {
    expect(keys[4]).not.toBe(keys[5]);
    expect(importKeys(rows, "bank")).toEqual(keys); // stable
  });
  it("finds re-imports, look-alikes and invoice ↔ deposit pairs", () => {
    const result = checkDuplicates(rows, keys, existing);
    expect(result[0]).toMatchObject({ status: "possible", matchId: "fuel1" });
    expect(result[1]).toMatchObject({ status: "already-imported", matchId: "imp1" });
    expect(result[2]).toMatchObject({ status: "possible", matchId: "inv1", reason: "invoice-and-deposit" });
    expect(result[3].status).toBe("new"); // 1 cent different
    expect(result[4].status).toBe("new");
    expect(result[5].status).toBe("new");
  });
  it("one existing entry can only explain one imported line", () => {
    const twice = checkDuplicates([rows[0], rows[0]], ["a", "b"], existing);
    expect(twice.map((r) => r.status)).toEqual(["possible", "new"]);
  });
  it("text matching", () => {
    expect(normalizeText("PETRO-CANADA #4412 MONTRÉAL QC")).toBe("petro");
    expect(similarity("Petro-Canada", "PETRO-CANADA #4412 LAVAL QC")).toBe(1);
    expect(similarity("Bell", "Videotron")).toBe(0);
  });
  it("remembers supplier → category, then falls back to keywords", () => {
    const valid = new Set(categories.map((c) => c.id));
    expect(suggestCategory("NAPA PIECES D'AUTO 123", "out", [{ name: "NAPA", categoryId: "tools_equipment" }], [], valid)).toBe("tools_equipment");
    expect(suggestCategory("PETRO-CANADA #44", "out", [], [], valid)).toBe("fuel");
    expect(suggestCategory("Petro-Canada", "out", [], existing, valid)).toBe("fuel");
    expect(suggestCategory("HYDRO-QUEBEC", "out", [], [], valid)).toBe("utilities");
    expect(suggestCategory("Something unknown", "out", [], [], valid)).toBeNull();
    expect(guessParty("PETRO-CANADA #4412 LAVAL QC", ["Petro-Canada"])).toBe("Petro-Canada");
    expect(guessParty("NAPA AUTO PARTS #123", [])).toBe("Napa Auto Parts");
  });
});

describe("insights", () => {
  it("writes a plain sentence", () => {
    const now = summarize([entry({ kind: "in", categoryId: "labour_revenue", date: "2026-11-02", totalCents: 100000 }), entry({ kind: "out", categoryId: "fuel", date: "2026-11-03", totalCents: 82000 })], { start: "2026-11-01", end: "2026-11-30" });
    const before = summarize([entry({ kind: "out", categoryId: "fuel", date: "2026-10-03", totalCents: 67000 })], { start: "2026-10-01", end: "2026-10-31" });
    expect(summarySentence(now, before, "thisMonth", categories, "en")).toBe("This month you kept 18¢ of every dollar. Fuel – service trucks is up 22% vs last month.");
    expect(summarySentence(now, before, "thisMonth", categories, "fr")).toContain("18 ¢");
  });
  it("needs attention: old unpaid invoices, upcoming bills (no receipt reminders)", () => {
    const list = [
      entry({ kind: "in", categoryId: "labour_revenue", date: "2026-10-01", totalCents: 50000, paid: false }),
      entry({ kind: "in", categoryId: "labour_revenue", date: "2026-11-10", totalCents: 50000, paid: false }),
      entry({ kind: "out", categoryId: "fuel", date: "2026-11-10", totalCents: 5000 }),
      entry({ kind: "out", categoryId: "insurance", date: "2026-11-10", totalCents: 5000 }),
      entry({ kind: "out", categoryId: "fuel", date: "2026-11-11", totalCents: 5000, receiptPath: "x.jpg" }),
    ];
    const rule: RecurringRule = { id: "r", name: "Rent", kind: "out", categoryId: "shop_rent", party: "", amountCents: 100000, taxesIncluded: false, frequency: "monthly", startDate: "2026-01-25", endDate: null, paused: false, autoPaid: true, paymentMethod: null, skippedDates: [], deletedAt: null };
    const items = needsAttention(list, [rule], categories, "2026-11-22");
    expect(items.filter((i) => i.type === "unpaid")).toHaveLength(1);
    expect(items.filter((i) => i.type === "receipt")).toHaveLength(0); // receipt photos are turned off
    expect(needsAttention(list, [rule], categories, "2026-11-22", { receipts: true }).filter((i) => i.type === "receipt")).toHaveLength(1);
    expect(items.find((i) => i.type === "bill-due")).toMatchObject({ date: "2026-11-25" });
  });
  it("spots a month with suspiciously few expenses", () => {
    const list: MoneyEntry[] = [];
    for (const m of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]) {
      list.push(entry({ kind: "in", categoryId: "labour_revenue", date: `2026-${m}-10`, totalCents: 1000000 }));
      if (m !== "07") list.push(entry({ kind: "out", categoryId: "fuel", date: `2026-${m}-10`, totalCents: m === "04" ? 10000 : 300000 }));
    }
    expect(quietMonths(list, "2026-11-22").map((m) => m.month)).toEqual(["2026-04", "2026-07"]);
  });
  it("real profit doesn't count wages twice", () => {
    const days = [{ billableHours: 7.5, lostTimeMinutes: 30, hourlyRate: 32 }, { billableHours: 8, lostTimeMinutes: 0, hourlyRate: 32 }];
    const none = realProfit(500000, days, 0);
    expect(none.billableLabourCents).toBe(24000 + 25600);
    expect(none.lostTimeCents).toBe(1600);
    expect(none.realProfitCents).toBe(500000 - 49600 - 1600);
    const logged = realProfit(500000, days, 30000);
    expect(logged.realProfitCents).toBe(500000 - 49600 - 1600 + 30000);
    const allLogged = realProfit(500000, days, 999999);
    expect(allLogged.realProfitCents).toBe(500000);
    expect(realProfit(0, [{ billableHours: 2, lostTimeMinutes: 0, hourlyRate: null }], 0).missingRates).toBe(true);
  });
});

describe("CSV import", () => {
  it("reads dates in any common format", () => {
    expect(parseDate("2026-11-05", "ymd")).toBe("2026-11-05");
    expect(parseDate("2026/11/05", "ymd")).toBe("2026-11-05");
    expect(parseDate("11/05/2026", "mdy")).toBe("2026-11-05");
    expect(parseDate("05/11/2026", "dmy")).toBe("2026-11-05");
    expect(parseDate("Nov 5, 2026", "ymd")).toBe("2026-11-05");
    expect(parseDate("5 nov. 2026", "ymd")).toBe("2026-11-05");
    expect(parseDate("2026-02-30", "ymd")).toBeNull();
    expect(detectDateFormat(["03/04/2026", "25/04/2026"])).toBe("dmy");
    expect(detectDateFormat(["04/25/2026", "04/03/2026"])).toBe("mdy");
  });
  it("reads a bank export with a signed amount column", () => {
    const csv = [["Date", "Description", "Amount"], ["2026-11-05", "PETRO-CANADA #44", "-87.42"], ["2026-11-06", "DEPOT CLIENT", "1,250.00"], ["bad", "x", "1"], ["2026-11-07", "ZERO", "0"]];
    const { preset, mapping } = guessMapping(csv);
    expect(preset).toBe("bank");
    const { rows, problems } = readRows(csv, mapping, preset);
    expect(rows.map((r) => [r.kind, r.totalCents])).toEqual([["out", 8742], ["in", 125000]]);
    expect(problems.map((p) => p.reason)).toEqual(["date", "zero"]);
  });
  it("reads debit / credit columns", () => {
    const csv = [["Posted Date", "Payee", "Debit", "Credit"], ["11/05/2026", "NAPA", "120.00", ""], ["11/25/2026", "CLIENT", "", "300"]];
    const { preset, mapping } = guessMapping(csv);
    const { rows } = readRows(csv, mapping, preset);
    expect(rows.map((r) => [r.date, r.kind, r.totalCents])).toEqual([["2026-11-05", "out", 12000], ["2026-11-25", "in", 30000]]);
  });
  it("reads a Desjardins export (no header)", () => {
    const csv = [["Folio", "815", "EOP", "2026/11/05", "1", "PETRO-CANADA", "", "87.42", "", "", "", "", "", "1000.00"]];
    const { preset, mapping } = guessMapping(csv);
    expect(preset).toBe("desjardins");
    expect(readRows(csv, mapping, preset).rows[0]).toMatchObject({ date: "2026-11-05", kind: "out", totalCents: 8742 });
  });
  it("reads a Wave export, keeping only income and expense lines", () => {
    const csv = [
      ["Transaction ID", "Transaction Date", "Account Name", "Transaction Description", "Amount (One column)", "Debit Amount (Two Column Approach)", "Credit Amount (Two Column Approach)", "Customer", "Vendor", "Sales Tax Amount", "Account Group"],
      ["1", "2026-03-04", "Sales", "Invoice 12", "1000.00", "", "1000.00", "Transport Bourassa", "", "149.75", "Income"],
      ["1", "2026-03-04", "Chequing", "Invoice 12", "1149.75", "1149.75", "", "", "", "", "Assets"],
      ["2", "2026-03-05", "Merchant Account Fees", "Stripe", "12.30", "12.30", "", "", "", "", "Expense"],
    ];
    const { preset, mapping } = guessMapping(csv);
    expect(preset).toBe("wave");
    const { rows, problems } = readRows(csv, mapping, preset);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "in", totalCents: 114975, party: "Transport Bourassa", account: "Sales", taxCents: 14975 });
    expect(rows[1]).toMatchObject({ kind: "out", totalCents: 1230, account: "Merchant Account Fees" });
    expect(problems).toEqual([{ line: 3, reason: "skipped-account" }]);
  });
});
