// Wave "Account Transactions (General Ledger)" CSV → Money entries, cash basis.
//
// The report is grouped by account (", Cash on Hand,,,," then its lines, then "Totals and Ending Balance").
// Only the cash accounts (Cash on Hand, Wave Payments, bank accounts) become entries, so each payment is
// counted once. The other accounts are only used to describe each payment:
//   • Sales lines ("Client - 11175 - Hour rate")  → how the invoice splits into labour / parts / service call
//   • GST / QST lines                              → the exact taxes on that invoice
//   • Accounts Receivable ("Client - 11175")       → the invoice total, to tell a Wave card payment's fee apart
//   • Merchant fees                                → Wave Payments deposits arrive net of the card fee; the fee
//                                                    is added back (money in = what the client paid) and logged
//                                                    as a bank-fee expense
//   • Customer credits                             → which invoice an "Estimate Deposit" was later applied to
// Everything is integer cents; every split is allocated so the pieces add up exactly to the payment.
import { divRound, parseMoney, type Cents } from "./cents";
import type { MoneyKind } from "./categories";
import { parseDate } from "./csv";
import { splitTaxesIncluded } from "./tax";
import type { ISODate } from "./dates";

export type AccountRole = "cash" | "receivable" | "sales" | "gst" | "qst" | "invoice_charge" | "merchant_fees" | "customer_credits" | "other";

export type LedgerLine = { line: number; account: string; date: ISODate; description: string; debitCents: Cents; creditCents: Cents };
export type LedgerAccount = { name: string; number: string; role: AccountRole; lines: number; debitCents: Cents; creditCents: Cents };
export type WaveLedger = { company: string; from: ISODate | null; to: ISODate | null; basis: string; accounts: LedgerAccount[]; lines: LedgerLine[] };

export type LedgerRow = {
  line: number;
  date: ISODate;
  kind: MoneyKind;
  totalCents: Cents;
  gstCents: Cents;
  qstCents: Cents;
  categoryId: string;
  party: string;
  description: string;
  account: string;
  invoice: string | null;
  /** Taxes guessed with the standard 5% + 9.975% split (the invoice isn't in the file). */
  estimated: boolean;
  /** Stable, unique key: re-importing the same file (or a newer export) never doubles anything. */
  key: string;
};

export type LedgerNote =
  | { type: "reversal"; date: ISODate; account: string; description: string; cents: Cents }
  | { type: "refund-netted"; date: ISODate; account: string; description: string; cents: Cents }
  | { type: "refund"; date: ISODate; account: string; description: string; cents: Cents }
  | { type: "transfer"; date: ISODate; account: string; description: string; cents: Cents }
  | { type: "no-invoice"; date: ISODate; account: string; description: string; cents: Cents };

export type MonthLine = { month: string; inCount: number; inCents: Cents; inNetCents: Cents; outCount: number; outCents: Cents; waveIncomeCents: Cents; waveFeesCents: Cents };

const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function findHeader(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const cells = (rows[i] ?? []).map(norm);
    const at = (test: (c: string) => boolean) => cells.findIndex(test);
    const debit = at((c) => c.startsWith("debit"));
    const credit = at((c) => c.startsWith("credit"));
    const date = at((c) => c === "date" || c.startsWith("date"));
    if (debit >= 0 && credit >= 0 && date >= 0) {
      return {
        index: i, date, debit, credit,
        description: Math.max(0, at((c) => c.startsWith("description") || c.startsWith("libelle"))),
        balance: at((c) => c.startsWith("balance") || c.startsWith("solde")),
        number: at((c) => c.includes("account number") || c.includes("numero de compte") || c.includes("no de compte")),
      };
    }
  }
  return null;
}

/** True for a Wave "Account Transactions" / General Ledger export (English or French). */
export function isWaveLedger(rows: string[][]): boolean {
  const top = rows.slice(0, 6).map((r) => norm((r ?? []).join(" ")));
  const titled = top.some((t) => /account transactions|transactions (du|des) comptes?|general ledger|grand livre/.test(t));
  const header = findHeader(rows);
  return Boolean(header && (titled || header.balance >= 0 && header.number >= 0));
}

