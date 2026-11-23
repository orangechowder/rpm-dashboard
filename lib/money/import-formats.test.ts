import { describe, expect, it } from "vitest";
import { guessMapping, parseDate, readRows } from "./csv";
import { allocate, isWaveLedger, ledgerToRows, parseWaveLedger, splitPayment } from "./wave-ledger";

const read = (csv: string[][]) => {
  const g = guessMapping(csv);
  return { ...g, ...readRows(csv, g.mapping, g.preset) };
};
const simple = (rows: { date: string; kind: string; totalCents: number }[]) => rows.map((r) => [r.date, r.kind, r.totalCents]);

describe("Québec / Canadian bank CSVs", () => {
  it("Desjardins AccèsD (no titles, caisse name first)", () => {
    const r = read([
      ["Caisse Desjardins de Vaudreuil", "815-30000", "0123456", "EOP", "2026/01/15", "1", "Paiement facture Hydro-Québec", "", "123.45", "", "", "", "", "", "1000.00"],
      ["Caisse Desjardins de Vaudreuil", "815-30000", "0123456", "EOP", "2026/01/16", "2", "Dépôt au comptoir", "", "", "2500.00", "", "", "", "", "3500.00"],
    ]);
    expect(r.preset).toBe("desjardins");
    expect(simple(r.rows)).toEqual([["2026-01-15", "out", 12345], ["2026-01-16", "in", 250000]]);
    expect(r.rows[0].description).toBe("Paiement facture Hydro-Québec");
  });

  it("National Bank (French titles, Débit / Crédit, comma decimals)", () => {
    const r = read([
      ["Date", "Description", "Catégorie", "Débit", "Crédit", "Solde"],
      ["2026-01-15", "NAPA PIECES D'AUTO", "Auto", "1 234,56", "", "5 000,00"],
      ["2026-01-20", "VIREMENT CLIENT", "Revenu", "", "862,31", "5 862,31"],
    ]);
    expect(r.bank).toBe("national");
    expect(simple(r.rows)).toEqual([["2026-01-15", "out", 123456], ["2026-01-20", "in", 86231]]);
  });

  it("RBC (Description 1 + 2, CAD$, MM/DD/YYYY)", () => {
    const r = read([
      ["Account Type", "Account Number", "Transaction Date", "Cheque Number", "Description 1", "Description 2", "CAD$", "USD$"],
      ["Chequing", "01234-5678901", "1/5/2026", "", "PETRO-CANADA", "PURCHASE", "-87.42", ""],
      ["Chequing", "01234-5678901", "1/25/2026", "", "E-TRANSFER", "TRANSPORT ROY", "1581.36", ""],
    ]);
    expect(r.bank).toBe("rbc");
    expect(simple(r.rows)).toEqual([["2026-01-05", "out", 8742], ["2026-01-25", "in", 158136]]);
    expect(r.rows[1].description).toBe("E-TRANSFER · TRANSPORT ROY");
  });

  it("TD (no titles: date, description, out, in, balance)", () => {
    const r = read([
      ["01/15/2026", "PETRO-CANADA 1234", "45.00", "", "1234.56"],
      ["01/16/2026", "MOBILE DEPOSIT", "", "300.00", "1534.56"],
      ["01/31/2026", "MONTHLY ACCOUNT FEE", "4.00", "", "1530.56"],
    ]);
    expect(r.bank).toBe("td");
    expect(r.mapping.hasHeader).toBe(false);
    expect(simple(r.rows)).toEqual([["2026-01-15", "out", 4500], ["2026-01-16", "in", 30000], ["2026-01-31", "out", 400]]);
    expect(r.rows[0].description).toBe("PETRO-CANADA 1234");
  });

  it("BMO (lines above the titles, YYYYMMDD dates)", () => {
    const r = read([
      ["Following data is valid as of 20260131123000 (Year/Month/Day/Hour/Minute/Second)"],
      [""],
      ["First Bank Card", " Transaction Type", " Date Posted", " Transaction Amount", " Description"],
      ["'500766**********'", "DEBIT", "20260115", "-45.00", "[DN]PETRO-CANADA"],
      ["'500766**********'", "CREDIT", "20260116", "300.00", "[CW]CLIENT PAYMENT"],
    ]);
    expect(r.bank).toBe("bmo");
    expect(r.mapping.skip).toBe(2);
    expect(simple(r.rows)).toEqual([["2026-01-15", "out", 4500], ["2026-01-16", "in", 30000]]);
  });

  it("Scotiabank (unsigned amounts + Debit/Credit column)", () => {
    const r = read([
      ["Filter", "Date", "Description", "Sub-description", "Status", "Type of Transaction", "Amount"],
      ["", "2026-01-15", "PETRO-CANADA", "GAS STATION", "posted", "Debit", "45.00"],
      ["", "2026-01-16", "DEPOSIT", "CLIENT", "posted", "Credit", "300.00"],
    ]);
    expect(r.bank).toBe("scotia");
    expect(simple(r.rows)).toEqual([["2026-01-15", "out", 4500], ["2026-01-16", "in", 30000]]);
  });

  it("older Scotiabank (no titles: date, signed amount, -, type, description)", () => {
    const r = read([
      ["1/15/2026", "-45.00", "-", "DEBIT", "PETRO-CANADA STATION 1234 VAUDREUIL"],
      ["1/16/2026", "300.00", "-", "CREDIT", "MOBILE DEPOSIT FROM CLIENT ACCOUNT"],
    ]);
    expect(simple(r.rows)).toEqual([["2026-01-15", "out", 4500], ["2026-01-16", "in", 30000]]);
    expect(r.rows[0].description).toContain("PETRO");
  });

  it("French titles, DD/MM/YYYY dates and a signed Montant", () => {
    const r = read([
      ["Date de l'opération", "Libellé", "Montant"],
      ["15/01/2026", "Achat Canadian Tire", "-45,00"],
      ["03/04/2026", "Dépôt client", "1 234,56"],
    ]);
    expect(r.mapping.dateFormat).toBe("dmy");
    expect(simple(r.rows)).toEqual([["2026-01-15", "out", 4500], ["2026-04-03", "in", 123456]]);
  });

  it("ambiguous English dates default to MM/DD; French to DD/MM", () => {
    expect(read([["Date", "Description", "Amount"], ["03/04/2026", "x", "-1.00"]]).rows[0].date).toBe("2026-03-04");
    expect(read([["Date", "Description", "Montant"], ["03/04/2026", "x", "-1,00"]]).rows[0].date).toBe("2026-04-03");
  });

  it("reads YYYYMMDD and both date orders", () => {
    expect(parseDate("20260115", "ymd")).toBe("2026-01-15");
    expect(parseDate("15/01/2026", "dmy")).toBe("2026-01-15");
    expect(parseDate("2026-01-15", "dmy")).toBe("2026-01-15");
  });
});

