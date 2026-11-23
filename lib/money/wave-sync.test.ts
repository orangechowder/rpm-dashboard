import { describe, expect, it } from "vitest";
import sample from "./__fixtures__/wave-sample.json";
import { csvGroups, isWaveIncome, normalizeDoc, planSync, splitDoc, taxLine, taxRole, type ExistingEntry, type MapRow, type Plan, type PlanInput, type WaveAccountRef, type WaveDoc } from "./wave-sync";

const accounts = new Map<string, WaveAccountRef>(sample.accounts.map((a) => [a.id, { id: a.id, name: a.name, subtype: a.subtype.value }]));
const docs: WaveDoc[] = [
  ...sample.invoices.map((r) => normalizeDoc(r as Record<string, unknown>, "invoice", accounts)),
  ...sample.estimates.map((r) => normalizeDoc(r as Record<string, unknown>, "estimate", accounts)),
];
const MAPPED: MapRow[] = [
  { ref: "product:P-HOUR", kind: "item", label: "Hour rate", suggested: "labour_revenue", categoryId: "labour_revenue" },
  { ref: "product:P-PARTS", kind: "item", label: "Parts", suggested: "parts_sales", categoryId: "parts_sales" },
  { ref: "product:P-CALL", kind: "item", label: "Appel de service", suggested: "service_call_fees", categoryId: "service_call_fees" },
  { ref: "tax:T-FRAIS", kind: "tax", label: "Frais de transaction", suggested: "other_income", categoryId: "other_income" },
];
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  docs, map: MAPPED, existing: [], locks: new Set(), syncFrom: "2026-01-01", csvUntil: null, decisions: new Map(),
  fees: { balanceCents: null, baselineCents: null }, today: "2026-12-10", ...over,
});

/** Applies a plan to an in-memory copy of Money, like money_wave_apply() does. */
let seq = 0;
function apply(existing: ExistingEntry[], plan: Plan): ExistingEntry[] {
  const out = existing.map((e) => ({ ...e }));
  for (const op of plan.ops) {
    if (op.op === "insert") {
      if (out.some((e) => e.waveKey === op.row.wave_key)) continue;
      out.push({ id: `e${++seq}`, kind: op.row.kind, date: op.row.date, categoryId: op.row.category_id, party: op.row.party, description: op.row.description, totalCents: op.row.total_cents, gstCents: op.row.gst_cents, qstCents: op.row.qst_cents, source: "wave", importKey: null, waveKey: op.row.wave_key, deleted: false });
    } else if (op.op === "update") {
      const e = out.find((x) => x.id === op.id)!;
      Object.assign(e, { date: op.row.date, categoryId: op.row.category_id, party: op.row.party, description: op.row.description, totalCents: op.row.total_cents, gstCents: op.row.gst_cents, qstCents: op.row.qst_cents });
    } else if (op.op === "link") out.find((x) => x.id === op.id)!.waveKey = op.wave_key;
    else out.find((x) => x.id === op.id)!.deleted = true;
  }
  return out;
}
const inserts = (p: Plan) => p.ops.filter((o) => o.op === "insert").map((o) => (o.op === "insert" ? o.row : null)!);

describe("reading Wave's answers", () => {
  it("normalizes invoices, estimates, money and accounts", () => {
    const inv = docs.find((d) => d.number === "300")!;
    expect(inv).toMatchObject({ kind: "invoice", customer: "Transport Roy", subtotalCents: 100000, date: "2026-12-01" });
    expect(inv.lines[0].taxes.map((t) => t.cents)).toEqual([3500, 6983]);
    expect(inv.payments[0]).toMatchObject({ amountCents: 114975, account: { name: "Wave Payments", subtype: "CASH_AND_BANK" }, active: true });
    const est = docs.find((d) => d.kind === "estimate")!;
    expect(est.payments[0].account).toMatchObject({ name: "Wave Payments", subtype: "CASH_AND_BANK" });
    expect(docs[1].payments[1]).toMatchObject({ amountCents: -5000, originPaymentId: "PAY-2" });
  });
  it("recognizes GST / QST in English and French; anything else is a charge", () => {
    expect(taxRole({ abbreviation: "TPS", name: "TPS" })).toBe("gst");
    expect(taxRole({ abbreviation: "TVQ", name: "TVQ" })).toBe("qst");
    expect(taxRole({ abbreviation: "FT", name: "Frais de transaction" })).toBe("charge");
  });
});

