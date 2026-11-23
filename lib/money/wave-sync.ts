// Wave → Money sync: the plan. Pure logic (no network, no database) so every rule is tested with recorded samples.
//
// What Wave's public API lets us read: invoices and estimates with their lines, taxes and payments (each payment
// has its own ID), and account balances. It does NOT expose expenses, bank-feed transactions or per-payment card
// fees, so: income comes from payments; card fees come from the card-fee account's balance (one entry per sync day).
//
// Exactly once: every Money entry made by the sync carries a unique wave_key:
//   wp:<paymentId>:<categoryId>   one piece of a payment (a payment splits into labour / parts / service call…)
//   wr:<paymentId>                a refund that couldn't be taken off its payment
//   fees:<YYYY-MM-DD>             card fees noticed that day
// Entries imported earlier from the Wave CSV are matched (invoice number + date + account + amount) and linked
// instead of being added again.
import { allocate } from "./wave-ledger";
import { divRound, parseMoney, type Cents } from "./cents";
import type { MoneyKind } from "./categories";
import { itemCategory } from "./wave-ledger";
import { splitTaxesIncluded } from "./tax";
import type { ISODate } from "./dates";

// ---- Wave data, as the server client normalizes it ------------------------------------------------------
export type WaveAccountRef = { id: string; name: string; subtype: string | null };
export type WaveLineTax = { taxId: string; name: string; abbreviation: string; cents: Cents };
export type WaveLine = { productId: string | null; productName: string | null; account: WaveAccountRef | null; description: string; subtotalCents: Cents; taxes: WaveLineTax[] };
export type WavePayment = {
  id: string; date: ISODate; amountCents: Cents; account: WaveAccountRef | null; method: string | null;
  active: boolean; transactionType: string | null; originPaymentId: string | null;
};
export type WaveDoc = {
  kind: "invoice" | "estimate"; id: string; number: string; date: ISODate; customer: string;
  subtotalCents: Cents; discountCents: Cents; lines: WaveLine[]; payments: WavePayment[];
};

// ---- Money side -----------------------------------------------------------------------------------------
export type ExistingEntry = {
  id: string; kind: MoneyKind; date: ISODate; categoryId: string; party: string; description: string;
  totalCents: Cents; gstCents: Cents; qstCents: Cents; source: string; importKey: string | null; waveKey: string | null; deleted: boolean;
};
export type MapRow = { ref: string; kind: "item" | "tax"; label: string; suggested: string | null; categoryId: string | null };
export type ReviewResolution = "added" | "ignored" | "fixed";

export type DesiredRow = {
  wave_key: string; wave_payment_id: string; kind: MoneyKind; date: ISODate; category_id: string; party: string; description: string;
  total_cents: Cents; gst_cents: Cents; qst_cents: Cents; payment_method: string | null;
};
export type Op =
  | { op: "insert"; row: DesiredRow }
  | { op: "update"; id: string; row: DesiredRow; before: ExistingEntry }
  | { op: "link"; id: string; wave_key: string; wave_payment_id: string }
  | { op: "trash"; id: string; before: ExistingEntry };
export type ReviewKind = "unmapped" | "closed-month" | "gap" | "unmatched" | "refund" | "fees";
export type ReviewItem = { ref: string; kind: ReviewKind; title: string; details: Record<string, unknown>; amountCents: Cents | null };
export type MonthCheck = { month: string; waveCents: Cents; moneyCents: Cents; waitingCents: Cents; gapCents: Cents };

export type PlanInput = {
  docs: WaveDoc[];
  map: MapRow[];
  existing: ExistingEntry[];
  locks: Set<string>;
  /** Payments before this date are ignored (the start of the year that was imported from the CSV). */
  syncFrom: ISODate;
  /** Payments up to this date were already imported from the CSV: they must be matched, never added blindly. */
  csvUntil: ISODate | null;
  /** Review items the person already decided on (ref → decision). */
  decisions: Map<string, ReviewResolution>;
  fees: { balanceCents: Cents | null; baselineCents: Cents | null };
  today: ISODate;
};
export type Plan = {
  ops: Op[];
  review: ReviewItem[];
  newMapRows: MapRow[];
  months: MonthCheck[];
  counts: { added: number; updated: number; linked: number; trashed: number; flagged: number; payments: number; waiting: number };
  feeDeltaCents: Cents;
};

const CASH_SUBTYPES = new Set(["CASH_AND_BANK", "MONEY_IN_TRANSIT"]);
const month = (d: ISODate) => d.slice(0, 7);

