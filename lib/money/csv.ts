// Turning a bank or Wave CSV into rows. Parsing of the file itself (quotes, separators) is done by
// papaparse in the browser; this module only interprets the cells, so it is fully testable.
import { parseMoney, type Cents } from "./cents";
import type { MoneyKind } from "./categories";
import { isISODate, toISO, type ISODate } from "./dates";

export type DateFormat = "ymd" | "mdy" | "dmy";

export type ColumnMapping = {
  hasHeader: boolean;
  date: number;
  description: number;
  /** Either one signed amount column… */
  amount: number | null;
  /** …or separate money-out / money-in columns. */
  debit: number | null;
  credit: number | null;
  party: number | null;
  /** Second name column (Wave: Vendor, when Customer is empty). */
  partyAlt: number | null;
  /** Wave: the account (category) name, and its group/type (Income / Expense). */
  account: number | null;
  accountType: number | null;
  tax: number | null;
  dateFormat: DateFormat;
  /** A positive amount means money OUT (some credit-card exports). */
  flipSigns: boolean;
};

export type ParsedRow = {
  line: number;
  date: ISODate;
  kind: MoneyKind;
  totalCents: Cents;
  description: string;
  party: string;
  account: string;
  taxCents: Cents | null;
};

export type RowProblem = { line: number; reason: "date" | "amount" | "skipped-account" | "zero" };

const MONTH_WORDS: Record<string, number> = {
  jan: 1, janv: 1, january: 1, janvier: 1, feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2, mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, april: 4, avril: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, september: 9, septembre: 9, oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12,
};