describe("category mapping", () => {
  it("never guesses: unmapped Wave products wait in 'To review' and nothing is added for them", () => {
    const plan = planSync(base({ map: [] }));
    expect(inserts(plan)).toHaveLength(0);
    expect(plan.newMapRows.map((m) => [m.ref, m.suggested])).toEqual([
      ["product:P-HOUR", "labour_revenue"], ["product:P-PARTS", "parts_sales"], ["product:P-CALL", "service_call_fees"], ["tax:T-FRAIS", "other_income"],
    ]);
    expect(plan.review.filter((r) => r.kind === "unmapped").map((r) => r.title).sort()).toEqual(["Appel de service", "Frais de transaction", "Hour rate", "Parts"]);
    expect(plan.counts.waiting).toBe(3);
    // The nightly check knows that money is waiting, so it doesn't report a gap for it.
    expect(plan.review.some((r) => r.kind === "gap")).toBe(false);
  });
  it("once mapped, each payment splits by its invoice lines with exact GST / QST", () => {
    const rows = inserts(planSync(base()));
    const roy = rows.filter((r) => r.wave_payment_id === "PAY-1");
    expect(roy.map((r) => [r.wave_key, r.total_cents, r.gst_cents, r.qst_cents])).toEqual([
      ["wp:PAY-1:labour_revenue", 80483, 3500, 6983], ["wp:PAY-1:parts_sales", 34492, 1500, 2992],
    ]);
    expect(roy[0]).toMatchObject({ party: "Transport Roy", description: "Payment for Invoice #300 (Wave · Wave Payments)", payment_method: "credit", date: "2026-12-02" });
  });
  it("a non-GST/QST tax (card surcharge) goes to its mapped category, untaxed", () => {
    const rows = inserts(planSync(base())).filter((r) => r.wave_payment_id === "PAY-2");
    const charge = rows.find((r) => r.category_id === "other_income")!;
    expect(charge.gst_cents + charge.qst_cents).toBe(0);
    expect(rows.reduce((s, r) => s + r.total_cents, 0)).toBe(59213 - 5000); // the refund came off
  });
  it("splitDoc always adds up exactly", () => {
    for (const gross of [1, 99, 12345, 999999]) {
      const p = splitDoc(gross, new Map([["labour_revenue", 333], ["parts_sales", 667]]), new Map([["other_income", 34]]), 50, 100)!;
      expect(p.reduce((s, x) => s + x.totalCents, 0)).toBe(gross);
    }
  });
});

