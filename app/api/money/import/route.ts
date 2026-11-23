// CSV import (Admins only). The browser reads the file; this route:
//   POST { action: "check", source, rows }                → duplicate check + category suggestions
//   POST { action: "commit", source, fileName, rows }     → validates every row again and saves them
// Data is read/written with the caller's own session (RLS + audit log apply), never the service key.
import { divRound } from "../../../../lib/money/cents";
import { checkDuplicates, importKeys, suggestCategory, type ImportRow } from "../../../../lib/money/matching";
import { isISODate, addDays } from "../../../../lib/money/dates";
import { manualTaxes, noTaxes, splitByMode, splitTaxesIncluded, TAX_MODES, type TaxMode } from "../../../../lib/money/tax";
import { classifyBankLines, type BankRule } from "../../../../lib/money/bank-import";
import { previousTaxPeriod, taxPeriodFor } from "../../../../lib/money/periods";
import type { ISODate } from "../../../../lib/money/dates";
import type { MoneyCategory } from "../../../../lib/money/types";
import { rowToEntry, toTaxMode } from "../../../../lib/money/rows";
import { bearerToken, jsonError, jsonOk, readJson, requireStaff, userClient } from "../../../../lib/server/staff-auth";

const SOURCES = new Set(["bank", "wave", "desjardins"]);
const MAX_ROWS = 5000;
const ENTRY_COLUMNS = "id,kind,entry_date,category_id,party_name,description,total_cents,gst_cents,qst_cents,net_cents,taxes_included,payment_method,paid,paid_on,receipt_path,recurring_id,occurrence_date,source,import_key,created_by,created_at,updated_by,updated_at,deleted_at,deleted_by";

function cleanRow(raw: unknown): ImportRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const totalCents = Number(r.totalCents);
  if (!isISODate(r.date) || (r.kind !== "in" && r.kind !== "out") || !Number.isSafeInteger(totalCents) || totalCents <= 0) return null;
  return { date: r.date, kind: r.kind, totalCents, description: String(r.description ?? "").slice(0, 500), party: String(r.party ?? "").slice(0, 120) };
}

