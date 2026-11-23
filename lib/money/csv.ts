// Turning a bank or Wave CSV into rows. Parsing of the file itself (quotes, separators) is done by
// papaparse in the browser; this module only interprets the cells, so it is fully testable.
import { parseMoney, type Cents } from "./cents";
import type { MoneyKind } from "./categories";
import { isISODate, toISO, type ISODate } from "./dates";

export type DateFormat = "ymd" | "mdy" | "dmy";

export type ColumnMapping = {
  hasHeader: boolean;
  /** Lines above the titles / data to ignore (BMO starts with "Following data is valid as of…"). */
  skip: number;
  date: number;
  description: number;
  /** A second description column, joined to the first (RBC "Description 2", Scotiabank "Sub-description"). */
  description2: number | null;
  /** Either one signed amount column… */
  amount: number | null;
  /** …or separate money-out / money-in columns. */
  debit: number | null;
  credit: number | null;
  /** A column saying Debit / Credit (Scotiabank, BMO) when the amounts have no sign. */
  type: number | null;
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
  const compact = text.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (compact) return valid(Number(compact[1]), Number(compact[2]), Number(compact[3]));
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
export function detectDateFormat(samples: string[], ambiguous: DateFormat = "ymd"): DateFormat {
  const values = samples.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (values.every((v) => /^\d{4}[-/.]|^20\d{6}$/.test(v))) return "ymd";
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
  return values.some((v) => /^\d{1,2}[-/.]\d{1,2}[-/.]/.test(v)) ? ambiguous : "ymd";
}

const has = (header: string, ...words: string[]) => words.some((word) => header.includes(word));

function norm(header: string) {
  return String(header ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export type CsvPreset = "wave" | "bank" | "desjardins";
/** Which bank the file looks like it came from (only for display; the reading is driven by the mapping). */
export type BankName = "desjardins" | "national" | "rbc" | "td" | "bmo" | "scotia" | "tangerine" | "other";

const DATE_WORDS = ["transaction date", "date de transaction", "date de l'operation", "date operation", "date posted", "posted date", "date d'inscription", "date de comptabilisation", "date"];
const DESC_WORDS = ["description 1", "description", "libelle", "details", "detail", "merchant", "commercant", "payee", "beneficiaire", "name", "nom", "memo", "transaction"];
const DESC2_WORDS = ["description 2", "sub-description", "sous-description", "memo"];
const DEBIT_WORDS = ["debit", "withdrawal", "withdrawals", "retrait", "money out", "sortie", "paiements", "decaissement"];
const CREDIT_WORDS = ["credit", "deposit", "deposits", "depot", "money in", "entree", "encaissement"];
const AMOUNT_WORDS = ["transaction amount", "amount", "montant", "cad$", "cad", "valeur"];
const TYPE_WORDS = ["type of transaction", "transaction type", "type de transaction", "type d'operation", "type"];

/** First header that contains a word, trying the words in order (so "description 1" beats "transaction date"). */
function findBy(headers: string[], words: string[], exclude: Array<number | null> = []): number | null {
  for (const word of words) {
    const i = headers.findIndex((h, k) => !exclude.includes(k) && (h === word || h.includes(word)));
    if (i >= 0) return i;
  }
  return null;
}

function isDateCell(value: string) {
  return parseDate(value, "dmy") !== null || parseDate(value, "mdy") !== null;
}

/** How each column looks in the data (used for files without titles: TD, old Scotiabank, Desjardins). */
function profile(rows: string[][]) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => {
    const values = rows.map((r) => String(r[c] ?? "").trim());
    const filled = values.filter(Boolean);
    return {
      filled: filled.length,
      dates: filled.filter(isDateCell).length,
      numbers: filled.filter((v) => parseMoney(v) !== null).length,
      negatives: filled.filter((v) => (parseMoney(v) ?? 0) < 0).length,
      text: filled.filter((v) => /[a-z]{3,}/i.test(v)).reduce((s, v) => s + v.length, 0) / Math.max(1, filled.length),
      values,
    };
  });
}

function headerRowIndex(rows: string[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, 12); i += 1) {
    const cells = (rows[i] ?? []).map(norm);
    if ((rows[i] ?? []).some((c) => isDateCell(String(c ?? "").trim()))) continue;
    const hasDate = cells.some((h) => h.includes("date"));
    const hasMoney = cells.some((h) => [...AMOUNT_WORDS, ...DEBIT_WORDS, ...CREDIT_WORDS].some((w) => h.includes(w)));
    if (hasDate && hasMoney) return i;
  }
  return null;
}

