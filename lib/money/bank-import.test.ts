import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./categories";
import { bankMatchKey, classifyBankLines, ruleFor, summarizeTreatments, type BankRule, type ClassifyContext } from "./bank-import";
import { importKeys, type ImportRow } from "./matching";
import { splitByMode, splitGstOnlyIncluded } from "./tax";
import type { MoneyCategory, MoneyEntry } from "./types";

const categories: MoneyCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({ id: c.id, kind: c.kind, en: c.en, fr: c.fr, icon: c.icon, sortOrder: i, needsReceipt: false, taxable: c.taxable, taxMode: c.taxable ? "gst_qst" : "none", active: true }));
let n = 0;
const entry = (p: Partial<MoneyEntry> & Pick<MoneyEntry, "kind" | "date" | "categoryId" | "totalCents">): MoneyEntry => ({
  id: `m${++n}`, party: "", description: "", gstCents: 0, qstCents: 0, netCents: p.totalCents, taxesIncluded: false, paymentMethod: null, paid: true, paidOn: null,
  receiptPath: null, receiptRef: "", recurringId: null, occurrenceDate: null, source: "manual", importKey: null, createdBy: null, createdAt: "", updatedBy: null, updatedAt: "", deletedAt: null, deletedBy: null, ...p,
});
const line = (date: string, kind: "in" | "out", dollars: number, description: string): ImportRow => ({ date, kind, totalCents: Math.round(dollars * 100), description, party: "" });
const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({ existing: [], rules: [], memory: [], categories, incomeFromWave: true, ...over });
const run = (lines: ImportRow[], c: ClassifyContext = ctx()) => classifyBankLines(lines, importKeys(lines, "bank"), c);

describe("not expenses, not income", () => {
  it("detects own credit-card payments, transfers between own accounts, Wave payouts and GST/QST payments", () => {
    const r = run([
      line("2026-11-03", "out", 1500, "PAIEMENT VISA DESJARDINS"),
      line("2026-11-03", "in", 1500, "PAIEMENT - MERCI"),
      line("2026-11-04", "out", 2000, "Virement entre comptes /EOP 123"),
      line("2026-11-04", "out", 300, "TFR-TO 0123456 SAVINGS"),
      line("2026-11-05", "in", 4862.31, "WAVE PAYMENTS PAYOUT"),
      line("2026-11-06", "out", 3120.55, "REVENU QUEBEC TPS/TVQ"),
      line("2026-11-06", "out", 812, "RECEIVER GENERAL GST/HST"),
      line("2026-11-07", "in", 900, "VIREMENT INTERAC CLIENT"),
    ]);
    expect(r.map((x) => [x.treatment, x.reason])).toEqual([
      ["transfer", "card-payment"], ["transfer", "card-payment"], ["transfer", "own-transfer"], ["transfer", "own-transfer"],
      ["transfer", "wave-payout"], ["tax-payment", "tax-agency"], ["tax-payment", "tax-agency"], ["income", "from-wave"],
    ]);
  });
  it("an Interac e-transfer to a person is NOT treated as a transfer between own accounts", () => {
    expect(run([line("2026-11-07", "out", 250, "VIREMENT INTERAC A JEAN TREMBLAY")])[0].treatment).toBe("review");
  });
  it("a Wave subscription charge is an expense question, not a payout", () => {
    const [r] = run([line("2026-11-07", "out", 25.29, "WAVE FINANCIAL PRO PLAN")]);
    expect(r).toMatchObject({ treatment: "review", reason: "suggested", suggestion: "phone_software" });
  });
  it("loans and owner draws are never guessed", () => {
    expect(run([line("2026-11-08", "out", 742.1, "PRET AUTO DESJARDINS"), line("2026-11-08", "out", 2000, "RETRAIT PROPRIETAIRE")]).map((x) => x.reason)).toEqual(["loan", "owner"]);
  });
  it("money in is counted from Wave, not the bank (unless Wave isn't used)", () => {
    expect(run([line("2026-11-09", "in", 500, "DEPOT MOBILE")])[0].treatment).toBe("income");
    expect(run([line("2026-11-09", "in", 500, "DEPOT MOBILE")], ctx({ incomeFromWave: false }))[0].treatment).toBe("review");
  });
});

describe("remembered choices", () => {
  it("“Transfer / not an expense” is remembered for similar lines", () => {
    const rules: BankRule[] = [{ matchKey: bankMatchKey("VIREMENT INTERAC A JEAN TREMBLAY"), kind: "out", action: "transfer", categoryId: null, partyName: "", taxMode: null }];
    expect(bankMatchKey("VIREMENT INTERAC A JEAN TREMBLAY 12345")).toBe("virement interac a");
    const r = run([line("2026-12-01", "out", 250, "VIREMENT INTERAC A JEAN TREMBLAY 998877"), line("2026-12-01", "in", 250, "VIREMENT INTERAC A JEAN TREMBLAY")], ctx({ rules }));
    expect(r.map((x) => x.treatment)).toEqual(["transfer", "income"]); // rules are per direction
  });
  it("a category rule names the supplier and keeps its tax exception", () => {
    const rules: BankRule[] = [{ matchKey: "fleetpride us inc", kind: "out", action: "category", categoryId: "parts_purchases", partyName: "FleetPride (US)", taxMode: "none" }];
    expect(ruleFor(rules, "out", "FLEETPRIDE US INC 4412")).toBeTruthy();
    expect(run([line("2026-12-02", "out", 410.5, "FLEETPRIDE US INC 4412")], ctx({ rules }))[0]).toMatchObject({ treatment: "expense", reason: "rule", categoryId: "parts_purchases", party: "FleetPride (US)", taxMode: "none" });
  });
  it("supplier memory recognizes bank text and categorizes automatically", () => {
    const memory = [{ name: "Petro-Canada", categoryId: "fuel" }];
    expect(run([line("2026-12-03", "out", 114.98, "PETRO-CAN #1234 VAUDREUIL QC")], ctx({ memory }))[0]).toMatchObject({ treatment: "expense", reason: "remembered", categoryId: "fuel", party: "Petro-Canada", taxMode: "gst_qst" });
  });
  it("a keyword alone is only a suggestion: it waits in 'To review'", () => {
    expect(run([line("2026-12-03", "out", 114.98, "PETRO-CAN #1234 VAUDREUIL QC")])[0]).toMatchObject({ treatment: "review", reason: "suggested", suggestion: "fuel", categoryId: null });
    expect(run([line("2026-12-03", "out", 55, "XYZ HOLDINGS 9981")])[0]).toMatchObject({ treatment: "review", reason: "unknown" });
  });
});