describe("exactly once", () => {
  it("a second sync with nothing new changes nothing", () => {
    const first = planSync(base());
    const money = apply([], first);
    const second = planSync(base({ existing: money }));
    expect(second.ops).toEqual([]);
    expect(second.review).toEqual([]);
  });
  it("deposits applied from customer credits aren't counted again; the estimate deposit is", () => {
    const rows = inserts(planSync(base()));
    expect(rows.some((r) => r.wave_payment_id === "PAY-2C")).toBe(false);
    expect(rows.filter((r) => r.wave_payment_id === "EP-1")).toMatchObject([{ category_id: "parts_sales", total_cents: 50000, description: "Deposit – Estimate #E-12 (Wave · Wave Payments)" }]);
  });
  it("links the payments already imported from the Wave CSV instead of adding them again", () => {
    const csv: ExistingEntry[] = [
      { id: "c1", kind: "in", date: "2026-12-02", categoryId: "labour_revenue", party: "Transport Roy", description: "Payment for Invoice #300 (Wave · Wave Payments)", totalCents: 80483, gstCents: 3500, qstCents: 6983, source: "import", importKey: "wave|2026-12-02|in|80483|gl|abc|def|0|labour_revenue", waveKey: null, deleted: false },
      { id: "c2", kind: "in", date: "2026-12-02", categoryId: "parts_sales", party: "Transport Roy", description: "Payment for Invoice #300 (Wave · Wave Payments)", totalCents: 34492, gstCents: 1500, qstCents: 2992, source: "import", importKey: "wave|2026-12-02|in|34492|gl|abc|def|0|parts_sales", waveKey: null, deleted: false },
      { id: "c3", kind: "out", date: "2026-12-02", categoryId: "bank_fees", party: "Wave Payments", description: "Card processing fee – Payment for Invoice #300", totalCents: 3300, gstCents: 0, qstCents: 0, source: "import", importKey: "wave|2026-12-02|out|3300|gl|abc|def|0|fee", waveKey: null, deleted: false },
    ];
    expect(csvGroups(csv)).toMatchObject([{ date: "2026-12-02", invoice: "300", account: "Wave Payments", totalCents: 114975 }]);
    const plan = planSync(base({ existing: csv, csvUntil: "2026-12-02" }));
    expect(plan.ops.filter((o) => o.op === "link").map((o) => (o.op === "link" ? [o.id, o.wave_key] : null))).toEqual([["c1", "wp:PAY-1:labour_revenue"], ["c2", "wp:PAY-1:parts_sales"]]);
    expect(inserts(plan).some((r) => r.wave_payment_id === "PAY-1")).toBe(false);
    // after linking, nothing more happens
    expect(planSync(base({ existing: apply(csv, plan), csvUntil: "2026-12-02" })).ops).toEqual([]);
  });
  it("a payment inside the CSV period that isn't in the CSV goes to 'To review', never added blindly", () => {
    const plan = planSync(base({ csvUntil: "2026-12-31" }));
    expect(inserts(plan).filter((r) => r.wave_key.startsWith("wp:"))).toHaveLength(0);
    expect(plan.review.filter((r) => r.kind === "unmatched").map((r) => r.ref).sort()).toEqual(["csv:EP-1", "csv:PAY-1", "csv:PAY-2"]);
    const decided = planSync(base({ csvUntil: "2026-12-31", decisions: new Map([["csv:PAY-1", "added"], ["csv:EP-1", "ignored"]]) }));
    expect(inserts(decided).filter((r) => r.wave_payment_id === "PAY-1")).toHaveLength(2);
    expect(decided.review.map((r) => r.ref)).not.toContain("csv:EP-1");
  });
});