/** Guesses how to read the file from its header row (Wave, Desjardins, or a Canadian bank / card export). */
export function guessMapping(rows: string[][]): { preset: CsvPreset; bank: BankName; mapping: ColumnMapping } {
  const first = (rows[0] ?? []).map(norm);
  const base: ColumnMapping = { hasHeader: true, skip: 0, date: 0, description: 1, description2: null, amount: 2, debit: null, credit: null, type: null, party: null, partyAlt: null, account: null, accountType: null, tax: null, dateFormat: "ymd", flipSigns: false };
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
    return { preset: "wave", bank: "other", mapping: { ...mapping, dateFormat: detectDateFormat(rows.slice(1, 60).map((r) => r[mapping.date])) } };
  }

  const headerAt = headerRowIndex(rows);
  if (headerAt === null) return headerless(rows, base);

  const headers = (rows[headerAt] ?? []).map(norm);
  const joined = headers.join("|");
  const data = rows.slice(headerAt + 1, headerAt + 80);
  const mapping: ColumnMapping = { ...base, skip: headerAt };
  mapping.date = findBy(headers, DATE_WORDS) ?? 0;
  const debit = findBy(headers, DEBIT_WORDS, [mapping.date]);
  const credit = findBy(headers, CREDIT_WORDS, [mapping.date, debit]);
  const amount = findBy(headers, AMOUNT_WORDS, [mapping.date]);
  const type = findBy(headers, TYPE_WORDS, [mapping.date]);
  // Description: never the date, amount or type column ("Transaction Date" contains "transaction").
  mapping.description = findBy(headers, DESC_WORDS, [mapping.date, debit, credit, amount, type]) ?? 1;
  mapping.description2 = findBy(headers, DESC2_WORDS, [mapping.date, mapping.description, debit, credit, amount, type]);
  if (debit !== null && credit !== null && debit !== credit) {
    mapping.amount = null;
    mapping.debit = debit;
    mapping.credit = credit;
  } else {
    mapping.amount = amount ?? 2;
    // Unsigned amounts with a Debit/Credit column (Scotiabank): the type column gives the direction.
    const col = profile(data)[mapping.amount];
    const typeValues = type === null ? [] : data.map((r) => norm(r[type] ?? "")).filter(Boolean);
    if (type !== null && col && col.negatives === 0 && typeValues.length && typeValues.every((v) => /debit|credit|retrait|depot|withdrawal|deposit/.test(v))) mapping.type = type;
  }
  const french = /montant|retrait|depot|libelle|operation|solde/.test(joined);
  mapping.dateFormat = detectDateFormat(data.map((r) => r[mapping.date]), french ? "dmy" : "mdy");
  const bank: BankName = joined.includes("cad$") && joined.includes("description 1") ? "rbc"
    : joined.includes("first bank card") || joined.includes("date posted") ? "bmo"
    : joined.includes("sub-description") || joined.includes("type of transaction") ? "scotia"
    : joined.includes("categorie") && mapping.debit !== null ? "national"
    : joined.includes("memo") && joined.includes("name") ? "tangerine"
    : "other";
  return { preset: "bank", bank, mapping };
}

