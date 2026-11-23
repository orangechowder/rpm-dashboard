// "Send to my accountant": builds the Excel workbook and the PDF summary on the server.
// This is the ONE place that uses real accounting terms (the app itself uses plain words).
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatMoney, type Cents, type Lang } from "../money/cents";
import { DEFAULT_CATEGORIES } from "../money/categories";
import { monthsIn, taxPeriodFor } from "../money/periods";
import { summarize, taxesOwed } from "../money/summary";
import type { DateRange, MoneyCategory, MoneyEntry, MoneySettings } from "../money/types";

if (typeof window !== "undefined") throw new Error("server only");

const T = {
  en: {
    title: "Financial summary", company: "RPM Diesel", period: "Period", generated: "Generated", basis: "Accrual basis (paid and unpaid), amounts before sales taxes, by transaction date. Amounts in CAD.",
    revenue: "Revenue", totalRevenue: "Total revenue", cogs: "Cost of goods sold", totalCogs: "Total cost of goods sold", gross: "Gross profit",
    opex: "Operating expenses", payroll: "Payroll", totalExpenses: "Total expenses", net: "Net income before income taxes", margin: "Net margin",
    salesTax: "Sales taxes (GST / QST)", gstCollected: "GST collected", itc: "Input tax credits (GST paid)", netGst: "Net GST", qstCollected: "QST collected", itr: "Input tax refunds (QST paid)", netQst: "Net QST", remit: "Net remittance (refund if negative)",
    filingPeriod: "Filing period", due: "Due", monthly: "Monthly totals", month: "Month",
    entries: "Entries", date: "Date", type: "Type", account: "Account", party: "Customer / vendor", memo: "Description", beforeTax: "Amount before tax", gst: "GST", qst: "QST", total: "Total",
    paid: "Paid", paidOn: "Paid on", method: "Payment method", receipt: "Receipt reference", source: "Source", id: "Entry ID", createdBy: "Entered by", yes: "Yes", no: "No",
    revenueType: "Revenue", expenseType: "Expense", byCategory: "By category", summary: "Summary", taxes: "Sales taxes", count: "Number of entries", missingReceipts: "Expenses without a receipt", gstNo: "GST no.", qstNo: "QST no.", unpaidIn: "Unpaid customer invoices", unpaidOut: "Unpaid bills",
  },
  fr: {
    title: "Sommaire financier", company: "RPM Diesel", period: "Période", generated: "Produit le", basis: "Comptabilité d'exercice (payé et non payé), montants avant taxes de vente, selon la date de transaction. Montants en CAD.",
    revenue: "Produits", totalRevenue: "Total des produits", cogs: "Coût des marchandises vendues", totalCogs: "Total du coût des marchandises vendues", gross: "Bénéfice brut",
    opex: "Charges d'exploitation", payroll: "Salaires", totalExpenses: "Total des charges", net: "Bénéfice net avant impôts", margin: "Marge nette",
    salesTax: "Taxes de vente (TPS / TVQ)", gstCollected: "TPS perçue", itc: "Crédits de taxe sur les intrants (TPS payée)", netGst: "TPS nette", qstCollected: "TVQ perçue", itr: "Remboursements de taxe sur les intrants (TVQ payée)", netQst: "TVQ nette", remit: "Versement net (remboursement si négatif)",
    filingPeriod: "Période de déclaration", due: "Échéance", monthly: "Totaux mensuels", month: "Mois",
    entries: "Écritures", date: "Date", type: "Type", account: "Compte", party: "Client / fournisseur", memo: "Description", beforeTax: "Montant avant taxes", gst: "TPS", qst: "TVQ", total: "Total",
    paid: "Payé", paidOn: "Payé le", method: "Mode de paiement", receipt: "Référence du reçu", source: "Source", id: "No d'écriture", createdBy: "Saisi par", yes: "Oui", no: "Non",
    revenueType: "Produit", expenseType: "Charge", byCategory: "Par catégorie", summary: "Sommaire", taxes: "Taxes de vente", count: "Nombre d'écritures", missingReceipts: "Dépenses sans reçu", gstNo: "No TPS", qstNo: "No TVQ", unpaidIn: "Factures clients impayées", unpaidOut: "Factures fournisseurs impayées",
  },
};

export type ReportInput = { lang: Lang; range: DateRange; entries: MoneyEntry[]; categories: MoneyCategory[]; settings: MoneySettings; generatedBy: string };

function groupOf(id: string) {
  return DEFAULT_CATEGORIES.find((c) => c.id === id)?.accounting ?? "operating";
}