describe("changes in Wave after the fact", () => {
  const synced = () => apply([], planSync(base()));
  const withPayment = (id: string, patch: Record<string, unknown> | null) => docs.map((d) => ({ ...d, payments: d.payments.flatMap((p) => (p.id !== id ? [p] : patch === null ? [] : [{ ...p, ...patch }])) }));
  it("an edited amount updates the matching entries", () => {
    const plan = planSync(base({ existing: synced(), docs: withPayment("PAY-1", { amountCents: 100000 }) }));
    expect(plan.ops.map((o) => o.op)).toEqual(["update", "update"]);
    expect(plan.ops.reduce((s, o) => s + (o.op === "update" ? o.row.total_cents : 0), 0)).toBe(100000);
  });
  it("a deleted or voided payment moves its entries to the trash", () => {
    expect(planSync(base({ existing: synced(), docs: withPayment("PAY-1", null) })).ops.map((o) => o.op)).toEqual(["trash", "trash"]);
    expect(planSync(base({ existing: synced(), docs: withPayment("PAY-1", { active: false }) })).ops.map((o) => o.op)).toEqual(["trash", "trash"]);
  });
  it("a new refund comes off its payment", () => {
    const money = synced();
    const docs2 = docs.map((d) => (d.number !== "300" ? d : { ...d, payments: [...d.payments, { id: "PAY-1R", date: "2026-12-08" as const, amountCents: -14975, account: d.payments[0].account, method: "CREDIT_CARD", active: true, transactionType: "REFUND", originPaymentId: "PAY-1" }] }));
    const plan = planSync(base({ existing: money, docs: docs2 }));
    expect(plan.ops.every((o) => o.op === "update")).toBe(true);
    expect(plan.ops.reduce((s, o) => s + (o.op === "update" ? o.row.total_cents : 0), 0)).toBe(100000);
  });
  it("an entry a person deleted in Money isn't brought back", () => {
    const money = synced().map((e) => (e.waveKey === "wp:PAY-1:labour_revenue" ? { ...e, deleted: true } : e));
    expect(planSync(base({ existing: money })).ops.filter((o) => o.op === "insert")).toEqual([]);
  });
  it("closed month: never changed, flagged in 'Needs attention' instead", () => {
    const plan = planSync(base({ existing: synced(), docs: withPayment("PAY-1", { amountCents: 100000 }), locks: new Set(["2026-12"]) }));
    expect(plan.ops).toEqual([]);
    expect(plan.review.filter((r) => r.kind === "closed-month").map((r) => r.details.change)).toEqual(["change", "change"]);
    const ignored = planSync(base({ existing: synced(), docs: withPayment("PAY-1", { amountCents: 100000 }), locks: new Set(["2026-12"]), decisions: new Map([["locked:wp:PAY-1:labour_revenue", "ignored"]]) }));
    expect(ignored.review.filter((r) => r.kind === "closed-month")).toHaveLength(1);
  });
  it("closed month: linking a CSV entry is still allowed (nothing about the money changes)", () => {
    const csv: ExistingEntry[] = [{ id: "c9", kind: "in", date: "2026-12-06", categoryId: "parts_sales", party: "Mazda 3", description: "Deposit – Invoice #999 (Wave · Wave Payments)", totalCents: 50000, gstCents: 0, qstCents: 0, source: "import", importKey: "wave|2026-12-06|in|50000|gl|w|d|0|parts_sales", waveKey: null, deleted: false }];
    const plan = planSync(base({ existing: csv, csvUntil: "2026-12-06", locks: new Set(["2026-12"]) }));
    expect(plan.ops.filter((o) => o.op === "link")).toHaveLength(1);
    expect(plan.review.filter((r) => r.kind === "closed-month")).toEqual([]); // only the wording differs: nothing to change
  });
});

describe("card fees (one entry per sync day)", () => {
  it("logs new fees since the baseline, then adds to the same day's entry", () => {
    const p1 = planSync(base({ fees: { balanceCents: 12345, baselineCents: 10000 } }));
    expect(inserts(p1).find((r) => r.wave_key === "fees:2026-12-10")).toMatchObject({ total_cents: 2345, category_id: "bank_fees", kind: "out" });
    const money = apply([], p1);
    const p2 = planSync(base({ existing: money, fees: { balanceCents: 12500, baselineCents: 10000 } }));
    expect(p2.ops).toMatchObject([{ op: "update", row: { wave_key: "fees:2026-12-10", total_cents: 2500 } }]);
    const p3 = planSync(base({ existing: money, today: "2026-12-11", fees: { balanceCents: 12345, baselineCents: 10000 } }));
    expect(p3.ops).toEqual([]);
  });
  it("fees going down are flagged, not guessed", () => {
    const money = apply([], planSync(base({ fees: { balanceCents: 12345, baselineCents: 10000 } })));
    const plan = planSync(base({ existing: money, today: "2026-12-11", fees: { balanceCents: 12000, baselineCents: 10000 } }));
    expect(plan.review.find((r) => r.kind === "fees")).toMatchObject({ amountCents: 345 });
  });
});

describe("nightly safety net", () => {
  it("matches when Money has every Wave payment", () => {
    const money = apply([], planSync(base()));
    expect(planSync(base({ existing: money })).months).toEqual([{ month: "2026-12", waveCents: 114975 + 59213 - 5000 + 50000, moneyCents: 114975 + 59213 - 5000 + 50000, waitingCents: 0, gapCents: 0 }]);
  });
  it("reports the gap when something is missing in Money", () => {
    const money = apply([], planSync(base())).map((e) => (e.waveKey === "wp:PAY-1:parts_sales" ? { ...e, deleted: true } : e));
    expect(planSync(base({ existing: money })).review.find((r) => r.kind === "gap")).toMatchObject({ ref: "gap:2026-12", amountCents: 34492 });
  });
  it("counts CSV-imported Wave income, not its card-fee lines", () => {
    const e = { id: "x", kind: "in" as const, date: "2026-12-01" as const, categoryId: "labour_revenue", party: "", description: "", totalCents: 1, gstCents: 0, qstCents: 0, source: "import", importKey: "wave|2026-12-01|in|1|gl|a|b|0|labour_revenue", waveKey: null, deleted: false };
    expect(isWaveIncome(e)).toBe(true);
    expect(isWaveIncome({ ...e, kind: "out", categoryId: "bank_fees" })).toBe(false);
    expect(isWaveIncome({ ...e, importKey: "bank|x" })).toBe(false);
  });
});