describe("bills logged by hand", () => {
  const bill = entry({ kind: "out", date: "2026-11-20", categoryId: "parts_purchases", totalCents: 34567, party: "NAPA Pièces d'auto", paid: false });
  it("same supplier, same total, within 7 days → that bill is marked paid instead of a new expense", () => {
    const [r] = run([line("2026-11-25", "out", 345.67, "NAPA PIECES D AUTO 0421")], ctx({ existing: [bill] }));
    expect(r).toMatchObject({ treatment: "bill", billId: bill.id, categoryId: "parts_purchases" });
  });
  it("not when the total, the dates or the supplier differ; each bill matches once", () => {
    expect(run([line("2026-11-25", "out", 345.68, "NAPA PIECES")], ctx({ existing: [bill] }))[0].treatment).not.toBe("bill");
    expect(run([line("2026-11-28", "out", 345.67, "NAPA PIECES")], ctx({ existing: [bill] }))[0].treatment).not.toBe("bill");
    expect(run([line("2026-11-25", "out", 345.67, "CANADIAN TIRE")], ctx({ existing: [bill] }))[0].treatment).not.toBe("bill");
    expect(run([line("2026-11-25", "out", 345.67, "NAPA PIECES"), line("2026-11-26", "out", 345.67, "NAPA PIECES")], ctx({ existing: [bill] })).map((x) => x.treatment)).toEqual(["bill", "review"]);
    expect(run([line("2026-11-25", "out", 345.67, "NAPA PIECES")], ctx({ existing: [{ ...bill, paid: true }] }))[0].treatment).not.toBe("bill");
  });
});

describe("never doubles", () => {
  it("re-importing the same file, or an overlapping one, finds every line already imported", () => {
    const lines = [line("2026-11-25", "out", 45, "PETRO-CAN 1"), line("2026-11-25", "out", 45, "PETRO-CAN 1"), line("2026-11-26", "out", 12, "TIM HORTONS")];
    const keys = importKeys(lines, "bank");
    const saved = lines.map((l, i) => entry({ kind: "out", date: l.date, categoryId: "fuel", totalCents: l.totalCents, importKey: keys[i], source: "import" }));
    const overlapping = [...lines, line("2026-11-27", "out", 9, "NEW LINE")];
    const r = run(overlapping, ctx({ existing: saved }));
    expect(r.map((x) => x.treatment)).toEqual(["duplicate", "duplicate", "duplicate", "review"]);
  });
  it("a manual entry with the same amount a day apart is flagged, not added again", () => {
    const manual = entry({ kind: "out", date: "2026-11-25", categoryId: "fuel", totalCents: 4500, party: "Petro-Canada" });
    expect(run([line("2026-11-26", "out", 45, "PETRO-CANADA 1234")], ctx({ existing: [manual] }))[0]).toMatchObject({ treatment: "review", reason: "possible-duplicate", matchId: manual.id });
  });
});

describe("taxes by category", () => {
  it("each category has its default; a line can be an exception (US supplier, GST only)", () => {
    const r = run([line("2026-12-04", "out", 114.98, "PETRO-CANADA"), line("2026-12-04", "out", 300, "INTACT ASSURANCE")], ctx({ memory: [{ name: "Petro-Canada", categoryId: "fuel" }, { name: "Intact Assurance", categoryId: "insurance" }] }));
    expect(r.map((x) => x.taxMode)).toEqual(["gst_qst", "none"]);
    expect(splitByMode(11498, "gst_qst")).toEqual({ netCents: 10000, gstCents: 500, qstCents: 998, totalCents: 11498 });
    expect(splitByMode(30000, "none")).toEqual({ netCents: 30000, gstCents: 0, qstCents: 0, totalCents: 30000 });
    expect(splitGstOnlyIncluded(10500)).toEqual({ netCents: 10000, gstCents: 500, qstCents: 0, totalCents: 10500 });
    for (let t = 1; t <= 50000; t += 7) {
      const s = splitGstOnlyIncluded(t);
      expect(s.netCents + s.gstCents).toBe(t);
      expect(Math.abs(s.gstCents - s.netCents * 0.05)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe("summary before saving", () => {
  it("counts and totals each kind of line", () => {
    const s = summarizeTreatments([{ treatment: "expense", totalCents: 100 }, { treatment: "expense", totalCents: 250 }, { treatment: "transfer", totalCents: 5000 }]);
    expect(s.expense).toEqual({ count: 2, cents: 350 });
    expect(s.transfer).toEqual({ count: 1, cents: 5000 });
    expect(s.review).toEqual({ count: 0, cents: 0 });
  });
});