export function parseDate(raw: string, format: DateFormat): ISODate | null {
  const text = String(raw ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const words = text.match(/^(\d{1,2})?\s*([a-z]+)\.?\s*(\d{1,2})?,?\s*(\d{4})$/);
  if (words && MONTH_WORDS[words[2]]) return valid(Number(words[4]), MONTH_WORDS[words[2]], Number(words[1] ?? words[3]));
  const parts = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (parts) {
    let year = Number(parts[3]);
    if (year < 100) year += 2000;
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    return format === "dmy" ? valid(year, b, a) : valid(year, a, b);
  }
  return null;
}

function valid(year: number, month: number, day: number): ISODate | null {
  const date = toISO(year, month, day);
  return isISODate(date) ? date : null;
}

/** Picks the date format that reads every sample (MM/DD vs DD/MM is decided by values over 12). */
export function detectDateFormat(samples: string[]): DateFormat {
  const values = samples.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (values.every((v) => /^\d{4}[-/.]/.test(v))) return "ymd";
  let firstOver12 = false;
  let secondOver12 = false;
  for (const value of values) {
    const m = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  if (firstOver12 && !secondOver12) return "dmy";
  if (secondOver12 && !firstOver12) return "mdy";
  return "ymd";
}

const has = (header: string, ...words: string[]) => words.some((word) => header.includes(word));

function norm(header: string) {
  return String(header ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export type CsvPreset = "wave" | "bank" | "desjardins";

/** Guesses how to read the file from its header row (Wave, Desjardins, or a generic bank export). */
export function guessMapping(rows: string[][]): { preset: CsvPreset; mapping: ColumnMapping } {
  const first = (rows[0] ?? []).map(norm);
  const base: ColumnMapping = { hasHeader: true, date: 0, description: 1, amount: 2, debit: null, credit: null, party: null, partyAlt: null, account: null, accountType: null, tax: null, dateFormat: "ymd", flipSigns: false };
  const find = (...words: string[]) => { const i = first.findIndex((h) => has(h, ...words)); return i >= 0 ? i : null; };

  if (find("account name") !== null && find("transaction date") !== null) {
    const mapping: ColumnMapping = {
      ...base,
      date: find("transaction date")!,
      description: find("transaction description") ?? find("description")!,
      amount: find("amount (one column)", "amount (one") ?? null,
      debit: find("debit amount") ?? null,
      credit: find("credit amount") ?? null,
      party: null,
      account: find("account name"),
      accountType: find("account group") ?? find("account type"),
      tax: find("sales tax amount"),
    };
    const customer = find("customer");
    const vendor = find("vendor");
    mapping.party = customer ?? vendor;
    mapping.partyAlt = customer !== null ? vendor : null;
    return { preset: "wave", mapping: { ...mapping, dateFormat: detectDateFormat(rows.slice(1, 60).map((r) => r[mapping.date])) } };
  }

  const looksHeaderless = first.length >= 8 && /^\d{4}\/\d{2}\/\d{2}$/.test(rows[0]?.[3] ?? "") ;
  if (looksHeaderless || /^\d{4}\/\d{2}\/\d{2}$/.test(rows[0]?.[3] ?? "")) {
    // Desjardins AccèsD export: no header; date in column 4, description 6, withdrawal 8, deposit 9.
    return { preset: "desjardins", mapping: { ...base, hasHeader: false, date: 3, description: 5, amount: null, debit: 7, credit: 8, dateFormat: "ymd" } };
  }

  const mapping: ColumnMapping = { ...base };
  mapping.date = find("date", "posted", "transaction date", "date de transaction") ?? 0;
  mapping.description = find("description", "libelle", "details", "merchant", "commercant", "payee", "beneficiaire", "memo", "transaction") ?? 1;
  const debit = find("debit", "withdrawal", "retrait", "money out", "sortie");
  const credit = find("credit", "deposit", "depot", "money in", "entree");
  if (debit !== null && credit !== null && debit !== credit) {
    mapping.amount = null;
    mapping.debit = debit;
    mapping.credit = credit;
  } else {
    mapping.amount = find("amount", "montant", "cad$", "cad") ?? 2;
  }
  mapping.hasHeader = first.some((h) => /[a-z]/.test(h)) && !parseMoney(first[mapping.amount ?? mapping.debit ?? 2] ?? "");
  const dataRows = mapping.hasHeader ? rows.slice(1, 60) : rows.slice(0, 60);
  mapping.dateFormat = detectDateFormat(dataRows.map((r) => r[mapping.date]));
  return { preset: "bank", mapping };
}

/** Reads every data row; lines that can't be understood are reported, never guessed. */
export function readRows(rows: string[][], mapping: ColumnMapping, preset: CsvPreset): { rows: ParsedRow[]; problems: RowProblem[] } {
  const out: ParsedRow[] = [];
  const problems: RowProblem[] = [];
  rows.forEach((cells, index) => {
    if (mapping.hasHeader && index === 0) return;
    if (!cells.some((cell) => String(cell ?? "").trim())) return;
    const line = index + 1;
    const cell = (column: number | null) => (column === null ? "" : String(cells[column] ?? "").trim());
    const date = parseDate(cell(mapping.date), mapping.dateFormat);
    if (!date) { problems.push({ line, reason: "date" }); return; }

    let kind: MoneyKind;
    let cents: Cents | null;
    if (preset === "wave") {
      const group = norm(cell(mapping.accountType));
      const isIncome = has(group, "income", "revenu");
      const isExpense = has(group, "expense", "depense", "cost of goods", "cout");
      if (!isIncome && !isExpense) { problems.push({ line, reason: "skipped-account" }); return; }
      kind = isIncome ? "in" : "out";
      const debit = parseMoney(cell(mapping.debit));
      const credit = parseMoney(cell(mapping.credit));
      const single = parseMoney(cell(mapping.amount));
      // Income accounts grow with credits, expense accounts with debits; a reversal is the opposite.
      if (debit !== null || credit !== null) cents = isIncome ? (credit ?? 0) - (debit ?? 0) : (debit ?? 0) - (credit ?? 0);
      else cents = single === null ? null : Math.abs(single);
      if (cents !== null && cents < 0) { kind = kind === "in" ? "out" : "in"; cents = -cents; }
    } else {
      let signed: Cents | null;
      if (mapping.amount !== null) {
        signed = parseMoney(cell(mapping.amount));
        if (signed !== null && mapping.flipSigns) signed = -signed;
      } else {
        const out = parseMoney(cell(mapping.debit));
        const inn = parseMoney(cell(mapping.credit));
        signed = out === null && inn === null ? null : (inn ?? 0) - Math.abs(out ?? 0);
        if (signed !== null && mapping.flipSigns) signed = -signed;
      }
      if (signed === null) { problems.push({ line, reason: "amount" }); return; }
      kind = signed < 0 ? "out" : "in";
      cents = Math.abs(signed);
    }
    if (cents === null) { problems.push({ line, reason: "amount" }); return; }
    if (cents === 0) { problems.push({ line, reason: "zero" }); return; }
    const tax = mapping.tax === null ? null : parseMoney(cell(mapping.tax));
    out.push({
      line,
      date,
      kind,
      totalCents: cents + (preset === "wave" && tax ? Math.abs(tax) : 0),
      description: cell(mapping.description),
      party: cell(mapping.party) || cell(mapping.partyAlt),
      account: cell(mapping.account),
      taxCents: tax === null ? null : Math.abs(tax),
    });
  });
  return { rows: out, problems };
}