// A small Wave "Account Transactions" report with the tricky cases from the real one.
const LEDGER: string[][] = [
  ["Account Transactions"], ["RPM DIESEL"], ["Date Range: 2026-01-01 to 2026-12-31"], ["Report Type: Accrual (Paid & Unpaid)"],
  ["ACCOUNT NUMBER", "DATE", "DESCRIPTION", "DEBIT (In Business Currency)", "CREDIT (In Business Currency)", "BALANCE (In Business Currency)"],
  ["", "Cash on Hand", "", "", "", ""],
  ["Starting Balance", "", "", "", "", "$100.00"],
  ["", "2026-01-10", "Roy - Payment for Invoice #200", "$1,149.75", "", "$1,249.75"],
  ["", "2026-02-01", "Pavé - Payment for Invoice #201", "$600.00", "", ""],
  ["", "2026-02-01", "Pavé - Payment for Invoice #201", "", "$25.00", ""],
  ["Totals and Ending Balance", "", "", "$1,749.75", "$25.00", ""],
  ["Balance Change", "", "", "$1,724.75", "", ""],
  [""],
  ["", "Wave Payments", "", "", "", ""],
  ["Starting Balance", "", "", "", "", "$0.00"],
  ["", "2026-01-12", "Bou - Payment for Invoice #202", "$555.00", "", ""],
  ["", "2026-01-13", "Bou - Payment for Invoice #202", "$97.00", "", ""],
  ["", "2026-01-13", "Bou - Payment for Invoice #202", "", "$97.00", ""],
  ["", "2026-03-01", "Estimate Deposit - Mazda", "$970.00", "", ""],
  ["", "2026-03-05", "Old - Payment for Invoice #150", "$100.00", "", ""],
  ["Totals and Ending Balance", "", "", "", "", ""],
  ["", "Accounts Receivable", "", "", "", ""],
  ["", "2026-01-10", "Roy - 200", "$1,149.75", "", ""],
  ["", "2026-01-10", "Roy - Payment for Invoice #200", "", "$1,149.75", ""],
  ["", "2026-01-12", "Bou - 202", "$574.88", "", ""],
  ["", "2026-01-12", "Bou - Payment for Invoice #202", "", "$574.88", ""],
  ["", "", "", "", "", ""],
  ["", "Sales", "", "", "", ""],
  ["", "2026-01-10", "Roy - 200 - Hour rate", "", "$700.00", ""],
  ["", "2026-01-10", "Roy - 200 - Parts", "", "$300.00", ""],
  ["", "2026-01-12", "Bou - 202 - Appel de service", "", "$500.00", ""],
  ["", "2026-01-31", "Pavé - 201 - Hour rate", "", "$600.00", ""],
  ["", "2026-02-20", "Mazda - 203 - Parts", "", "$1,000.00", ""],
  ["", "GST", "", "", "", ""],
  ["", "2026-01-10", "Roy - 200 - Hour rate", "", "$35.00", ""],
  ["", "2026-01-10", "Roy - 200 - Parts", "", "$15.00", ""],
  ["", "2026-01-12", "Bou - 202 - Appel de service", "", "$25.00", ""],
  ["", "QST", "", "", "", ""],
  ["", "2026-01-10", "Roy - 200 - Hour rate", "", "$69.83", ""],
  ["", "2026-01-10", "Roy - 200 - Parts", "", "$29.92", ""],
  ["", "2026-01-12", "Bou - 202 - Appel de service", "", "$49.88", ""],
  ["", "Consolidated Customer Credits", "", "", "", ""],
  ["", "2026-03-01", "Estimate Deposit - Mazda", "", "$1,000.00", ""],
  ["", "2026-03-10", "Mazda - Payment for Invoice #203", "$1,000.00", "", ""],
  ["", "Merchant Account Fees", "", "", "", ""],
  ["", "2026-01-12", "Bou - Payment for Invoice #202", "$19.88", "", ""],
  ["", "2026-01-13", "Bou - Payment for Invoice #202", "$3.00", "", ""],
  ["", "2026-01-13", "Bou - Payment for Invoice #202", "", "$3.00", ""],
  ["", "2026-03-01", "Estimate Deposit - Mazda", "$30.00", "", ""],
];