function headerless(rows: string[][], base: ColumnMapping): { preset: CsvPreset; bank: BankName; mapping: ColumnMapping } {
  const sample = rows.slice(0, 80);
  const cols = profile(sample);
  // Desjardins AccèsD: no titles, a YYYY/MM/DD date after 3 or 4 account columns, then
  // transaction no., description, cheque no., withdrawal, deposit, …, balance.
  const desjardinsDate = cols.findIndex((c, i) => i >= 3 && i <= 4 && c.filled > 0 && c.values.filter(Boolean).every((v) => /^\d{4}\/\d{2}\/\d{2}$/.test(v)));
  if (desjardinsDate >= 0 && cols.length >= desjardinsDate + 6) {
    return { preset: "desjardins", bank: "desjardins", mapping: { ...base, hasHeader: false, date: desjardinsDate, description: desjardinsDate + 2, amount: null, debit: desjardinsDate + 4, credit: desjardinsDate + 5, dateFormat: "ymd" } };
  }
  const date = cols.findIndex((c) => c.filled > 0 && c.dates / c.filled >= 0.8);
  const textCols = cols.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== date && c.text > 0 && c.numbers < c.filled);
  const description = textCols.sort((a, b) => b.c.text - a.c.text)[0]?.i ?? 1;
  const numeric = cols.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== date && i !== description && c.filled > 0 && c.numbers / c.filled >= 0.9);
  const mapping: ColumnMapping = { ...base, hasHeader: false, date: Math.max(0, date), description };
  // Two columns never filled on the same line = withdrawals / deposits (TD: date, description, out, in, balance).
  const pair = numeric.length >= 2 && sample.every((r) => !(String(r[numeric[0].i] ?? "").trim() && String(r[numeric[1].i] ?? "").trim()));
  if (pair) { mapping.amount = null; mapping.debit = numeric[0].i; mapping.credit = numeric[1].i; }
  else mapping.amount = numeric[0]?.i ?? 2;
  mapping.dateFormat = detectDateFormat(sample.map((r) => r[mapping.date]), "mdy");
  const bank: BankName = pair && numeric.length >= 3 ? "td" : cols.some((c) => c.values.some((v) => /^(debit|credit)$/i.test(v))) ? "scotia" : "other";
  return { preset: "bank", bank, mapping };
}

/** Reads every data row; lines that can't be understood are reported, never guessed. */
export function readRows(rows: string[][], mapping: ColumnMapping, preset: CsvPreset): { rows: ParsedRow[]; problems: RowProblem[] } {
  const out: ParsedRow[] = [];
  const problems: RowProblem[] = [];
  const skip = mapping.skip ?? 0;
  rows.forEach((cells, index) => {
    if (index < skip) return;
    if (mapping.hasHeader && index === skip) return;
    if (!cells.some((cell) => String(cell ?? "").trim())) return;
    const line = index + 1;
    const cell = (column: number | null | undefined) => (column === null || column === undefined ? "" : String(cells[column] ?? "").trim());
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
        if (signed !== null && mapping.type !== null && mapping.type !== undefined) {
          const t = norm(cell(mapping.type));
          if (/debit|retrait|withdrawal/.test(t)) signed = -Math.abs(signed);
          else if (/credit|depot|deposit/.test(t)) signed = Math.abs(signed);
        }
        if (signed !== null && mapping.flipSigns) signed = -signed;
      } else {
        const out = parseMoney(cell(mapping.debit));
        const inn = parseMoney(cell(mapping.credit));
        signed = out === null && inn === null ? null : Math.abs(inn ?? 0) - Math.abs(out ?? 0);
        if (signed !== null && mapping.flipSigns) signed = -signed;
      }
      if (signed === null) { problems.push({ line, reason: "amount" }); return; }
      kind = signed < 0 ? "out" : "in";
      cents = Math.abs(signed);
    }
    if (cents === null) { problems.push({ line, reason: "amount" }); return; }
    if (cents === 0) { problems.push({ line, reason: "zero" }); return; }
    const tax = mapping.tax === null ? null : parseMoney(cell(mapping.tax));
    const extra = cell(mapping.description2);
    const description = [cell(mapping.description), extra].filter(Boolean).join(" · ");
    out.push({
      line,
      date,
      kind,
      totalCents: cents + (preset === "wave" && tax ? Math.abs(tax) : 0),
      description,
      party: cell(mapping.party) || cell(mapping.partyAlt),
      account: cell(mapping.account),
      taxCents: tax === null ? null : Math.abs(tax),
    });
  });
  return { rows: out, problems };
}
