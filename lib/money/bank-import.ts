// Bank / credit-card CSV → what each line is. Pure logic, fully tested; used by the import route.
//
// Each line becomes exactly one of:
//   expense       a new "money out" entry (category known: remembered supplier or a rule you made)
//   bill          pays a bill you logged by hand (same supplier, same total, ±7 days) → that bill is marked paid
//   tax-payment   GST/QST sent to Revenu Québec / CRA → recorded in Taxes as "sent", never an expense
//   transfer      not an expense or income: own credit-card payment, transfer between own accounts, Wave payout,
//                 or a line you marked "Transfer / not an expense" before
//   income        money in that already comes from Wave (ignored)
//   duplicate     already imported (same line from an earlier or overlapping file)
//   review        unclear: needs you (keyword guesses, loans, owner draws, possible duplicates…). Never guessed.
//   skip          (set by the person) not saved
import type { Cents } from "./cents";
import type { MoneyKind } from "./categories";
import { daysBetween, type ISODate } from "./dates";
import { checkDuplicates, guessParty, keywordCategory, rememberedCategory, similarity, type ImportRow, type PartyMemory } from "./matching";
import type { TaxMode } from "./tax";
import type { MoneyCategory, MoneyEntry } from "./types";

export type Treatment = "expense" | "bill" | "tax-payment" | "transfer" | "income" | "duplicate" | "review" | "skip";
export type Reason =
  | "remembered" | "rule" | "bill-match" | "card-payment" | "own-transfer" | "wave-payout" | "tax-agency" | "from-wave"
  | "already-imported" | "suggested" | "unknown" | "loan" | "owner" | "possible-duplicate" | "refund" | "tax-refund";
export type BankRule = { matchKey: string; kind: MoneyKind; action: "category" | "transfer"; categoryId: string | null; partyName: string; taxMode: TaxMode | null };
export type Classified = {
  treatment: Treatment; reason: Reason; categoryId: string | null; suggestion: string | null; party: string; taxMode: TaxMode;
  billId: string | null; matchId: string | null; matchKey: string;
};

/** Lowercase, accents and digits removed, every word kept (so "paiement visa" stays visible). */
export function plainWords(text: string): string[] {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((w) => w.length > 0 && !/\d/.test(w));
}
/** The first three words of a bank line: how a remembered choice is recognized next time. */
export function bankMatchKey(description: string): string {
  return plainWords(description).slice(0, 3).join(" ");
}
const has = (text: string, re: RegExp) => re.test(` ${plainWords(text).join(" ")} `);

const CARD_PAYMENT = / (paiement|payment|pmt|pymt|pyt)( \w+){0,3} (visa|mastercard|master card|amex|american express|carte de credit|credit card|cc) |(payment|paiement) (thank you|merci|recu|received)|merci pour votre paiement|thank you for your payment|paiement carte credit| paiement visa | payment visa /;
const OWN_TRANSFER = / (virement|transfert|transfer|tfr|trf)( \w+){0,2} (entre|between) (vos |mes |your |my )?(comptes|accounts)|(transfer|tfr|trf) (to|from|fr|vers|de) (chequing|cheque|savings|epargne|account|acct|compte|folio)|virement (au|du|vers le|de) (compte|folio)|own account|mes comptes|internet transfer /;
const WAVE = / (wave|waveapps|wave payments|wave payment|wave financial|wave pay) /;
const TAX_AGENCY = / (revenu quebec|revenu qc|ministere du revenu|mrq|receiver general|receveur general|agence du revenu|canada revenue|cra|arc|gst hst|tps tvq|gst qst) /;
const LOAN = / (pret|loan|hypotheque|mortgage|financement|financing|remboursement pret|loan payment|marge de credit|line of credit) /;
const OWNER = / (retrait proprietaire|prelevement proprietaire|owner draw|drawings|apport|contribution|dividende|dividend|avance actionnaire|shareholder) /;

export function ruleFor(rules: BankRule[], kind: MoneyKind, description: string): BankRule | null {
  const words = plainWords(description).join(" ");
  return rules.filter((r) => r.kind === kind && (words === r.matchKey || words.startsWith(`${r.matchKey} `)))
    .sort((a, b) => b.matchKey.length - a.matchKey.length)[0] ?? null;
}

export type ClassifyContext = {
  existing: MoneyEntry[];
  rules: BankRule[];
  memory: PartyMemory[];
  categories: MoneyCategory[];
  /** Income is synced from Wave: money in on the bank is not counted again. */
  incomeFromWave: boolean;
};

