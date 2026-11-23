// Plain-language sentence, "Needs attention" checks and "Real profit".
import { formatMoney, formatPercent, type Cents, type Lang } from "./cents";
import { addDays, daysBetween, monthEnd, monthKey, type ISODate } from "./dates";
import { nextOccurrence, type RecurringRule } from "./recurring";
import { change, isLive, summarize, type Summary } from "./summary";
import type { MoneyCategory, MoneyEntry } from "./types";
import type { PeriodPreset } from "./periods";

const PERIOD_WORDS: Record<PeriodPreset, { en: [string, string]; fr: [string, string] }> = {
  // FR second item already carries its preposition ("par rapport au mois dernier").
  thisMonth: { en: ["This month", "last month"], fr: ["Ce mois-ci", "au mois dernier"] },
  lastMonth: { en: ["Last month", "the month before"], fr: ["Le mois dernier", "au mois précédent"] },
  thisQuarter: { en: ["This quarter", "last quarter"], fr: ["Ce trimestre", "au trimestre dernier"] },
  thisYear: { en: ["This year", "last year"], fr: ["Cette année", "à l'an dernier"] },
  last12: { en: ["Over the last 12 months", "the 12 months before"], fr: ["Sur les 12 derniers mois", "aux 12 mois précédents"] },
  custom: { en: ["In this period", "the period before"], fr: ["Pendant cette période", "à la période précédente"] },
};

/** "This month you kept 18¢ of every dollar. Fuel is up 22% vs last month." */
export function summarySentence(current: Summary, previous: Summary, preset: PeriodPreset, categories: MoneyCategory[], lang: Lang): string {
  const [now, before] = PERIOD_WORDS[preset][lang];
  const parts: string[] = [];
  if (current.count === 0) {
    return lang === "fr" ? `${now}, rien n'est encore inscrit. Appuyez sur « + Argent reçu » ou « – Argent dépensé » pour commencer.` : `${now}, nothing is logged yet. Tap “+ Money in” or “– Money out” to start.`;
  }
  if (current.incomeCents <= 0) {
    parts.push(lang === "fr" ? `${now}, vous avez dépensé ${formatMoney(current.expenseCents, lang)} et aucun argent reçu n'est inscrit.` : `${now} you spent ${formatMoney(current.expenseCents, lang)} and no money in is logged.`);
  } else if (current.profitCents >= 0) {
    const centsPerDollar = Math.round((current.profitCents * 100) / current.incomeCents);
    parts.push(lang === "fr" ? `${now}, vous avez gardé ${centsPerDollar} ¢ sur chaque dollar reçu.` : `${now} you kept ${centsPerDollar}¢ of every dollar.`);
  } else {
    parts.push(lang === "fr" ? `${now}, vous avez dépensé ${formatMoney(-current.profitCents, lang)} de plus que ce que vous avez reçu.` : `${now} you spent ${formatMoney(-current.profitCents, lang)} more than you brought in.`);
  }
  // Biggest expense move vs the previous period (at least $50 and 10%).
  let best: { name: string; pct: number; diff: number } | null = null;
  for (const category of categories) {
    if (category.kind !== "out") continue;
    const nowCents = current.byCategory[category.id] ?? 0;
    const beforeCents = previous.byCategory[category.id] ?? 0;
    if (beforeCents <= 0) continue;
    const pct = change(nowCents, beforeCents);
    const diff = nowCents - beforeCents;
    if (pct === null || Math.abs(pct) < 0.1 || Math.abs(diff) < 5000) continue;
    if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { name: lang === "fr" ? category.fr : category.en, pct, diff };
  }
  if (best) {
    const pct = formatPercent(Math.abs(best.pct), lang, { digits: 0 });
    parts.push(lang === "fr"
      ? `${best.name} : ${best.pct > 0 ? "en hausse" : "en baisse"} de ${pct} par rapport ${before}.`
      : `${best.name} is ${best.pct > 0 ? "up" : "down"} ${pct} vs ${before}.`);
  } else if (previous.incomeCents > 0) {
    const pct = change(current.incomeCents, previous.incomeCents);
    if (pct !== null && Math.abs(pct) >= 0.05) {
      const text = formatPercent(Math.abs(pct), lang, { digits: 0 });
      parts.push(lang === "fr" ? `L'argent reçu est ${pct > 0 ? "en hausse" : "en baisse"} de ${text} par rapport ${before}.` : `Money in is ${pct > 0 ? "up" : "down"} ${text} vs ${before}.`);
    }
  }
  return parts.join(" ");
}