const SKIP_ROW = /^(starting balance|opening balance|solde (de depart|d'ouverture|initial|au debut|d'ouverture)|totals?\b|balance change|variation|ending balance|solde (de fin|final|de cloture))/;

export function accountRole(name: string, lines: LedgerLine[] = []): AccountRole {
  const n = norm(name);
  if (/customer credit|credits? (des )?clients?|credits? consolid/.test(n)) return "customer_credits";
  if (/receivable|comptes? clients|a recevoir|debiteurs/.test(n)) return "receivable";
  if (/^(gst|tps|hst|tvh)\b|^gst\/hst|^tps\/tvh/.test(n)) return "gst";
  if (/^(qst|tvq)\b/.test(n)) return "qst";
  if (/merchant|frais (de )?(marchand|traitement|carte)|processing fee|payment processing|frais de paiement/.test(n)) return "merchant_fees";
  if (/cash|encaisse|petite caisse|wave payments|paiements wave|bank|banque|chequ|cheque|checking|savings|epargne|compte courant|desjardins|tangerine|paypal|stripe|square/.test(n)) return "cash";
  if (/sales|ventes?\b|revenue|revenus?\b|income|chiffre d'affaires/.test(n)) return "sales";
  // A tax-like account Wave fills per invoice line ("Client - 11179 - Hour rate", credits): e.g. a card surcharge.
  const perLine = lines.filter((l) => INVOICE_LINE.test(l.description) && l.creditCents > 0).length;
  if (lines.length > 0 && perLine / lines.length >= 0.8) return "invoice_charge";
  return "other";
}

/** Reads the whole report. Lines it can't read are skipped, never guessed. */
export function parseWaveLedger(rows: string[][]): WaveLedger {
  const header = findHeader(rows);
  if (!header) throw new Error("not a Wave ledger");
  const meta = rows.slice(0, header.index).map((r) => (r ?? []).join(" ").trim()).filter(Boolean);
  const range = meta.join(" ").match(/(\d{4}-\d{2}-\d{2})\s*(?:to|au|à|a|-)\s*(\d{4}-\d{2}-\d{2})/i);
  const basisLine = meta.find((m) => /report type|type de rapport/i.test(m)) ?? "";
  const lines: LedgerLine[] = [];
  const accounts: Array<{ name: string; number: string }> = [];
  let current: { name: string; number: string } | null = null;
  for (let i = header.index + 1; i < rows.length; i += 1) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? "").trim());
    if (!cells.some(Boolean)) continue;
    if (SKIP_ROW.test(norm(cells[0]))) continue;
    const debit = parseMoney(cells[header.debit] ?? "");
    const credit = parseMoney(cells[header.credit] ?? "");
    const date = parseDate(cells[header.date] ?? "", "ymd");
    if (date && current) {
      if (debit === null && credit === null) continue;
      // A negative number in a column means the other side.
      const d = (debit ?? 0) - Math.min(0, credit ?? 0);
      const c = (credit ?? 0) - Math.min(0, debit ?? 0);
      lines.push({ line: i + 1, account: current.name, date, description: cells[header.description] ?? "", debitCents: Math.max(0, d), creditCents: Math.max(0, c) });
      continue;
    }
    const amounts = [header.debit, header.credit, header.balance].some((k) => k >= 0 && cells[k]);
    if (!date && !amounts) {
      const name = cells[header.date] || cells.find(Boolean) || "";
      if (name && !SKIP_ROW.test(norm(name))) {
        current = { name, number: header.number >= 0 && header.number !== header.date ? cells[header.number] ?? "" : "" };
        accounts.push(current);
      }
    }
  }
  return {
    company: meta[1] ?? "",
    from: range ? (range[1] as ISODate) : null,
    to: range ? (range[2] as ISODate) : null,
    basis: basisLine.replace(/^[^:]*:\s*/, ""),
    accounts: accounts.map((a) => {
      const own = lines.filter((l) => l.account === a.name);
      return { ...a, role: accountRole(a.name, own), lines: own.length, debitCents: own.reduce((s, l) => s + l.debitCents, 0), creditCents: own.reduce((s, l) => s + l.creditCents, 0) };
    }),
    lines,
  };
}