export async function POST(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const body = await readJson(request);
  const source = String(body.source ?? "");
  if (!SOURCES.has(source)) return jsonError(400, "bad_source");
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > MAX_ROWS) return jsonError(400, "bad_rows");
  const db = userClient(bearerToken(request));

  if (body.action === "check") {
    const rows = body.rows.map(cleanRow);
    if (rows.some((r) => !r)) return jsonError(400, "bad_rows");
    const list = rows as ImportRow[];
    // Wave General Ledger rows bring their own stable keys (one payment can become several entries).
    const given = (body.rows as Array<Record<string, unknown>>).map((r) => (typeof r?.key === "string" ? r.key : null));
    const ownKeys = given.every((k, i) => k !== null && k.length <= 300 && k.startsWith(`${source}|${list[i].date}|${list[i].kind}|${list[i].totalCents}|gl|`));
    if (given.some((k) => k !== null) && !ownKeys) return jsonError(400, "bad_key");
    const keys = ownKeys ? (given as string[]) : importKeys(list, source);
    const dates = list.map((r) => r.date).sort();
    // The database API returns at most 1,000 rows per call and keeps addresses short: page through both lookups.
    const existing: Record<string, unknown>[] = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await db.from("money_entries").select(ENTRY_COLUMNS)
        .gte("entry_date", addDays(dates[0], -60)).lte("entry_date", addDays(dates[dates.length - 1], 60)).order("id").range(from, from + 999);
      if (error) return jsonError(500, "lookup_failed", error.message);
      existing.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const keyed: Record<string, unknown>[] = [];
    for (let i = 0; i < keys.length; i += 50) {
      const { data, error: keyError } = await db.from("money_entries").select(ENTRY_COLUMNS).in("import_key", keys.slice(i, i + 50));
      if (keyError) return jsonError(500, "lookup_failed", keyError.message);
      keyed.push(...(data ?? []));
    }
    const entries = [...existing, ...keyed].map((row) => rowToEntry(row));
    const unique = [...new Map(entries.map((e) => [e.id, e])).values()];
    const checks = checkDuplicates(list, keys, unique);
    const [{ data: parties }, { data: categories }, { data: history }] = await Promise.all([
      db.from("money_parties").select("name,default_category_id"),
      db.from("money_categories").select("id,kind,name_en,name_fr,icon,sort_order,needs_receipt,taxable_default,tax_mode,active"),
      db.from("money_entries").select(ENTRY_COLUMNS).is("deleted_at", null).neq("party_name", "").order("created_at", { ascending: false }).limit(3000),
    ]);
    const memory = (parties ?? []).map((p) => ({ name: String(p.name), categoryId: p.default_category_id ? String(p.default_category_id) : null }));
    const historyEntries = (history ?? []).map((row) => rowToEntry(row as Record<string, unknown>));
    const byKind = { in: new Set<string>(), out: new Set<string>() };
    for (const c of categories ?? []) if (c.active) byKind[c.kind === "in" ? "in" : "out"].add(String(c.id));
    const byId = new Map(unique.map((e) => [e.id, e]));
    if (body.bank === true) {
      // Bank / credit-card file: decide what every line is (expense, bill paid, transfer, tax payment, …).
      const { data: ruleRows, error: ruleError } = await db.from("money_bank_rules").select("match_key,kind,action,category_id,party_name,tax_mode");
      if (ruleError) return jsonError(500, "lookup_failed", ruleError.message);
      const rules: BankRule[] = (ruleRows ?? []).map((r) => ({ matchKey: String(r.match_key), kind: r.kind === "in" ? "in" : "out", action: r.action === "transfer" ? "transfer" : "category", categoryId: r.category_id ? String(r.category_id) : null, partyName: String(r.party_name ?? ""), taxMode: r.tax_mode ? toTaxMode(r.tax_mode) : null }));
      const cats: MoneyCategory[] = (categories ?? []).map((r) => ({ id: String(r.id), kind: r.kind === "in" ? "in" : "out", en: String(r.name_en), fr: String(r.name_fr), icon: String(r.icon), sortOrder: Number(r.sort_order), needsReceipt: Boolean(r.needs_receipt), taxable: Boolean(r.taxable_default), taxMode: toTaxMode(r.tax_mode, Boolean(r.taxable_default)), active: Boolean(r.active) }));
      const all = [...new Map([...unique, ...historyEntries].map((e) => [e.id, e])).values()];
      const classified = classifyBankLines(list, keys, { existing: all, rules, memory, categories: cats, incomeFromWave: body.incomeFromWave !== false });
      const allById = new Map(all.map((e) => [e.id, e]));
      return jsonOk({
        results: list.map((row, i) => {
          const c = classified[i];
          const match = c.matchId ? allById.get(c.matchId) : null;
          return { key: keys[i], ...c, match: match ? { date: match.date, party: match.party, totalCents: match.totalCents, categoryId: match.categoryId } : null };
        }),
      });
    }
    return jsonOk({
      results: list.map((row, i) => {
        const match = checks[i].matchId ? byId.get(checks[i].matchId!) : null;
        return {
          key: keys[i],
          status: checks[i].status,
          reason: checks[i].reason,
          match: match ? { date: match.date, party: match.party, totalCents: match.totalCents, categoryId: match.categoryId } : null,
          suggestion: suggestCategory(`${row.party} ${row.description}`, row.kind, memory, historyEntries, byKind[row.kind]),
        };
      }),
    });
  }

  if (body.action === "commit") {
    const { data: categories, error: catError } = await db.from("money_categories").select("id,kind");
    const bills: Array<{ key: string; billId: string; date: string }> = [];
    const taxPayments: Array<{ key: string; date: string; totalCents: number }> = [];
    if (catError) return jsonError(500, "lookup_failed", catError.message);
    const kindOf = new Map((categories ?? []).map((c) => [String(c.id), c.kind === "in" ? "in" : "out"]));
    const rows: Array<Record<string, unknown>> = [];
    const memory = new Map<string, { name: string; kind: "client" | "supplier"; categoryId: string }>();
    for (const raw of body.rows as Array<Record<string, unknown>>) {
      const row = cleanRow(raw);
      const categoryId = String(raw?.categoryId ?? "");
      const key = String(raw?.key ?? "");
      const treatment = String(raw?.treatment ?? "expense");
      if (!row || !key.startsWith(`${source}|${row.date}|${row.kind}|${row.totalCents}|`) || key.length > 300) return jsonError(400, "bad_key");
      if (treatment === "bill") {
        if (row.kind !== "out" || typeof raw.billId !== "string") return jsonError(400, "bad_row");
        bills.push({ key, billId: raw.billId, date: row.date });
        continue;
      }
      if (treatment === "tax-payment") {
        if (row.kind !== "out") return jsonError(400, "bad_row");
        taxPayments.push({ key, date: row.date, totalCents: row.totalCents });
        continue;
      }
      if (treatment !== "expense") return jsonError(400, "bad_treatment");
      if (kindOf.get(categoryId) !== row.kind) return jsonError(400, "bad_row", JSON.stringify(raw).slice(0, 200));
      let split;
      const taxCents = raw.taxCents === null || raw.taxCents === undefined ? null : Number(raw.taxCents);
      const exact = raw.gstCents !== undefined && raw.gstCents !== null && raw.qstCents !== undefined && raw.qstCents !== null;
      const taxMode = typeof raw.taxMode === "string" && (TAX_MODES as string[]).includes(raw.taxMode) ? (raw.taxMode as TaxMode) : null;
      if (exact) {
        // Wave General Ledger: GST and QST already taken from the invoice's own tax lines.
        split = manualTaxes(row.totalCents, Number(raw.gstCents), Number(raw.qstCents));
      } else if (taxMode) {
        split = splitByMode(row.totalCents, taxMode); // bank lines: the category's tax setting, or this line's exception
      } else if (taxCents !== null && Number.isSafeInteger(taxCents) && taxCents > 0) {
        const gst = divRound(BigInt(taxCents) * BigInt(5000), 14975); // the tax amount from Wave, split GST:QST = 5 : 9.975
        split = manualTaxes(row.totalCents, gst, taxCents - gst);
      } else {
        split = raw.taxesIncluded ? splitTaxesIncluded(row.totalCents) : noTaxes(row.totalCents);
      }
      if (!split) return jsonError(400, "bad_taxes");
      rows.push({
        kind: row.kind, entry_date: row.date, category_id: categoryId, party_name: row.party, description: row.description,
        total_cents: split.totalCents, gst_cents: split.gstCents, qst_cents: split.qstCents, taxes_included: split.gstCents + split.qstCents > 0,
        payment_method: null, paid: true, paid_on: row.date, source: "import", import_key: key,
      });
      if (row.party.trim()) memory.set(row.party.trim().toLowerCase(), { name: row.party.trim(), kind: row.kind === "in" ? "client" : "supplier", categoryId });
    }
    const { data: batch, error: batchError } = await db.from("money_import_batches").insert({ source, file_name: String(body.fileName ?? "").slice(0, 200), row_count: rows.length + bills.length + taxPayments.length }).select("id").single();
    if (batchError) return jsonError(500, "save_failed", batchError.message);
    let created = 0;
    for (let i = 0; i < rows.length; i += 250) {
      const chunk = rows.slice(i, i + 250).map((r) => ({ ...r, import_batch_id: batch.id }));
      const { data, error } = await db.from("money_entries").upsert(chunk, { onConflict: "import_key", ignoreDuplicates: true }).select("id");
      if (error) return jsonError(error.message.includes("money_month_locked") ? 409 : 500, error.message.includes("money_month_locked") ? "month_locked" : "save_failed", error.message);
      created += data?.length ?? 0;
    }
    // Supplier/client → category memory (faster next time).
    const { data: known } = await db.from("money_parties").select("id,name,kind,default_category_id");
    const byName = new Map((known ?? []).map((p) => [String(p.name).trim().replace(/\s+/g, " ").toLowerCase(), p]));
    for (const [nameKey, p] of memory) {
      const found = byName.get(nameKey.replace(/\s+/g, " "));
      if (!found) await db.from("money_parties").insert({ name: p.name, kind: p.kind, default_category_id: p.categoryId });
      else if (found.default_category_id !== p.categoryId) await db.from("money_parties").update({ default_category_id: p.categoryId, kind: found.kind === p.kind ? found.kind : "both" }).eq("id", found.id);
    }
    // Bills logged by hand that this file paid: marked paid (the bank line's key is kept so a re-import finds it).
    let billsPaid = 0;
    const billsInClosedMonths: string[] = [];
    for (const b of bills) {
      const { data, error } = await db.from("money_entries").update({ paid: true, paid_on: b.date, import_key: b.key })
        .eq("id", b.billId).eq("kind", "out").eq("paid", false).is("deleted_at", null).is("import_key", null).select("id");
      if (error) { if (error.message.includes("money_month_locked")) { billsInClosedMonths.push(b.billId); continue; } return jsonError(500, "save_failed", error.message); }
      billsPaid += data?.length ?? 0;
    }
    // GST/QST sent to Revenu Québec / CRA: the period before the payment is marked "sent" in Taxes (never an expense).
    let taxFilings = 0;
    if (taxPayments.length) {
      const { data: set } = await db.from("money_settings").select("tax_frequency,fiscal_year_start_month").eq("id", 1).maybeSingle();
      const settings = { taxFrequency: (set?.tax_frequency ?? "quarterly") as "monthly" | "quarterly" | "yearly", fiscalYearStartMonth: Number(set?.fiscal_year_start_month) || 1 };
      for (const t of taxPayments) {
        const period = previousTaxPeriod(taxPeriodFor(t.date as ISODate, settings), settings);
        const { data, error } = await db.from("money_tax_filings").upsert({ period_start: period.start, period_end: period.end, filed_on: t.date, amount_cents: t.totalCents }, { onConflict: "period_start,period_end", ignoreDuplicates: true }).select("period_start");
        if (error) return jsonError(500, "save_failed", error.message);
        taxFilings += data?.length ?? 0;
      }
    }
    // Choices to remember for similar lines ("transfer, not an expense" or supplier → category).
    let rulesSaved = 0;
    if (Array.isArray(body.rules)) {
      const ruleRows = (body.rules as Array<Record<string, unknown>>).slice(0, 500).flatMap((r) => {
        const matchKey = String(r.matchKey ?? "").trim().slice(0, 120);
        const action = r.action === "transfer" ? "transfer" : r.action === "category" ? "category" : null;
        const kind = r.kind === "in" ? "in" : r.kind === "out" ? "out" : null;
        const categoryId = r.categoryId ? String(r.categoryId) : null;
        if (matchKey.length < 2 || !action || !kind || (action === "category" && (!categoryId || kindOf.get(categoryId) !== kind))) return [];
        const mode = typeof r.taxMode === "string" && (TAX_MODES as string[]).includes(r.taxMode) ? r.taxMode : null;
        return [{ match_key: matchKey, kind, action, category_id: action === "category" ? categoryId : null, party_name: String(r.partyName ?? "").slice(0, 120), tax_mode: mode, example: String(r.example ?? "").slice(0, 200) }];
      });
      if (ruleRows.length) {
        const { data, error } = await db.from("money_bank_rules").upsert(ruleRows, { onConflict: "match_key" }).select("match_key");
        if (error) return jsonError(500, "save_failed", error.message);
        rulesSaved = data?.length ?? 0;
      }
    }
    return jsonOk({ created, skipped: rows.length - created, billsPaid, billsInClosedMonths, taxFilings, rulesSaved, batchId: batch.id });
  }

  return jsonError(400, "bad_action");
}
