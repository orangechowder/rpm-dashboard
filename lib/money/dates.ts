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

// ---------------------------------------------------------------------------
// Typed dates: read a date the way it's printed on an invoice, French or English.
// "25/11/2026", "25-11-26", "2026-11-25", "25 nov. 2026", "Nov 25, 2026", "le 3 mars", "25", "hier"…

const MONTH_WORDS: Array<[string, number]> = [
  ["january", 1], ["janvier", 1], ["janv", 1], ["jan", 1],
  ["february", 2], ["fevrier", 2], ["fevr", 2], ["fev", 2], ["feb", 2],
  ["march", 3], ["mars", 3], ["mar", 3],
  ["april", 4], ["avril", 4], ["avr", 4], ["apr", 4],
  ["may", 5], ["mai", 5],
  ["june", 6], ["juin", 6], ["jun", 6],
  ["july", 7], ["juillet", 7], ["juil", 7], ["jul", 7],
  ["august", 8], ["aout", 8], ["aug", 8],
  ["september", 9], ["septembre", 9], ["sept", 9], ["sep", 9],
  ["october", 10], ["octobre", 10], ["oct", 10],
  ["november", 11], ["novembre", 11], ["nov", 11],
  ["december", 12], ["decembre", 12], ["dec", 12],
];
const MONTH_BY_WORD = new Map(MONTH_WORDS);
const IGNORED_WORDS = new Set([
  "le", "the", "of", "de", "du", "on", "date", "invoice", "facture",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thurs", "fri", "sat", "sun",
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
  "lun", "mer", "jeu", "ven", "sam", "dim",
]);

function valid(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return toISO(year, month, day);
}

function fullYear(text: string): number {
  const n = Number(text);
  return text.length <= 2 ? 2000 + n : n;
}

/** No year written: this year, unless that lands more than a month in the future (then last year). */
function guessYear(month: number, day: number, today: ISODate): ISODate | null {
  const year = parseISO(today).year;
  const date = valid(year, month, day);
  if (date && daysBetween(today, date) > 31) return valid(year - 1, month, day);
  return date ?? valid(year - 1, month, day);
}

/** Numbers are always read day first (dd/mm/yyyy). */
function dayMonth(day: number, month: number, year: string | null, today: ISODate): ISODate | null {
  return year === null ? guessYear(month, day, today) : valid(fullYear(year), month, day);
}

/** Shows a date as dd/mm/yyyy. */
export function formatDayMonthYear(date: ISODate): string {
  const { year, month, day } = parseISO(date);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/** The date typed (dd/mm/yyyy, 2026-11-25, 25 nov 2026, hier…), or null when it can't be read. */
export function readTypedDate(text: string, today: ISODate): ISODate | null {
  const clean = text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/(\d)(st|nd|rd|th|er|e)\b/g, "$1")
    .replace(/[,.]+(?=\s|$)/g, " ")
    .trim();
  if (!clean) return null;
  if (["today", "aujourd'hui", "aujourdhui", "auj", "now", "maintenant"].includes(clean)) return today;
  if (["yesterday", "hier"].includes(clean)) return addDays(today, -1);
  if (["tomorrow", "demain"].includes(clean)) return addDays(today, 1);

  // Written month: "25 novembre 2026", "Nov 25, 2026", "3 mars", "novembre 2026" is not a day → rejected.
  if (/[a-z]/.test(clean)) {
    const words = clean.split(/[\s/\-.,]+/).filter((w) => w && !IGNORED_WORDS.has(w));
    const monthWords = words.filter((w) => /^[a-z]+$/.test(w));
    if (monthWords.length !== 1) return null;
    const month = MONTH_BY_WORD.get(monthWords[0]) ?? MONTH_WORDS.find(([w]) => w.length >= 3 && monthWords[0].length >= 3 && w.startsWith(monthWords[0]))?.[1];
    if (!month) return null;
    const numbers = words.filter((w) => /^\d+$/.test(w));
    if (numbers.length < 1 || numbers.length > 2) return null;
    let day: string | undefined;
    let year: string | null = null;
    for (const n of numbers) {
      if (n.length === 4 || (day !== undefined && year === null)) year = n;
      else if (day === undefined) day = n;
    }
    if (day === undefined) return null;
    const date = year === null ? guessYear(month, Number(day), today) : valid(fullYear(year), month, Number(day));
    return date;
  }

  const parts = clean.split(/[\s/\-.]+/).filter(Boolean);
  if (parts.some((p) => !/^\d+$/.test(p))) return null;

  if (parts.length === 1) {
    const p = parts[0];
    if (p.length <= 2) { // just a day: this month
      const { year, month } = parseISO(today);
      const date = valid(year, month, Number(p));
      return date;
    }
    if (p.length === 8) { // 20261125 or 25112026
      const ymd = valid(Number(p.slice(0, 4)), Number(p.slice(4, 6)), Number(p.slice(6, 8)));
      return ymd ?? dayMonth(Number(p.slice(0, 2)), Number(p.slice(2, 4)), p.slice(4), today);
    }
    return null;
  }

  if (parts.length === 2) {
    if (parts.some((p) => p.length > 2)) return null;
    return dayMonth(Number(parts[0]), Number(parts[1]), null, today);
  }

  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 4) { // 2026-11-25
      const date = valid(Number(a), Number(b), Number(c));
      return date;
    }
    if (c.length === 4 || c.length === 2) {
      if (a.length > 2 || b.length > 2) return null;
      return dayMonth(Number(a), Number(b), c, today);
    }
  }
  return null;
}