// ---- descriptions --------------------------------------------------------------------------------------
const PAYMENT = /^(.*?)\s+-\s+(?:payment for invoice|paiement (?:de|pour) (?:la )?facture|paiement facture)\s*(?:#|no\.?|n°)?\s*([\w-]+)\s*$/i;
const DEPOSIT = /^(?:estimate deposit|deposit|d[ée]p[ôo]t(?: sur| d['’]| de)?\s*(?:l['’])?(?:estimation|soumission|devis)?)\s*-\s*(.+)$/i;
const INVOICE_LINE = /^(.*?)\s+-\s+(\d{2,}[\w-]*)\s+-\s+(.+)$/;
const INVOICE_HEAD = /^(.*?)\s+-\s+(\d{2,}[\w-]*)$/;
const TRANSFER = /transfer|virement|payout|versement|withdrawal to|retrait vers/i;

export function describe(description: string): { party: string; invoice: string | null; deposit: boolean } {
  const pay = description.match(PAYMENT);
  if (pay) return { party: pay[1].trim(), invoice: pay[2], deposit: false };
  const dep = description.match(DEPOSIT);
  if (dep) return { party: dep[1].trim(), invoice: null, deposit: true };
  const line = description.match(INVOICE_LINE) ?? description.match(INVOICE_HEAD);
  if (line) return { party: line[1].trim(), invoice: line[2], deposit: false };
  return { party: "", invoice: null, deposit: false };
}

/** Which income category an invoice item goes to (Sales account item names, EN or FR). */
export function itemCategory(item: string): string {
  const n = norm(item);
  if (/part|piece|filt|huile|\boil\b|batter|pneu|tire|courroie|belt|hose|boyau/.test(n)) return "parts_sales";
  if (/appel de service|service call|deplacement|travel|kilom|mileage|remorqu|towing|road ?call/.test(n)) return "service_call_fees";
  if (/frais de transaction|transaction fee|surcharge|frais de carte|card fee/.test(n)) return "other_income";
  return "labour_revenue";
}

// ---- exact allocation ----------------------------------------------------------------------------------
/** Splits `amount` cents across weights (largest remainder): the parts always add up to `amount`. */
export function allocate(amount: Cents, weights: Array<[string, number]>): Map<string, Cents> {
  const out = new Map<string, Cents>();
  const positive = weights.filter(([, w]) => w > 0);
  const total = positive.reduce((s, [, w]) => s + w, 0);
  if (!positive.length || total <= 0) return out;
  const a = BigInt(amount);
  const t = BigInt(total);
  let given = BigInt(0);
  const rest: Array<{ id: string; r: bigint; i: number }> = [];
  positive.forEach(([id, w], i) => {
    const exact = a * BigInt(w);
    let q = exact / t;
    let r = exact % t;
    if (r < BigInt(0)) { q -= BigInt(1); r += t; }
    out.set(id, (out.get(id) ?? 0) + Number(q));
    given += q;
    rest.push({ id, r, i });
  });
  rest.sort((x, y) => (y.r > x.r ? 1 : y.r < x.r ? -1 : x.i - y.i));
  for (let left = a - given, k = 0; left > BigInt(0); left -= BigInt(1), k += 1) {
    const id = rest[k % rest.length].id;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

type Invoice = { shares: Map<string, Cents>; charge: Cents; gst: Cents; qst: Cents; arTotal: Cents };
type Piece = { categoryId: string; totalCents: Cents; gstCents: Cents; qstCents: Cents; estimated: boolean };

/** One payment → one piece per income category on its invoice; GST/QST in the invoice's own proportion. */
export function splitPayment(total: Cents, invoice: Invoice | undefined): Piece[] {
  const items = invoice ? [...invoice.shares].filter(([, v]) => v > 0) : [];
  const taxable = items.reduce((s, [, v]) => s + v, 0);
  const charge = Math.max(0, invoice?.charge ?? 0);
  const G = Math.max(0, invoice?.gst ?? 0);
  const Q = Math.max(0, invoice?.qst ?? 0);
  const T = taxable + charge + G + Q;
  if (!invoice || taxable + charge <= 0 || T <= 0) {
    const s = splitTaxesIncluded(total);
    return [{ categoryId: "labour_revenue", totalCents: total, gstCents: s.gstCents, qstCents: s.qstCents, estimated: true }];
  }
  const gst = divRound(BigInt(total) * BigInt(G), T);
  const qst = divRound(BigInt(total) * BigInt(Q), T);
  const net = total - gst - qst;
  const netWeights = new Map<string, number>(items);
  if (charge > 0) netWeights.set("other_income", (netWeights.get("other_income") ?? 0) + charge);
  const netParts = allocate(net, [...netWeights]);
  const gstParts = allocate(gst, items);
  const qstParts = allocate(qst, items);
  const pieces: Piece[] = [];
  for (const id of netWeights.keys()) {
    const g = gstParts.get(id) ?? 0;
    const q = qstParts.get(id) ?? 0;
    const t = (netParts.get(id) ?? 0) + g + q;
    if (t > 0) pieces.push({ categoryId: id, totalCents: t, gstCents: g, qstCents: q, estimated: false });
  }
  // Tiny payments can round a piece to ≤ 0; fold everything into the largest piece so totals stay exact.
  const sum = pieces.reduce((s, p) => s + p.totalCents, 0);
  if (sum !== total || pieces.some((p) => p.gstCents + p.qstCents > p.totalCents)) {
    const main = items.sort((x, y) => y[1] - x[1])[0]?.[0] ?? "labour_revenue";
    return [{ categoryId: main, totalCents: total, gstCents: Math.min(gst, total), qstCents: Math.min(qst, Math.max(0, total - gst)), estimated: false }];
  }
  return pieces;
}

function slug(s: string) {
  let h = 2166136261;
  for (const ch of norm(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

// ---- the conversion ------------------------------------------------------------------------------------
export function ledgerToRows(ledger: WaveLedger, cashAccounts?: string[]): { rows: LedgerRow[]; notes: LedgerNote[]; months: MonthLine[] } {
  const roleOf = new Map(ledger.accounts.map((a) => [a.name, a.role]));
  const cashSet = new Set(cashAccounts ?? ledger.accounts.filter((a) => a.role === "cash").map((a) => a.name));
  const of = (role: AccountRole) => ledger.lines.filter((l) => roleOf.get(l.account) === role);
  const net = (l: LedgerLine, side: "credit" | "debit") => (side === "credit" ? l.creditCents - l.debitCents : l.debitCents - l.creditCents);

  // Invoices.
  const invoices = new Map<string, Invoice>();
  const inv = (n: string) => { let v = invoices.get(n); if (!v) { v = { shares: new Map(), charge: 0, gst: 0, qst: 0, arTotal: 0 }; invoices.set(n, v); } return v; };
  for (const l of of("sales")) {
    const m = l.description.match(INVOICE_LINE);
    if (!m) continue;
    const v = inv(m[2]);
    const cat = itemCategory(m[3]);
    v.shares.set(cat, (v.shares.get(cat) ?? 0) + net(l, "credit"));
  }
  for (const role of ["gst", "qst", "invoice_charge"] as const) {
    for (const l of of(role)) {
      const m = l.description.match(INVOICE_LINE) ?? l.description.match(INVOICE_HEAD);
      if (!m) continue;
      const v = inv(m[2]);
      if (role === "gst") v.gst += net(l, "credit"); else if (role === "qst") v.qst += net(l, "credit"); else v.charge += net(l, "credit");
    }
  }
  // What the client paid on each invoice, per (description, date): tells a card fee apart from a cash payment.
  const arPaid = new Map<string, Cents[]>();
  for (const l of of("receivable")) {
    const m = l.description.match(INVOICE_HEAD);
    if (m && l.debitCents > 0) inv(m[2]).arTotal += l.debitCents;
    if (l.creditCents > 0 && PAYMENT.test(l.description)) {
      const k = `${norm(l.description)}|${l.date}`;
      arPaid.set(k, [...(arPaid.get(k) ?? []), l.creditCents]);
    }
  }
  // Deposits: which invoice each client's deposit went to.
  const depositInvoices = new Map<string, string[]>();
  for (const l of of("customer_credits")) {
    const d = describe(l.description);
    if (d.invoice && l.debitCents > 0) depositInvoices.set(norm(d.party), [...(depositInvoices.get(norm(d.party)) ?? []), d.invoice]);
  }
  // Card fees, per (description, date), reversals cancelled.
  const fees = new Map<string, Cents[]>();
  {
    const feeLines = of("merchant_fees").map((l) => ({ l, amount: l.debitCents - l.creditCents, used: false }));
    for (const c of feeLines) {
      if (c.amount >= 0 || c.used) continue;
      const d = feeLines.find((x) => !x.used && x !== c && x.amount === -c.amount && norm(x.l.description) === norm(c.l.description));
      if (d) { d.used = true; c.used = true; }
    }
    for (const f of feeLines) {
      if (f.used || f.amount <= 0) continue;
      const k = `${norm(f.l.description)}|${f.l.date}`;
      fees.set(k, [...(fees.get(k) ?? []), f.amount]);
    }
  }

  // Cash lines.
  type Cash = { l: LedgerLine; amount: Cents; done: boolean; occ: number };
  const occurrences = new Map<string, number>();
  const cash: Cash[] = ledger.lines.filter((l) => cashSet.has(l.account)).map((l) => {
    const amount = l.debitCents - l.creditCents;
    const k = `${l.account}|${l.date}|${norm(l.description)}|${amount}`;
    const occ = occurrences.get(k) ?? 0;
    occurrences.set(k, occ + 1);
    return { l, amount, done: false, occ };
  }).filter((c) => c.amount !== 0);
  const notes: LedgerNote[] = [];
  const note = (type: LedgerNote["type"], c: Cash, cents: Cents) => notes.push({ type, date: c.l.date, account: c.l.account, description: c.l.description, cents });

  // 1) A payment entered then taken back (same account, same description, same amount) cancels out.
  for (const c of cash) {
    if (c.amount >= 0 || c.done) continue;
    const d = cash.filter((x) => !x.done && x.amount === -c.amount && x.l.account === c.l.account && norm(x.l.description) === norm(c.l.description) && x.l.date <= c.l.date)
      .sort((x, y) => (y.l.date < x.l.date ? -1 : 1))[0];
    if (d) { d.done = true; c.done = true; note("reversal", c, -c.amount); }
  }
  // 2) Money moved between two of the chosen accounts isn't income or spending.
  for (const c of cash) {
    if (c.amount >= 0 || c.done) continue;
    const d = cash.find((x) => !x.done && x.amount === -c.amount && x.l.account !== c.l.account && x.l.date === c.l.date);
    if (d && (TRANSFER.test(c.l.description) || TRANSFER.test(d.l.description) || norm(c.l.description) === norm(d.l.description))) { d.done = true; c.done = true; note("transfer", c, -c.amount); }
  }
  // 3) Money given back on an invoice comes off that invoice's payment.
  const adjust = new Map<Cash, Cents>();
  for (const c of cash) {
    if (c.amount >= 0 || c.done) continue;
    const d = describe(c.l.description);
    if (!d.invoice) continue;
    const pay = cash.filter((x) => !x.done && x.amount > 0 && describe(x.l.description).invoice === d.invoice && x.l.date <= c.l.date && x.amount + (adjust.get(x) ?? 0) >= -c.amount)
      .sort((x, y) => (y.l.date < x.l.date ? -1 : y.l.date > x.l.date ? 1 : y.amount - x.amount))[0];
    if (pay) { adjust.set(pay, (adjust.get(pay) ?? 0) + c.amount); c.done = true; note("refund-netted", c, -c.amount); }
  }

  const rows: LedgerRow[] = [];
  const keyBase = (c: Cash) => `gl|${slug(c.l.account)}|${slug(c.l.description)}|${c.occ}`;
  for (const c of cash) {
    if (c.done) continue;
    const d = describe(c.l.description);
    if (c.amount < 0) {
      const cents = -c.amount;
      if (TRANSFER.test(c.l.description)) { note("transfer", c, cents); continue; }
      if (d.invoice) note("refund", c, cents);
      rows.push({
        line: c.l.line, date: c.l.date, kind: "out", totalCents: cents, gstCents: 0, qstCents: 0,
        categoryId: "other_expenses", party: d.party, description: `${d.invoice ? `Refund – Invoice #${d.invoice}` : c.l.description} (Wave · ${c.l.account})`,
        account: c.l.account, invoice: d.invoice, estimated: false, key: `wave|${c.l.date}|out|${cents}|${keyBase(c)}`,
      });
      continue;
    }
    if (!d.invoice && !d.deposit && TRANSFER.test(c.l.description)) { note("transfer", c, c.amount); continue; }
    const paid = c.amount + (adjust.get(c) ?? 0);
    if (paid <= 0) continue;
    // Card fee: Wave Payments deposits arrive minus the fee; the client paid deposit + fee.
    let fee = 0;
    const k = `${norm(c.l.description)}|${c.l.date}`;
    const feeList = fees.get(k) ?? [];
    const arList = arPaid.get(k) ?? [];
    const arIdx = arList.indexOf(c.amount);
    if (arIdx >= 0) arList.splice(arIdx, 1);
    else {
      const fi = feeList.findIndex((f) => arList.includes(c.amount + f));
      const pick = fi >= 0 ? fi : !arList.length && /wave|stripe|square|paypal/i.test(c.l.account) && feeList.length ? 0 : -1;
      if (pick >= 0) {
        fee = feeList.splice(pick, 1)[0];
        const ai = arList.indexOf(c.amount + fee);
        if (ai >= 0) arList.splice(ai, 1);
      }
    }
    let invoiceNo = d.invoice;
    if (!invoiceNo && d.deposit) invoiceNo = depositInvoices.get(norm(d.party))?.shift() ?? null;
    const gross = paid + fee;
    const invoice = invoiceNo ? invoices.get(invoiceNo) : undefined;
    const label = d.invoice ? `Payment for Invoice #${d.invoice}` : d.deposit ? `Deposit${invoiceNo ? ` – Invoice #${invoiceNo}` : ""}` : c.l.description;
    const pieces = splitPayment(gross, invoice);
    if (pieces.some((p) => p.estimated)) note("no-invoice", c, gross);
    for (const p of pieces) {
      rows.push({
        line: c.l.line, date: c.l.date, kind: "in", totalCents: p.totalCents, gstCents: p.gstCents, qstCents: p.qstCents,
        categoryId: p.categoryId, party: d.party || "", description: `${label} (Wave · ${c.l.account})`,
        account: c.l.account, invoice: invoiceNo, estimated: p.estimated, key: `wave|${c.l.date}|in|${p.totalCents}|${keyBase(c)}|${p.categoryId}`,
      });
    }
    if (fee > 0) {
      rows.push({
        line: c.l.line, date: c.l.date, kind: "out", totalCents: fee, gstCents: 0, qstCents: 0,
        categoryId: "bank_fees", party: c.l.account, description: `Card processing fee – ${label}`,
        account: c.l.account, invoice: invoiceNo, estimated: false, key: `wave|${c.l.date}|out|${fee}|${keyBase(c)}|fee`,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line));

  // Month by month, next to what Wave's own Profit & Loss counts (sales before taxes, card fees).
  const months = new Map<string, MonthLine>();
  const month = (m: string) => { let v = months.get(m); if (!v) { v = { month: m, inCount: 0, inCents: 0, inNetCents: 0, outCount: 0, outCents: 0, waveIncomeCents: 0, waveFeesCents: 0 }; months.set(m, v); } return v; };
  for (const r of rows) {
    const v = month(r.date.slice(0, 7));
    if (r.kind === "in") { v.inCount += 1; v.inCents += r.totalCents; v.inNetCents += r.totalCents - r.gstCents - r.qstCents; }
    else { v.outCount += 1; v.outCents += r.totalCents; }
  }
  for (const l of of("sales")) month(l.date.slice(0, 7)).waveIncomeCents += net(l, "credit");
  for (const l of of("merchant_fees")) month(l.date.slice(0, 7)).waveFeesCents += net(l, "debit");
  return { rows, notes, months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)) };
}