describe("Wave General Ledger import", () => {
  const ledger = parseWaveLedger(LEDGER);
  const { rows, notes, months } = ledgerToRows(ledger);
  const ins = rows.filter((r) => r.kind === "in");

  it("recognizes the report and its accounts", () => {
    expect(isWaveLedger(LEDGER)).toBe(true);
    expect(isWaveLedger([["Date", "Description", "Amount"]])).toBe(false);
    expect(ledger.from).toBe("2026-01-01");
    expect(Object.fromEntries(ledger.accounts.map((a) => [a.name, a.role]))).toEqual({
      "Cash on Hand": "cash", "Wave Payments": "cash", "Accounts Receivable": "receivable", Sales: "sales", GST: "gst", QST: "qst",
      "Consolidated Customer Credits": "customer_credits", "Merchant Account Fees": "merchant_fees",
    });
  });

  it("splits a payment by the invoice's own lines, with its exact taxes", () => {
    const roy = ins.filter((r) => r.invoice === "200");
    expect(roy.map((r) => [r.categoryId, r.totalCents, r.gstCents, r.qstCents])).toEqual([["labour_revenue", 80483, 3500, 6983], ["parts_sales", 34492, 1500, 2992]]);
    expect(roy.reduce((s, r) => s + r.totalCents, 0)).toBe(114975);
    expect(roy[0].party).toBe("Roy");
  });

  it("adds the card fee back to a Wave Payments deposit and logs the fee once", () => {
    const bou = rows.filter((r) => r.invoice === "202");
    expect(bou.filter((r) => r.kind === "in").reduce((s, r) => s + r.totalCents, 0)).toBe(57488);
    expect(bou.filter((r) => r.kind === "out")).toMatchObject([{ categoryId: "bank_fees", totalCents: 1988, gstCents: 0 }]);
  });

  it("cancels a payment that was taken back, and nets a refund against its payment", () => {
    expect(notes.find((n) => n.type === "reversal")).toMatchObject({ cents: 9700 });
    expect(notes.find((n) => n.type === "refund-netted")).toMatchObject({ cents: 2500 });
    expect(ins.filter((r) => r.invoice === "201").reduce((s, r) => s + r.totalCents, 0)).toBe(57500);
    expect(rows.some((r) => r.date === "2026-01-13")).toBe(false);
  });

  it("links a deposit to the invoice it was applied to", () => {
    const dep = ins.filter((r) => r.date === "2026-03-01");
    expect(dep.map((r) => [r.invoice, r.categoryId, r.totalCents])).toEqual([["203", "parts_sales", 100000]]);
  });

  it("estimates taxes when the invoice isn't in the file, and says so", () => {
    expect(ins.find((r) => r.invoice === "150")).toMatchObject({ estimated: true, totalCents: 10000, gstCents: 435, qstCents: 868 });
    expect(notes.some((n) => n.type === "no-invoice")).toBe(true);
  });

  it("ties out to the cash accounts to the cent, with unique keys", () => {
    const cashChange = ledger.lines.filter((l) => ["Cash on Hand", "Wave Payments"].includes(l.account)).reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    const inTotal = ins.reduce((s, r) => s + r.totalCents, 0);
    const outTotal = rows.filter((r) => r.kind === "out").reduce((s, r) => s + r.totalCents, 0);
    expect(inTotal - outTotal).toBe(cashChange);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.every((r) => r.key.startsWith(`wave|${r.date}|${r.kind}|${r.totalCents}|`))).toBe(true);
    expect(rows.every((r) => r.gstCents + r.qstCents <= r.totalCents && r.gstCents >= 0 && r.qstCents >= 0)).toBe(true);
    expect(months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(months[0].waveIncomeCents).toBe(210000);
  });

  it("same file twice → same keys (re-import never doubles)", () => {
    expect(ledgerToRows(parseWaveLedger(LEDGER)).rows.map((r) => r.key)).toEqual(rows.map((r) => r.key));
  });

  it("allocates exactly", () => {
    const parts = allocate(100, [["a", 1], ["b", 1], ["c", 1]]);
    expect([...parts.values()].reduce((s, v) => s + v, 0)).toBe(100);
    expect(splitPayment(1, { shares: new Map([["labour_revenue", 500], ["parts_sales", 500]]), charge: 0, gst: 50, qst: 100, arTotal: 1150 }).reduce((s, p) => s + p.totalCents, 0)).toBe(1);
  });
});