export type AttentionItem =
  | { type: "unpaid"; entry: MoneyEntry; days: number }
  | { type: "receipt"; entry: MoneyEntry }
  | { type: "bill-due"; rule: RecurringRule; date: ISODate }
  | { type: "unpaid-bill"; entry: MoneyEntry }
  | { type: "quiet-month"; month: string; expenseCents: Cents; typicalCents: Cents };

export function needsAttention(entries: MoneyEntry[], rules: RecurringRule[], categories: MoneyCategory[], today: ISODate, options: { receiptLookbackDays?: number } = {}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const needsReceipt = new Set(categories.filter((c) => c.needsReceipt).map((c) => c.id));
  const lookback = addDays(today, -(options.receiptLookbackDays ?? 90));
  for (const entry of entries) {
    if (!isLive(entry)) continue;
    if (entry.kind === "in" && !entry.paid) {
      const days = daysBetween(entry.date, today);
      if (days > 30) items.push({ type: "unpaid", entry, days });
    }
    if (entry.kind === "out" && !entry.paid && entry.date <= addDays(today, 7)) items.push({ type: "unpaid-bill", entry });
    if (entry.kind === "out" && !entry.receiptPath && needsReceipt.has(entry.categoryId) && entry.date >= lookback && entry.date <= today) items.push({ type: "receipt", entry });
  }
  for (const rule of rules) {
    if (rule.deletedAt || rule.paused) continue;
    const date = nextOccurrence(rule, addDays(today, 1));
    if (date && date <= addDays(today, 7)) items.push({ type: "bill-due", rule, date });
  }
  items.push(...quietMonths(entries, today));
  return items;
}

/**
 * A finished month (in the last 12) whose expenses are under a third of the usual month — or zero
 * while money came in. Needs at least 3 months with expenses to know what "usual" is.
 */
export function quietMonths(entries: MoneyEntry[], today: ISODate): Array<Extract<AttentionItem, { type: "quiet-month" }>> {
  const thisMonth = monthKey(today);
  const months: string[] = [];
  for (let i = 1; i <= 12; i += 1) {
    const start = `${addMonthsKey(thisMonth, -i)}-01`;
    months.push(start);
  }
  const stats = months.map((start) => {
    const s = summarize(entries, { start, end: monthEnd(start) });
    return { month: start.slice(0, 7), expense: s.expenseCents, income: s.incomeCents };
  });
  const withExpenses = stats.filter((m) => m.expense > 0).map((m) => m.expense).sort((a, b) => a - b);
  if (withExpenses.length < 3) return [];
  const typical = withExpenses[Math.floor(withExpenses.length / 2)];
  const firstActive = stats.filter((m) => m.expense > 0 || m.income > 0).map((m) => m.month).sort()[0];
  return stats
    .filter((m) => m.month >= firstActive && (m.expense * 3 < typical || (m.expense === 0 && m.income > 0)))
    .map((m) => ({ type: "quiet-month" as const, month: m.month, expenseCents: m.expense, typicalCents: typical }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function addMonthsKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export type TimesheetDay = { billableHours: number; lostTimeMinutes: number; hourlyRate: number | null };

export type RealProfit = {
  keptCents: Cents;
  billableLabourCents: Cents;
  lostTimeCents: Cents;
  wagesAlreadyLoggedCents: Cents;
  /** The part of logged wages added back so payroll isn't counted twice (≤ labour + lost time). */
  addBackCents: Cents;
  realProfitCents: Cents;
  missingRates: boolean;
};

/**
 * Real profit = What I kept − labour cost (billable hours × rate) − lost-time cost (paid hours nobody
 * could bill), but technician wages already logged in Money out are not subtracted twice.
 */
export function realProfit(keptCents: Cents, days: TimesheetDay[], wagesLoggedCents: Cents): RealProfit {
  let billable = 0;
  let lost = 0;
  let missingRates = false;
  for (const day of days) {
    const rateCents = day.hourlyRate === null ? 0 : Math.round(day.hourlyRate * 100);
    if (!rateCents && (day.billableHours > 0 || day.lostTimeMinutes > 0)) missingRates = true;
    billable += Math.round(day.billableHours * rateCents);
    lost += Math.round((day.lostTimeMinutes * rateCents) / 60);
  }
  const addBack = Math.min(Math.max(wagesLoggedCents, 0), billable + lost);
  return {
    keptCents,
    billableLabourCents: billable,
    lostTimeCents: lost,
    wagesAlreadyLoggedCents: wagesLoggedCents,
    addBackCents: addBack,
    realProfitCents: keptCents - billable - lost + addBack,
    missingRates,
  };
}

export function monthTitle(month: string, lang: Lang): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { timeZone: "UTC", month: "long", year: "numeric" });
}