describe("when Wave hides estimates (no permission)", () => {
  const inv = docs.find((d) => d.number === "301")!;
  const applied = { ...inv, payments: [...inv.payments.filter((p) => p.id !== "PAY-2C"), { id: "CRED-1", date: "2026-12-04" as const, amountCents: 50000, account: { id: "A-CREDITS", name: "Customer Credit", subtype: "SYSTEM_CUSTOMER_CREDITS" }, method: "CUSTOMER_CREDIT", active: true, transactionType: "SALE", originPaymentId: null }] };
  const onlyInvoices = docs.filter((d) => d.kind === "invoice").map((d) => (d.number === "301" ? applied : d));
  const csvDeposit: ExistingEntry = { id: "dep", kind: "in", date: "2026-11-20", categoryId: "service_call_fees", party: "Pavage Bolduc", description: "Deposit – Invoice #301 (Wave · Wave Payments)", totalCents: 50003, gstCents: 0, qstCents: 0, source: "import", importKey: "wave|2026-11-20|in|50003|gl|w|d|0|service_call_fees", waveKey: null, deleted: false };
  it("a deposit applied to an invoice is matched to the CSV deposit (same invoice, within $1) and nothing changes", () => {
    const plan = planSync(base({ docs: onlyInvoices, existing: [csvDeposit], csvUntil: "2026-11-30", syncFrom: "2026-01-01", creditDeposits: true }));
    expect(plan.ops.filter((o) => o.op === "link")).toMatchObject([{ id: "dep", wave_key: "wp:CRED-1:service_call_fees" }]);
    expect(plan.ops.some((o) => o.op !== "link" && "id" in o && o.id === "dep")).toBe(false);
    expect(plan.review.some((r) => r.ref === "csv:CRED-1")).toBe(false);
    expect(plan.months.find((m) => m.month === "2026-11")).toMatchObject({ gapCents: 0 });
  });
  it("a deposit that isn't in the CSV waits in 'To review' (its received date is unknown); never added on its own", () => {
    const plan = planSync(base({ docs: onlyInvoices, creditDeposits: true }));
    expect(inserts(plan).some((r) => r.wave_payment_id === "CRED-1")).toBe(false);
    expect(plan.review.find((r) => r.ref === "csv:CRED-1")).toMatchObject({ kind: "unmatched", details: { reason: "deposit-applied" } });
    expect(plan.review.some((r) => r.kind === "gap")).toBe(false);
  });
  it("credit applications are ignored when estimates are readable (the deposit itself is synced)", () => {
    expect(planSync(base({ docs: onlyInvoices })).review.some((r) => r.ref === "csv:CRED-1")).toBe(false);
  });
});

describe("refund without a link to its payment", () => {
  it("comes off the latest payment of the same invoice, like the CSV import", () => {
    const docs2 = docs.map((d) => (d.number !== "301" ? d : { ...d, payments: d.payments.map((p) => (p.id === "PAY-2R" ? { ...p, originPaymentId: null, transactionType: "SALE" } : p)) }));
    const rows = inserts(planSync(base({ docs: docs2 })));
    expect(rows.some((r) => r.wave_key.startsWith("wr:"))).toBe(false);
    expect(rows.filter((r) => r.wave_payment_id === "PAY-2").reduce((s, r) => s + r.total_cents, 0)).toBe(59213 - 5000);
  });
});