export function taxRole(t: { abbreviation: string; name: string }): "gst" | "qst" | "charge" {
  const s = `${t.abbreviation} ${t.name}`.toLowerCase();
  if (/\b(gst|tps|hst|tvh)\b/.test(s)) return "gst";
  if (/\b(qst|tvq)\b/.test(s)) return "qst";
  return "charge";
}
export const lineRef = (l: WaveLine) => (l.productId ? `product:${l.productId}` : l.account ? `account:${l.account.id}` : `line:${l.description.trim().toLowerCase().slice(0, 60)}`);
const lineLabel = (l: WaveLine) => l.productName || l.account?.name || l.description || "—";

export function paymentMethod(method: string | null): string | null {
  const m = (method ?? "").toLowerCase();
  if (!m) return null;
  if (m.includes("credit") || m.includes("card")) return "credit";
  if (m.includes("bank") || m.includes("transfer") || m.includes("ach") || m.includes("eft") || m.includes("interac")) return "transfer";
  if (m.includes("cheque") || m.includes("check")) return "cheque";
  if (m.includes("cash")) return "cash";
  return "other";
}

/** Splits what the client paid into one piece per Money category, with the document's own GST / QST proportion. */
export function splitDoc(gross: Cents, items: Map<string, Cents>, charges: Map<string, Cents>, gstTotal: Cents, qstTotal: Cents) {
  const itemTotal = [...items.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const chargeTotal = [...charges.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const G = Math.max(0, gstTotal);
  const Q = Math.max(0, qstTotal);
  const T = itemTotal + chargeTotal + G + Q;
  if (T <= 0 || itemTotal + chargeTotal <= 0) return null;
  const gst = divRound(BigInt(gross) * BigInt(G), T);
  const qst = divRound(BigInt(gross) * BigInt(Q), T);
  const weights = new Map<string, number>();
  for (const [k, v] of items) if (v > 0) weights.set(k, (weights.get(k) ?? 0) + v);
  for (const [k, v] of charges) if (v > 0) weights.set(k, (weights.get(k) ?? 0) + v);
  const netParts = allocate(gross - gst - qst, [...weights]);
  const taxWeights = [...items].filter(([, v]) => v > 0);
  const gstParts = allocate(gst, taxWeights);
  const qstParts = allocate(qst, taxWeights);
  const pieces = [...weights.keys()].map((id) => {
    const g = gstParts.get(id) ?? 0;
    const q = qstParts.get(id) ?? 0;
    return { categoryId: id, totalCents: (netParts.get(id) ?? 0) + g + q, gstCents: g, qstCents: q };
  }).filter((p) => p.totalCents > 0);
  const sum = pieces.reduce((s, p) => s + p.totalCents, 0);
  if (sum !== gross || pieces.some((p) => p.gstCents + p.qstCents > p.totalCents)) {
    const main = [...weights].sort((a, b) => b[1] - a[1])[0][0];
    return [{ categoryId: main, totalCents: gross, gstCents: Math.min(gst, gross), qstCents: Math.min(qst, gross - Math.min(gst, gross)) }];
  }
  return pieces;
}

type CsvGroup = { id: string; date: ISODate; account: string; invoice: string | null; deposit: boolean; totalCents: Cents; entries: ExistingEntry[]; claimed: boolean };

/** Entries imported from the Wave CSV, grouped back into the payments they came from. */
export function csvGroups(existing: ExistingEntry[]): CsvGroup[] {
  const groups = new Map<string, CsvGroup>();
  for (const e of existing) {
    if (e.deleted || e.waveKey || e.kind !== "in" || e.source !== "import" || !e.importKey?.startsWith("wave|")) continue;
    const p = e.importKey.split("|");
    if (p[4] !== "gl") continue;
    const id = [p[1], p[5], p[6], p[7]].join("|");
    let g = groups.get(id);
    if (!g) {
      const account = e.description.match(/\(Wave · ([^)]+)\)\s*$/)?.[1] ?? "";
      g = { id, date: e.date, account, invoice: e.description.match(/Invoice #(\S+?)(?:\s|$)/)?.[1] ?? null, deposit: /^Deposit/.test(e.description), totalCents: 0, entries: [], claimed: false };
      groups.set(id, g);
    }
    g.totalCents += e.totalCents;
    g.entries.push(e);
  }
  return [...groups.values()];
}

export function planSync(input: PlanInput): Plan {
  const mapByRef = new Map(input.map.map((m) => [m.ref, m]));
  const newMapRows: MapRow[] = [];
  const review = new Map<string, ReviewItem>();
  const flag = (item: ReviewItem) => { if (input.decisions.get(item.ref) !== "ignored") review.set(item.ref, item); };
  const ensureRef = (ref: string, kind: "item" | "tax", label: string, suggested: string) => {
    let m = mapByRef.get(ref);
    if (!m) { m = { ref, kind, label, suggested, categoryId: null }; mapByRef.set(ref, m); newMapRows.push(m); }
    return m.categoryId;
  };

  // 1) Every document → its category weights and taxes (or "waiting for a category").
  type Built = { items: Map<string, Cents>; charges: Map<string, Cents>; gst: Cents; qst: Cents; missing: string[] };
  const built = new Map<string, Built>();
  for (const doc of input.docs) {
    const b: Built = { items: new Map(), charges: new Map(), gst: 0, qst: 0, missing: [] };
    const rawItems: Array<[string, Cents]> = [];
    for (const line of doc.lines) {
      const ref = lineRef(line);
      const cat = ensureRef(ref, "item", lineLabel(line), itemCategory(lineLabel(line)));
      if (!cat) b.missing.push(ref); else rawItems.push([cat, line.subtotalCents]);
      for (const t of line.taxes) {
        const role = taxRole(t);
        if (role === "gst") b.gst += t.cents;
        else if (role === "qst") b.qst += t.cents;
        else {
          const tref = `tax:${t.taxId}`;
          const tcat = ensureRef(tref, "tax", t.name || t.abbreviation, "other_income");
          if (!tcat) b.missing.push(tref); else b.charges.set(tcat, (b.charges.get(tcat) ?? 0) + t.cents);
        }
      }
    }
    // A discount lowers every line in proportion.
    const lineSum = rawItems.reduce((s, [, v]) => s + v, 0);
    const afterDiscount = Math.max(0, lineSum - Math.max(0, doc.discountCents));
    const scaled = allocate(afterDiscount, rawItems.map(([k, v], i) => [`${i}|${k}`, v] as [string, number]));
    for (const [k, v] of scaled) { const cat = k.slice(k.indexOf("|") + 1); b.items.set(cat, (b.items.get(cat) ?? 0) + v); }
    if (!doc.lines.length) b.missing.push(`doc:${doc.kind}:${doc.id}`);
    built.set(`${doc.kind}:${doc.id}`, b);
  }

  // 2) Payments → what Money should contain.
  type Pay = { doc: WaveDoc; p: WavePayment; gross: Cents; refunds: WavePayment[] };
  const pays: Pay[] = [];
  const refunds: Array<{ doc: WaveDoc; p: WavePayment }> = [];
  for (const doc of input.docs) {
    for (const p of doc.payments) {
      if (!p.active || p.date < input.syncFrom) continue;
      if (!p.account || !CASH_SUBTYPES.has(p.account.subtype ?? "")) continue; // deposits applied from credits etc. aren't new money
      const isRefund = p.amountCents < 0 || /refund/i.test(p.transactionType ?? "");
      if (isRefund) refunds.push({ doc, p });
      else if (p.amountCents > 0) pays.push({ doc, p, gross: p.amountCents, refunds: [] });
    }
  }
  const desired: DesiredRow[] = [];
  const waiting = new Map<string, Cents>(); // month → money waiting for a category
  const blockedPayments = new Set<string>();
  for (const r of refunds) {
    const amount = Math.abs(r.p.amountCents);
    const target = pays.find((x) => x.p.id === r.p.originPaymentId && x.gross >= amount);
    if (target) { target.gross -= amount; target.refunds.push(r.p); continue; }
    desired.push({
      wave_key: `wr:${r.p.id}`, wave_payment_id: r.p.id, kind: "out", date: r.p.date, category_id: "other_expenses", party: r.doc.customer,
      description: `Refund – ${r.doc.kind === "invoice" ? `Invoice #${r.doc.number}` : `Estimate #${r.doc.number}`} (Wave · ${r.p.account?.name ?? ""})`,
      total_cents: amount, gst_cents: 0, qst_cents: 0, payment_method: paymentMethod(r.p.method),
    });
  }
  const pieceRows = new Map<string, DesiredRow[]>(); // payment id → its pieces
  for (const x of pays) {
    if (x.gross <= 0) continue;
    const b = built.get(`${x.doc.kind}:${x.doc.id}`)!;
    if (b.missing.length) {
      blockedPayments.add(x.p.id);
      waiting.set(month(x.p.date), (waiting.get(month(x.p.date)) ?? 0) + x.gross);
      for (const ref of b.missing) {
        const m = mapByRef.get(ref);
        const prev = review.get(`map:${ref}`);
        flag({ ref: `map:${ref}`, kind: "unmapped", title: m?.label ?? ref, amountCents: (prev?.amountCents ?? 0) + x.gross, details: { ref, suggested: m?.suggested ?? null, payments: ((prev?.details.payments as number) ?? 0) + 1 } });
      }
      continue;
    }
    let pieces = splitDoc(x.gross, b.items, b.charges, b.gst, b.qst);
    if (!pieces) {
      const s = splitTaxesIncluded(x.gross);
      pieces = [{ categoryId: [...b.items.keys()][0] ?? "labour_revenue", totalCents: x.gross, gstCents: s.gstCents, qstCents: s.qstCents }];
    }
    const label = x.doc.kind === "invoice" ? `Payment for Invoice #${x.doc.number}` : `Deposit – Estimate #${x.doc.number}`;
    const rows = pieces.map((pc) => ({
      wave_key: `wp:${x.p.id}:${pc.categoryId}`, wave_payment_id: x.p.id, kind: "in" as const, date: x.p.date, category_id: pc.categoryId,
      party: x.doc.customer, description: `${label} (Wave · ${x.p.account?.name ?? ""})`,
      total_cents: pc.totalCents, gst_cents: pc.gstCents, qst_cents: pc.qstCents, payment_method: paymentMethod(x.p.method),
    }));
    pieceRows.set(x.p.id, rows);
    desired.push(...rows);
  }

  // 3) Link payments that were already imported from the CSV (never add them twice).
  const ops: Op[] = [];
  const keyed = new Map<string, ExistingEntry>();
  for (const e of input.existing) if (e.waveKey) keyed.set(e.waveKey, e);
  const groups = csvGroups(input.existing);
  const skipInsert = new Set<string>();
  for (const x of pays) {
    const rows = pieceRows.get(x.p.id);
    if (!rows) continue;
    if (rows.some((r) => keyed.has(r.wave_key))) continue; // already synced or linked earlier
    if (input.csvUntil === null || x.p.date > input.csvUntil) continue;
    const account = x.p.account?.name ?? "";
    const candidates = groups.filter((g) => !g.claimed && g.date === x.p.date && g.account === account && g.totalCents === x.gross
      && (x.doc.kind === "invoice" ? g.invoice === x.doc.number : g.deposit));
    const decision = input.decisions.get(`csv:${x.p.id}`);
    if (candidates.length === 1) {
      const g = candidates[0];
      g.claimed = true;
      for (const e of g.entries) {
        const match = rows.find((r) => r.category_id === e.categoryId);
        const key = match ? match.wave_key : `wp:${x.p.id}:${e.categoryId}`;
        ops.push({ op: "link", id: e.id, wave_key: key, wave_payment_id: x.p.id });
        keyed.set(key, { ...e, waveKey: key });
      }
      continue;
    }
    if (decision === "added") continue; // the person said: add it
    for (const r of rows) skipInsert.add(r.wave_key);
    flag({
      ref: `csv:${x.p.id}`, kind: "unmatched", amountCents: x.gross,
      title: `${x.doc.customer} · ${x.doc.kind === "invoice" ? `Invoice #${x.doc.number}` : `Estimate #${x.doc.number}`}`,
      details: { date: x.p.date, account, candidates: candidates.length, reason: candidates.length ? "several-matches" : "not-in-csv" },
    });
  }

  // 4) Compare with what Money has.
  const locked = (d: ISODate) => input.locks.has(month(d));
  const lockedChange = (key: string, before: ExistingEntry | null, after: DesiredRow | null) => {
    const ref = `locked:${key}`;
    if (input.decisions.get(ref) === "ignored") return;
    flag({ ref, kind: "closed-month", title: after?.party || before?.party || key, amountCents: after?.total_cents ?? before?.totalCents ?? null,
      details: { change: !before ? "add" : !after ? "remove" : "change", before: before && { date: before.date, total: before.totalCents, category: before.categoryId }, after: after && { date: after.date, total: after.total_cents, category: after.category_id } } });
  };
  const desiredKeys = new Set(desired.map((d) => d.wave_key));
  for (const d of desired) {
    if (skipInsert.has(d.wave_key)) continue;
    const e = keyed.get(d.wave_key);
    if (!e) {
      if (locked(d.date)) { lockedChange(d.wave_key, null, d); continue; }
      ops.push({ op: "insert", row: d });
      continue;
    }
    if (e.deleted) continue; // removed by a person in Money: respected
    const same = e.date === d.date && e.categoryId === d.category_id && e.totalCents === d.total_cents && e.gstCents === d.gst_cents
      && e.qstCents === d.qst_cents && e.party === d.party && (e.description === d.description || e.source === "import"); // CSV wording is kept
    if (same) continue;
    if (locked(e.date) || locked(d.date)) { lockedChange(d.wave_key, e, d); continue; }
    ops.push({ op: "update", id: e.id, row: d, before: e });
  }
  for (const [key, e] of keyed) {
    if (e.deleted || desiredKeys.has(key) || !/^(wp|wr):/.test(key) || e.date < input.syncFrom) continue;
    const pid = key.split(":")[1];
    if (blockedPayments.has(pid)) continue; // waiting for a category: leave it alone
    if (locked(e.date)) { lockedChange(key, e, null); continue; }
    ops.push({ op: "trash", id: e.id, before: e });
  }

  // 5) Card fees: Wave only gives the fee account's running total. New fees since last time → today's entry.
  let feeDeltaCents = 0;
  if (input.fees.balanceCents !== null && input.fees.baselineCents !== null) {
    const logged = input.existing.filter((e) => !e.deleted && e.waveKey?.startsWith("fees:")).reduce((s, e) => s + e.totalCents, 0);
    feeDeltaCents = input.fees.balanceCents - input.fees.baselineCents - logged;
    const key = `fees:${input.today}`;
    const todayEntry = keyed.get(key);
    if (feeDeltaCents > 0 || (feeDeltaCents < 0 && todayEntry && !todayEntry.deleted && todayEntry.totalCents + feeDeltaCents > 0)) {
      const row: DesiredRow = { wave_key: key, wave_payment_id: "", kind: "out", date: input.today, category_id: "bank_fees", party: "Wave Payments",
        description: "Card processing fees (Wave)", total_cents: (todayEntry && !todayEntry.deleted ? todayEntry.totalCents : 0) + feeDeltaCents, gst_cents: 0, qst_cents: 0, payment_method: null };
      if (locked(input.today)) lockedChange(key, todayEntry ?? null, row);
      else if (todayEntry && !todayEntry.deleted) ops.push({ op: "update", id: todayEntry.id, row, before: todayEntry });
      else if (!todayEntry) ops.push({ op: "insert", row });
    } else if (feeDeltaCents < 0) {
      flag({ ref: `fees:${input.today}`, kind: "fees", title: "Card fees went down in Wave", amountCents: -feeDeltaCents, details: { balance: input.fees.balanceCents, baseline: input.fees.baselineCents, logged } });
    }
  }

  // 6) Safety net: money received per month in Wave vs what Money has from Wave, after this plan.
  const waveByMonth = new Map<string, Cents>();
  for (const x of pays) waveByMonth.set(month(x.p.date), (waveByMonth.get(month(x.p.date)) ?? 0) + x.p.amountCents);
  for (const r of refunds) waveByMonth.set(month(r.p.date), (waveByMonth.get(month(r.p.date)) ?? 0) - Math.abs(r.p.amountCents));
  const after = new Map<string, { kind: MoneyKind; date: ISODate; total: Cents; fromWave: boolean }>();
  for (const e of input.existing) if (!e.deleted) after.set(e.id, { kind: e.kind, date: e.date, total: e.totalCents, fromWave: isWaveIncome(e) });
  let n = 0;
  for (const op of ops) {
    if (op.op === "insert") after.set(`new${n++}`, { kind: op.row.kind, date: op.row.date, total: op.row.total_cents, fromWave: op.row.wave_key.startsWith("wp:") || op.row.wave_key.startsWith("wr:") });
    else if (op.op === "update") after.set(op.id, { kind: op.row.kind, date: op.row.date, total: op.row.total_cents, fromWave: !op.row.wave_key.startsWith("fees:") });
    else if (op.op === "trash") after.delete(op.id);
    else if (op.op === "link") { const v = after.get(op.id); if (v) v.fromWave = true; }
  }
  const moneyByMonth = new Map<string, Cents>();
  for (const v of after.values()) {
    if (!v.fromWave || v.date < input.syncFrom) continue;
    moneyByMonth.set(month(v.date), (moneyByMonth.get(month(v.date)) ?? 0) + (v.kind === "in" ? v.total : -v.total));
  }
  const months = [...new Set([...waveByMonth.keys(), ...moneyByMonth.keys()])].sort().map((m) => {
    const waveCents = waveByMonth.get(m) ?? 0;
    const moneyCents = moneyByMonth.get(m) ?? 0;
    const waitingCents = waiting.get(m) ?? 0;
    return { month: m, waveCents, moneyCents, waitingCents, gapCents: waveCents - waitingCents - moneyCents };
  });
  for (const m of months) {
    if (m.gapCents !== 0) flag({ ref: `gap:${m.month}`, kind: "gap", title: m.month, amountCents: m.gapCents, details: { wave: m.waveCents, money: m.moneyCents, waiting: m.waitingCents } });
  }

  const list = [...review.values()];
  return {
    ops, review: list, newMapRows, months, feeDeltaCents,
    counts: {
      added: ops.filter((o) => o.op === "insert").length, updated: ops.filter((o) => o.op === "update").length,
      linked: ops.filter((o) => o.op === "link").length, trashed: ops.filter((o) => o.op === "trash").length,
      flagged: list.length, payments: pays.length, waiting: blockedPayments.size,
    },
  };
}

/** Money entries that represent Wave income: synced ones, and lines imported from the Wave CSV (not its card-fee lines). */
export function isWaveIncome(e: ExistingEntry): boolean {
  if (e.waveKey) return /^(wp|wr):/.test(e.waveKey);
  if (e.source !== "import" || !e.importKey?.startsWith("wave|")) return false;
  return e.kind === "in" || (e.kind === "out" && e.categoryId !== "bank_fees");
}

// ---- normalizing Wave's GraphQL answers (kept here so the recorded samples are tested too) ---------------
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export function moneyCents(v: unknown): Cents {
  const m = obj(v);
  if (m.minorUnitValue !== undefined && m.minorUnitValue !== null) return Math.round(Number(m.minorUnitValue));
  if (m.value !== undefined) return parseMoney(str(m.value)) ?? 0;
  return 0;
}
function account(v: unknown): WaveAccountRef | null {
  const a = obj(v);
  if (!a.id) return null;
  return { id: str(a.id), name: str(a.name), subtype: str(obj(a.subtype).value) || null };
}
export function normalizeDoc(raw: Raw, kind: "invoice" | "estimate", accounts: Map<string, WaveAccountRef> = new Map()): WaveDoc {
  const acct = (v: unknown, id?: unknown) => { const a = account(v); const key = a?.id ?? (id ? str(id) : ""); const known = key ? accounts.get(key) : undefined; return known ?? a ?? (key ? { id: key, name: "", subtype: null } : null); };
  const items = (Array.isArray(raw.items) ? raw.items : []) as Raw[];
  const payments = (Array.isArray(raw.payments) ? raw.payments : []) as Raw[];
  return {
    kind, id: str(raw.id), number: str(kind === "invoice" ? raw.invoiceNumber : raw.estimateNumber),
    date: str(kind === "invoice" ? raw.invoiceDate : raw.estimateDate).slice(0, 10) as ISODate,
    customer: str(obj(raw.customer).name), subtotalCents: moneyCents(raw.subtotal), discountCents: moneyCents(raw.discountTotal),
    lines: items.map((it) => ({
      productId: obj(it.product).id ? str(obj(it.product).id) : null, productName: obj(it.product).name ? str(obj(it.product).name) : null,
      account: acct(it.account), description: str(it.description), subtotalCents: moneyCents(it.subtotal),
      taxes: ((Array.isArray(it.taxes) ? it.taxes : []) as Raw[]).map((t) => ({ taxId: str(obj(t.salesTax).id), name: str(obj(t.salesTax).name), abbreviation: str(obj(t.salesTax).abbreviation), cents: moneyCents(t.amount) })),
    })),
    payments: payments.map((p) => ({
      id: str(p.id), date: str(p.paymentDate).slice(0, 10) as ISODate, amountCents: parseMoney(str(p.amount)) ?? 0,
      account: acct(p.account, p.paymentAccountId),
      method: str(p.paymentMethod) || null, active: p.active !== false && str(p.state).toUpperCase() !== "VOIDED",
      transactionType: str(p.transactionType) || null, originPaymentId: str(obj(p.originInvoicePayment).id || p.originPaymentId) || null,
    })),
  };
}
