// CSV import (Admins only). The browser reads the file; this route:
//   POST { action: "check", source, rows }                → duplicate check + category suggestions
//   POST { action: "commit", source, fileName, rows }     → validates every row again and saves them
// Data is read/written with the caller's own session (RLS + audit log apply), never the service key.
import { divRound } from "../../../../lib/money/cents";
import { checkDuplicates, importKeys, suggestCategory, type ImportRow } from "../../../../lib/money/matching";
import { isISODate, addDays } from "../../../../lib/money/dates";
import { manualTaxes, noTaxes, splitTaxesIncluded } from "../../../../lib/money/tax";
import { rowToEntry } from "../../../../lib/money/rows";
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
    const { data: existing, error } = await db.from("money_entries").select(ENTRY_COLUMNS)
      .gte("entry_date", addDays(dates[0], -60)).lte("entry_date", addDays(dates[dates.length - 1], 60)).limit(20000);
    if (error) return jsonError(500, "lookup_failed", error.message);
    const { data: keyed, error: keyError } = await db.from("money_entries").select(ENTRY_COLUMNS).in("import_key", keys.slice(0, 1000));
    if (keyError) return jsonError(500, "lookup_failed", keyError.message);
    const entries = [...(existing ?? []), ...(keyed ?? [])].map((row) => rowToEntry(row as Record<string, unknown>));
    const unique = [...new Map(entries.map((e) => [e.id, e])).values()];
    const checks = checkDuplicates(list, keys, unique);
    const [{ data: parties }, { data: categories }, { data: history }] = await Promise.all([
      db.from("money_parties").select("name,default_category_id"),
      db.from("money_categories").select("id,kind,active"),
      db.from("money_entries").select(ENTRY_COLUMNS).is("deleted_at", null).neq("party_name", "").order("created_at", { ascending: false }).limit(3000),
    ]);
    const memory = (parties ?? []).map((p) => ({ name: String(p.name), categoryId: p.default_category_id ? String(p.default_category_id) : null }));
    const historyEntries = (history ?? []).map((row) => rowToEntry(row as Record<string, unknown>));
    const byKind = { in: new Set<string>(), out: new Set<string>() };
    for (const c of categories ?? []) if (c.active) byKind[c.kind === "in" ? "in" : "out"].add(String(c.id));
    const byId = new Map(unique.map((e) => [e.id, e]));
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
    if (catError) return jsonError(500, "lookup_failed", catError.message);
    const kindOf = new Map((categories ?? []).map((c) => [String(c.id), c.kind === "in" ? "in" : "out"]));
    const rows: Array<Record<string, unknown>> = [];
    const memory = new Map<string, { name: string; kind: "client" | "supplier"; categoryId: string }>();
    for (const raw of body.rows as Array<Record<string, unknown>>) {
      const row = cleanRow(raw);
      const categoryId = String(raw?.categoryId ?? "");
      const key = String(raw?.key ?? "");
      if (!row || kindOf.get(categoryId) !== row.kind) return jsonError(400, "bad_row", JSON.stringify(raw).slice(0, 200));
      if (!key.startsWith(`${source}|${row.date}|${row.kind}|${row.totalCents}|`) || key.length > 300) return jsonError(400, "bad_key");
      let split;
      const taxCents = raw.taxCents === null || raw.taxCents === undefined ? null : Number(raw.taxCents);
      const exact = raw.gstCents !== undefined && raw.gstCents !== null && raw.qstCents !== undefined && raw.qstCents !== null;
      if (exact) {
        // Wave General Ledger: GST and QST already taken from the invoice's own tax lines.
        split = manualTaxes(row.totalCents, Number(raw.gstCents), Number(raw.qstCents));
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
    const { data: batch, error: batchError } = await db.from("money_import_batches").insert({ source, file_name: String(body.fileName ?? "").slice(0, 200), row_count: rows.length }).select("id").single();
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
    return jsonOk({ created, skipped: rows.length - created, batchId: batch.id });
  }

  return jsonError(400, "bad_action");
}
