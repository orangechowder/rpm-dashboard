// Duplicate detection (imports, "already logged?") and supplier → category memory.
import type { Cents } from "./cents";
import type { MoneyKind } from "./categories";
import { daysBetween, type ISODate } from "./dates";
import type { MoneyEntry } from "./types";

const NOISE = new Set([
  "pos", "purchase", "achat", "paiement", "payment", "interac", "debit", "credit", "card", "carte", "visa", "mastercard", "mc",
  "retrait", "withdrawal", "depot", "deposit", "transfer", "virement", "pre", "autorise", "preauthorized", "pad", "e", "the", "de", "du", "la", "le", "des", "et", "and",
  "inc", "ltee", "ltd", "enr", "qc", "on", "ca", "can", "canada", "montreal", "laval", "quebec",
]);

/** "PETRO-CANADA #1234 MONTRÉAL QC" → "petro" (accents/numbers/noise removed, for matching). */
export function normalizeText(value: string): string {
  return tokens(value).join(" ");
}

export function tokens(value: string): string[] {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !NOISE.has(token));
}

/** Share of the shorter text's words found in the other one (0–1). */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let hits = 0;
  for (const token of small) if (big.has(token) || [...big].some((other) => other.length >= 4 && token.length >= 4 && (other.startsWith(token) || token.startsWith(other)))) hits += 1;
  return hits / small.size;
}

export type ImportRow = {
  date: ISODate;
  kind: MoneyKind;
  totalCents: Cents;
  description: string;
  party: string;
};

/**
 * Stable key for one imported line, so the same file (or an overlapping one) can be imported twice
 * without creating doubles. Identical lines in one file (two $4.50 coffees the same day) get #1, #2.
 */
export function importKeys(rows: ImportRow[], source: string): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${source}|${row.date}|${row.kind}|${row.totalCents}|${normalizeText(`${row.party} ${row.description}`).slice(0, 80)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

export type DuplicateCheck = { status: "new" | "already-imported" | "possible"; matchId: string | null; reason: string | null };

/**
 * "already-imported": this exact line was imported before (same import key).
 * "possible": an entry with the same amount and direction exists a few days apart and looks alike
 *             (or, for money in, the same client within 60 days — an invoice and its bank deposit).
 */
export function checkDuplicates(rows: ImportRow[], keys: string[], existing: MoneyEntry[]): DuplicateCheck[] {
  const byKey = new Map(existing.filter((entry) => entry.importKey).map((entry) => [entry.importKey!, entry]));
  const live = existing.filter((entry) => !entry.deletedAt);
  const claimed = new Set<string>();
  return rows.map((row, index) => {
    const exact = byKey.get(keys[index]);
    if (exact) return { status: "already-imported", matchId: exact.id, reason: "same-line" };
    let best: { entry: MoneyEntry; score: number; reason: string } | null = null;
    for (const entry of live) {
      if (entry.kind !== row.kind || entry.totalCents !== row.totalCents || claimed.has(entry.id)) continue;
      const days = Math.abs(daysBetween(entry.date, row.date));
      const text = similarity(`${row.party} ${row.description}`, `${entry.party} ${entry.description}`);
      let score = 0;
      let reason = "";
      if (days <= 3 && (text >= 0.5 || !tokens(`${entry.party} ${entry.description}`).length || !tokens(`${row.party} ${row.description}`).length)) { score = 3 - days / 10 + text; reason = "same-amount-same-days"; }
      else if (days <= 7) { score = 1 + text - days / 10; reason = "same-amount-close-date"; }
      else if (row.kind === "in" && days <= 60 && text >= 0.5) { score = 0.5 + text; reason = "invoice-and-deposit"; }
      if (score > 0 && (!best || score > best.score)) best = { entry, score, reason };
    }
    if (best) {
      claimed.add(best.entry.id);
      return { status: "possible", matchId: best.entry.id, reason: best.reason };
    }
    return { status: "new", matchId: null, reason: null };
  });
}

export type PartyMemory = { name: string; categoryId: string | null };

const KEYWORD_CATEGORIES: Array<[RegExp, string]> = [
  [/\b(petro|shell|esso|ultramar|irving|couche|olco|pioneer|harnois|sonic|crevier|fuel|carburant|diesel|essence)\b/, "fuel"],
  [/\b(bell|videotron|telus|rogers|fizz|koodo|virgin|freedom|cogeco|microsoft|google|adobe|apple|wave|quickbooks|intuit|dropbox|zoom|openai|anthropic)\b/, "phone_software"],
  [/\b(hydro|energir|gaz metro|propane)\b/, "utilities"],
  [/\b(napa|uni select|lordco|fleetpride|traction|carquest|bumper|cummins|freightliner|volvo parts|kenworth|peterbilt|international parts|pieces|parts)\b/, "parts_purchases"],
  [/\b(intact|aviva|desjardins assurance|la capitale|ssq|beneva|insurance|assurance|saaq)\b/, "insurance"],
  [/\b(interest|interet|frais|fee|fees|service charge|bank fee|nsf)\b/, "bank_fees"],
  [/\b(canadian tire|home depot|rona|reno depot|bmr|princess auto|costco|walmart|dollarama|uline|staples|bureau en gros)\b/, "shop_supplies"],
  [/\b(snap on|mac tools|matco|cornwell|milwaukee|dewalt)\b/, "tools_equipment"],
  [/\b(facebook|meta|google ads|kijiji|marketplace|vistaprint)\b/, "marketing"],
  [/\b(notaire|notary|avocat|lawyer|comptable|accountant|cpa|raymond chabot|mallette)\b/, "accounting_legal"],
  [/\b(loyer|rent|hypotheque|mortgage)\b/, "shop_rent"],
  [/\b(location|lease|leasing|financement|financing|ford credit|gm financial|paccar|daimler)\b/, "truck_payments"],
  [/\b(paie|payroll|salaire|wages|desjardins paie|nethris|employeur d)\b/, "technician_wages"],
];

/** Suggest a category: remembered supplier/client first, then the last entry with that name, then keywords. */
export function suggestCategory(text: string, kind: MoneyKind, memory: PartyMemory[], history: MoneyEntry[], validIds: Set<string>): string | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const remembered = memory
    .filter((party) => party.categoryId && validIds.has(party.categoryId) && similarity(party.name, text) >= 0.99 && tokens(party.name).length)
    .sort((a, b) => tokens(b.name).length - tokens(a.name).length)[0];
  if (remembered) return remembered.categoryId;
  const previous = history.find((entry) => !entry.deletedAt && entry.kind === kind && entry.party && similarity(entry.party, text) >= 0.99);
  if (previous && validIds.has(previous.categoryId)) return previous.categoryId;
  if (kind === "out") {
    const ascii = ` ${normalized} `;
    for (const [pattern, id] of KEYWORD_CATEGORIES) if (pattern.test(ascii) && validIds.has(id)) return id;
  }
  return null;
}

/** Best display name for a bank line ("PETRO-CANADA #1234 MTL" → "Petro-Canada"), using known names first. */
export function guessParty(description: string, known: string[]): string {
  const match = known
    .filter((name) => tokens(name).length && similarity(name, description) >= 0.99)
    .sort((a, b) => b.length - a.length)[0];
  if (match) return match;
  const cleaned = description.replace(/[#*]\s*\d+.*$/, "").replace(/\s{2,}.*/, "").replace(/\b\d{3,}\b.*$/, "").trim();
  return cleaned
    .toLowerCase()
    .replace(/(^|[\s-])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .slice(0, 60);
}