describe("matching the CSV import more closely", () => {
  const csvEntry = (id: string, date: string, cat: string, cents: number, desc: string, party = "Old Name"): ExistingEntry => ({ id, kind: "in", date, categoryId: cat, party, description: desc, totalCents: cents, gstCents: 0, qstCents: 0, source: "import", importKey: `wave|${date}|in|${cents}|gl|acct|desc|0|${cat}`, waveKey: null, deleted: false });
  const twoPayments = docs.map((d) => (d.number !== "300" ? d : { ...d, payments: [{ ...d.payments[0], id: "A", amountCents: 100000 }, { ...d.payments[0], id: "B", amountCents: 14975 }] }));
  it("splits a CSV group that holds two payments of the same invoice on the same day", () => {
    const plan1 = planSync(base({ docs: twoPayments }));
    const pieces = inserts(plan1).filter((r) => r.wave_payment_id === "A" || r.wave_payment_id === "B");
    const csv = pieces.map((r, i) => csvEntry(`c${i}`, r.date, r.category_id, r.total_cents, "Payment for Invoice #300 (Wave · Wave Payments)"));
    const plan = planSync(base({ docs: twoPayments, existing: csv, csvUntil: "2026-12-31" }));
    expect(plan.ops.filter((o) => o.op === "link")).toHaveLength(4);
    expect(plan.review.filter((r) => r.kind === "unmatched").map((r) => r.ref)).not.toContain("csv:A");
    expect(inserts(plan).some((r) => r.wave_payment_id === "A" || r.wave_payment_id === "B")).toBe(false);
  });
  it("keeps the CSV's client name (a customer renamed in Wave isn't a change)", () => {
    const rows = inserts(planSync(base())).filter((r) => r.wave_payment_id === "PAY-1");
    const csv = rows.map((r, i) => ({ ...csvEntry(`k${i}`, r.date, r.category_id, r.total_cents, r.description, "Acier Jean-Guy Robert"), gstCents: r.gst_cents, qstCents: r.qst_cents }));
    const plan = planSync(base({ existing: csv, csvUntil: "2026-12-02" }));
    expect(plan.ops.filter((o) => o.op === "update")).toEqual([]);
  });
  it("a negative line comes off its own category first", () => {
    const disc = docs.map((d) => (d.number !== "300" ? d : { ...d, lines: [...d.lines, { productId: "P-HOUR", productName: "Hour rate", account: null, description: "Crédit", subtotalCents: -10000, taxes: [] }] }));
    const roy = inserts(planSync(base({ docs: disc }))).filter((r) => r.wave_payment_id === "PAY-1");
    const net = (cat: string) => { const r = roy.find((x) => x.category_id === cat)!; return r.total_cents - r.gst_cents - r.qst_cents; };
    // labour 700 − 100 = 600, parts 300 → net split 2 : 1 of the 1,000.00 before taxes
    expect(net("labour_revenue") / net("parts_sales")).toBeCloseTo(2, 2);
  });
});

describe("taxes typed as invoice lines", () => {
  it("recognizes TPS / TVQ / “TPS + TVQ” lines as taxes, never as income or a category to map", () => {
    expect([taxLine("TPS"), taxLine("TVQ • QST"), taxLine("TPS + TVQ"), taxLine("TPS • GST"), taxLine("Hour rate"), taxLine("TPS Hour rate")]).toEqual(["gst", "qst", "both", "gst", null, null]);
    const old = docs.map((d) => (d.number !== "300" ? d : { ...d, lines: [
      { productId: "P-HOUR", productName: "Hour rate", account: null, description: "", subtotalCents: 100000, taxes: [] },
      { productId: "P-TPS", productName: "TPS • GST", account: null, description: "", subtotalCents: 5000, taxes: [] },
      { productId: "P-TVQ", productName: "TVQ • QST", account: null, description: "", subtotalCents: 9975, taxes: [] },
    ] }));
    const plan = planSync(base({ docs: old }));
    expect(inserts(plan).filter((r) => r.wave_payment_id === "PAY-1")).toEqual([expect.objectContaining({ category_id: "labour_revenue", total_cents: 114975, gst_cents: 5000, qst_cents: 9975 })]);
    expect(plan.newMapRows.some((m) => /TPS|TVQ/.test(m.label))).toBe(false);
  });
});