function statementLines(input: ReportInput) {
  const s = summarize(input.entries, input.range);
  const name = (c: MoneyCategory) => (input.lang === "fr" ? c.fr : c.en);
  const pick = (kind: "in" | "out", group?: string) => input.categories
    .filter((c) => c.kind === kind && (!group || groupOf(c.id) === group))
    .map((c) => ({ label: name(c), cents: s.byCategory[c.id] ?? 0 }))
    .filter((l) => l.cents !== 0);
  const revenue = pick("in");
  const cogs = pick("out", "cogs");
  const payroll = pick("out", "payroll");
  const opex = pick("out", "operating");
  const sum = (lines: Array<{ cents: Cents }>) => lines.reduce((t, l) => t + l.cents, 0);
  const taxes = taxesOwed(s);
  return { s, revenue, cogs, payroll, opex, totalRevenue: sum(revenue), totalCogs: sum(cogs), gross: sum(revenue) - sum(cogs), taxes };
}

function taxPeriods(input: ReportInput) {
  const out: Array<{ start: string; end: string; due: string; gst: Cents; qst: Cents }> = [];
  let cursor = input.range.start;
  for (let guard = 0; guard < 60 && cursor <= input.range.end; guard += 1) {
    const p = taxPeriodFor(cursor, input.settings);
    const clipped = { start: p.start < input.range.start ? input.range.start : p.start, end: p.end > input.range.end ? input.range.end : p.end };
    const t = taxesOwed(summarize(input.entries, clipped));
    out.push({ start: clipped.start, end: clipped.end, due: p.dueDate, gst: t.gstCents, qst: t.qstCents });
    const next = new Date(`${p.end}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return out;
}

const dollars = (cents: Cents) => cents / 100; // spreadsheet cells only; every total was computed in cents

export async function buildWorkbook(input: ReportInput): Promise<Buffer> {
  const t = T[input.lang];
  const wb = new ExcelJS.Workbook();
  wb.creator = "RPM Diesel Dashboard";
  wb.created = new Date();
  const money = '#,##0.00 "$";[Red]-#,##0.00 "$"';
  const st = statementLines(input);
  const head = (ws: ExcelJS.Worksheet, title: string) => {
    ws.addRow([`${t.company} — ${title}`]).font = { bold: true, size: 14 };
    ws.addRow([`${t.period}: ${input.range.start} → ${input.range.end}`]);
    ws.addRow([`${t.gstNo}: ${input.settings.gstNumber || "—"}    ${t.qstNo}: ${input.settings.qstNumber || "—"}`]);
    ws.addRow([t.basis]).font = { italic: true, color: { argb: "FF666666" } };
    ws.addRow([]);
  };

  // 1. Summary (income statement)
  const ws = wb.addWorksheet(t.summary);
  head(ws, t.title);
  ws.columns = [{ width: 52 }, { width: 18 }];
  const line = (label: string, cents: Cents | null, opts: { bold?: boolean; indent?: boolean } = {}) => {
    const row = ws.addRow([opts.indent ? `    ${label}` : label, cents === null ? null : dollars(cents)]);
    row.getCell(2).numFmt = money;
    if (opts.bold) row.font = { bold: true };
    return row;
  };
  line(t.revenue, null, { bold: true });
  st.revenue.forEach((l) => line(l.label, l.cents, { indent: true }));
  line(t.totalRevenue, st.totalRevenue, { bold: true });
  ws.addRow([]);
  line(t.cogs, null, { bold: true });
  st.cogs.forEach((l) => line(l.label, l.cents, { indent: true }));
  line(t.totalCogs, st.totalCogs, { bold: true });
  line(t.gross, st.gross, { bold: true });
  ws.addRow([]);
  line(t.payroll, null, { bold: true });
  st.payroll.forEach((l) => line(l.label, l.cents, { indent: true }));
  line(t.opex, null, { bold: true });
  st.opex.forEach((l) => line(l.label, l.cents, { indent: true }));
  line(t.totalExpenses, st.s.expenseCents, { bold: true });
  ws.addRow([]);
  const netRow = line(t.net, st.s.profitCents, { bold: true });
  netRow.getCell(1).border = { top: { style: "thin" } };
  netRow.getCell(2).border = { top: { style: "thin" }, bottom: { style: "double" } };
  const m = ws.addRow([t.margin, st.s.incomeCents ? st.s.profitCents / st.s.incomeCents : null]);
  m.getCell(2).numFmt = "0.0%";
  ws.addRow([]);
  const live = input.entries.filter((e) => !e.deletedAt && e.date >= input.range.start && e.date <= input.range.end);
  ws.addRow([t.count, live.length]);
  const unpaidIn = live.filter((e) => e.kind === "in" && !e.paid).reduce((s, e) => s + e.totalCents, 0);
  const unpaidOut = live.filter((e) => e.kind === "out" && !e.paid).reduce((s, e) => s + e.totalCents, 0);
  const r1 = ws.addRow([t.unpaidIn, dollars(unpaidIn)]); r1.getCell(2).numFmt = money;
  const r2 = ws.addRow([t.unpaidOut, dollars(unpaidOut)]); r2.getCell(2).numFmt = money;

  // 2. Sales taxes
  const tx = wb.addWorksheet(t.taxes);
  head(tx, t.salesTax);
  tx.columns = [{ width: 46 }, { width: 18 }];
  const tl = (label: string, cents: Cents, bold = false) => { const r = tx.addRow([label, dollars(cents)]); r.getCell(2).numFmt = money; if (bold) r.font = { bold: true }; };
  tl(t.gstCollected, st.s.gstCollectedCents);
  tl(t.itc, -st.s.gstPaidCents);
  tl(t.netGst, st.taxes.gstCents, true);
  tx.addRow([]);
  tl(t.qstCollected, st.s.qstCollectedCents);
  tl(t.itr, -st.s.qstPaidCents);
  tl(t.netQst, st.taxes.qstCents, true);
  tx.addRow([]);
  tl(t.remit, st.taxes.totalCents, true);
  tx.addRow([]);
  const ph = tx.addRow([t.filingPeriod, t.netGst, t.netQst, t.remit, t.due]);
  ph.font = { bold: true };
  tx.getColumn(3).width = 16; tx.getColumn(4).width = 22; tx.getColumn(5).width = 14;
  for (const p of taxPeriods(input)) {
    const r = tx.addRow([`${p.start} → ${p.end}`, dollars(p.gst), dollars(p.qst), dollars(p.gst + p.qst), p.due]);
    [2, 3, 4].forEach((c) => (r.getCell(c).numFmt = money));
  }

  // 3. Entries (every line)
  const en = wb.addWorksheet(t.entries);
  const byId = new Map(input.categories.map((c) => [c.id, c]));
  en.columns = [
    { header: t.date, key: "date", width: 12 }, { header: t.type, key: "type", width: 10 }, { header: t.account, key: "account", width: 34 },
    { header: t.party, key: "party", width: 28 }, { header: t.memo, key: "memo", width: 30 }, { header: t.beforeTax, key: "net", width: 16 },
    { header: t.gst, key: "gst", width: 12 }, { header: t.qst, key: "qst", width: 12 }, { header: t.total, key: "total", width: 14 },
    { header: t.paid, key: "paid", width: 7 }, { header: t.paidOn, key: "paidOn", width: 12 }, { header: t.method, key: "method", width: 14 },
    { header: t.receipt, key: "receipt", width: 22 }, { header: t.source, key: "source", width: 10 }, { header: t.createdBy, key: "by", width: 16 }, { header: t.id, key: "id", width: 38 },
  ];
  en.getRow(1).font = { bold: true };
  en.views = [{ state: "frozen", ySplit: 1 }];
  for (const e of [...live].sort((a, b) => a.date.localeCompare(b.date))) {
    const sign = e.kind === "in" ? 1 : -1;
    const c = byId.get(e.categoryId);
    const row = en.addRow({
      date: e.date, type: e.kind === "in" ? t.revenueType : t.expenseType, account: c ? (input.lang === "fr" ? c.fr : c.en) : e.categoryId, party: e.party, memo: e.description,
      net: dollars(sign * e.netCents), gst: dollars(sign * e.gstCents), qst: dollars(sign * e.qstCents), total: dollars(sign * e.totalCents),
      paid: e.paid ? t.yes : t.no, paidOn: e.paidOn ?? "", method: e.paymentMethod ?? "", receipt: e.receiptRef || (e.receiptPath ? t.yes : ""), source: e.source, by: e.createdBy ?? "", id: e.id,
    });
    ["net", "gst", "qst", "total"].forEach((k) => (row.getCell(k).numFmt = money));
  }
  en.autoFilter = { from: "A1", to: "P1" };

  // 4. By category × month
  const bc = wb.addWorksheet(t.byCategory);
  const months = monthsIn(input.range);
  bc.addRow([t.account, ...months.map((mo) => mo.key), t.total]).font = { bold: true };
  bc.getColumn(1).width = 40;
  for (const c of input.categories) {
    const values = months.map((mo) => summarize(input.entries, mo).byCategory[c.id] ?? 0);
    const total = st.s.byCategory[c.id] ?? 0;
    if (!total && values.every((v) => !v)) continue;
    const r = bc.addRow([input.lang === "fr" ? c.fr : c.en, ...values.map(dollars), dollars(total)]);
    for (let i = 2; i <= months.length + 2; i += 1) r.getCell(i).numFmt = money;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildPdf(input: ReportInput): Buffer {
  const t = T[input.lang];
  const st = statementLines(input);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const fmt = (c: Cents) => formatMoney(c, input.lang).replace(/ /g, " ").replace("−", "-");
  const left = 48;
  doc.setFont("helvetica", "bold").setFontSize(18).text(`${t.company} — ${t.title}`, left, 56);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(90);
  doc.text(`${t.period}: ${input.range.start} → ${input.range.end}    ${t.generated}: ${new Date().toISOString().slice(0, 10)} (${input.generatedBy})`.replace("→", "-"), left, 74);
  doc.text(`${t.gstNo}: ${input.settings.gstNumber || "—"}    ${t.qstNo}: ${input.settings.qstNumber || "—"}`.replace(/—/g, "-"), left, 88);
  doc.setFontSize(8.5).text(doc.splitTextToSize(t.basis, 516), left, 102);
  doc.setTextColor(0);

  const body: Array<[string, string]> = [];
  const push = (label: string, cents: Cents | null, indent = false) => body.push([`${indent ? "    " : ""}${label}`, cents === null ? "" : fmt(cents)]);
  push(t.revenue, null); st.revenue.forEach((l) => push(l.label, l.cents, true)); push(t.totalRevenue, st.totalRevenue);
  push(t.cogs, null); st.cogs.forEach((l) => push(l.label, l.cents, true)); push(t.totalCogs, st.totalCogs); push(t.gross, st.gross);
  push(t.payroll, null); st.payroll.forEach((l) => push(l.label, l.cents, true));
  push(t.opex, null); st.opex.forEach((l) => push(l.label, l.cents, true)); push(t.totalExpenses, st.s.expenseCents);
  push(t.net, st.s.profitCents);
  const boldRows = new Set([t.revenue, t.totalRevenue, t.cogs, t.totalCogs, t.gross, t.payroll, t.opex, t.totalExpenses, t.net]);
  autoTable(doc, {
    startY: 122, head: [[t.summary, ""]], body, theme: "plain",
    styles: { fontSize: 9.5, cellPadding: 3.5 }, headStyles: { fontStyle: "bold", fillColor: [237, 241, 246] },
    columnStyles: { 1: { halign: "right", cellWidth: 130 } },
    didParseCell: (data) => { if (data.section === "body" && boldRows.has(String(data.row.raw && (data.row.raw as string[])[0]).trim())) data.cell.styles.fontStyle = "bold"; },
    margin: { left, right: left },
  });
  const after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  autoTable(doc, {
    startY: after + 18, head: [[t.salesTax, ""]], theme: "plain",
    body: [
      [t.gstCollected, fmt(st.s.gstCollectedCents)], [t.itc, fmt(-st.s.gstPaidCents)], [t.netGst, fmt(st.taxes.gstCents)],
      [t.qstCollected, fmt(st.s.qstCollectedCents)], [t.itr, fmt(-st.s.qstPaidCents)], [t.netQst, fmt(st.taxes.qstCents)], [t.remit, fmt(st.taxes.totalCents)],
    ],
    styles: { fontSize: 9.5, cellPadding: 3.5 }, headStyles: { fontStyle: "bold", fillColor: [237, 241, 246] }, columnStyles: { 1: { halign: "right", cellWidth: 130 } },
    didParseCell: (data) => { if (data.section === "body" && [2, 5, 6].includes(data.row.index)) data.cell.styles.fontStyle = "bold"; },
    margin: { left, right: left },
  });
  const months = monthsIn(input.range);
  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18,
    head: [[t.month, t.totalRevenue, t.totalExpenses, t.net]],
    body: months.map((mo) => { const s = summarize(input.entries, mo); return [mo.key, fmt(s.incomeCents), fmt(s.expenseCents), fmt(s.profitCents)]; }),
    theme: "striped", styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: [24, 34, 48] },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    margin: { left, right: left },
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8).setTextColor(120).text(`${t.company} · ${i}/${pages}`, left, 770);
  }
  return Buffer.from(doc.output("arraybuffer"));
}