export function classifyBankLines(lines: ImportRow[], keys: string[], ctx: ClassifyContext): Classified[] {
  const dup = checkDuplicates(lines, keys, ctx.existing);
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const valid = { in: new Set(ctx.categories.filter((c) => c.active && c.kind === "in").map((c) => c.id)), out: new Set(ctx.categories.filter((c) => c.active && c.kind === "out").map((c) => c.id)) };
  const modeOf = (id: string | null): TaxMode => (id && byId.get(id)?.taxMode) || "gst_qst";
  const known = [...ctx.memory.map((m) => m.name), ...ctx.existing.map((e) => e.party).filter(Boolean)];
  const bills = ctx.existing.filter((e) => !e.deletedAt && e.kind === "out" && !e.paid);
  const claimedBills = new Set<string>();

  return lines.map((line, i) => {
    const text = `${line.party} ${line.description}`;
    const matchKey = bankMatchKey(line.description || line.party);
    const party = line.party || guessParty(line.description, known);
    const base = { matchKey, party, billId: null, matchId: dup[i].matchId, suggestion: null } as const;
    const make = (treatment: Treatment, reason: Reason, categoryId: string | null = null, extra: Partial<Classified> = {}): Classified =>
      ({ ...base, treatment, reason, categoryId, taxMode: modeOf(categoryId ?? extra.suggestion ?? null), ...extra });

    if (dup[i].status === "already-imported") return make("duplicate", "already-imported");
    const rule = ruleFor(ctx.rules, line.kind, text);
    if (rule?.action === "transfer") return make("transfer", "rule");

    // The obvious "not income, not an expense" lines.
    if (has(text, CARD_PAYMENT)) return make("transfer", "card-payment");
    if (has(text, OWN_TRANSFER)) return make("transfer", "own-transfer");
    if (line.kind === "in" && has(text, WAVE)) return make("transfer", "wave-payout");
    if (has(text, TAX_AGENCY)) return line.kind === "out" ? make("tax-payment", "tax-agency") : make("review", "tax-refund");

    if (rule?.action === "category" && rule.categoryId && valid[line.kind].has(rule.categoryId)) {
      return make("expense", "rule", rule.categoryId, { party: rule.partyName || party, taxMode: rule.taxMode ?? modeOf(rule.categoryId) });
    }
    if (has(text, LOAN)) return make("review", "loan");
    if (has(text, OWNER)) return make("review", "owner");

    if (line.kind === "in") {
      const supplier = rememberedCategory(text, "out", ctx.memory, ctx.existing, valid.out);
      if (supplier) return make("review", "refund", null, { suggestion: supplier });
      if (ctx.incomeFromWave) return make("income", "from-wave");
    }

    // Pays a bill logged by hand: same total, ±7 days, same supplier.
    if (line.kind === "out") {
      const candidates = bills
        .filter((b) => b.totalCents === line.totalCents && Math.abs(daysBetween(b.date, line.date as ISODate)) <= 7
          && (b.party ? similarity(b.party, text) >= 0.5 || similarity(b.party, party) >= 0.5 : false))
        .sort((a, b) => Math.abs(daysBetween(a.date, line.date as ISODate)) - Math.abs(daysBetween(b.date, line.date as ISODate)));
      const bill = candidates.find((b) => !claimedBills.has(b.id));
      if (bill) {
        claimedBills.add(bill.id);
        return make("bill", "bill-match", bill.categoryId, { billId: bill.id, party: bill.party, matchId: bill.id });
      }
      // Same bill already paid by another line of this file: ask instead of adding a second expense.
      if (candidates.length) return make("review", "possible-duplicate", null, { matchId: candidates[0].id, suggestion: candidates[0].categoryId });
    }
    if (dup[i].status === "possible") return make("review", "possible-duplicate");

    const remembered = rememberedCategory(text, line.kind, ctx.memory, ctx.existing, valid[line.kind]);
    if (remembered) return make("expense", "remembered", remembered);
    const guess = keywordCategory(text, line.kind, valid[line.kind]);
    if (guess) return make("review", "suggested", null, { suggestion: guess });
    return make("review", "unknown");
  });
}

export type BankSummary = Record<Treatment, { count: number; cents: Cents }>;
export function summarizeTreatments(items: Array<{ treatment: Treatment; totalCents: Cents }>): BankSummary {
  const out = Object.fromEntries((["expense", "bill", "tax-payment", "transfer", "income", "duplicate", "review", "skip"] as Treatment[]).map((t) => [t, { count: 0, cents: 0 }])) as BankSummary;
  for (const it of items) { out[it.treatment].count += 1; out[it.treatment].cents += it.totalCents; }
  return out;
}
