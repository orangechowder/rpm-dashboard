// "Send to my accountant" (Admins only): GET /api/money/export?format=xlsx|pdf&start=YYYY-MM-DD&end=YYYY-MM-DD&lang=en|fr
// Reads with the caller's own session (RLS applies); never cached.
import { isISODate } from "../../../../lib/money/dates";
import { rowToEntry } from "../../../../lib/money/rows";
import { DEFAULT_SETTINGS, type MoneyCategory, type MoneySettings } from "../../../../lib/money/types";
import { buildPdf, buildWorkbook } from "../../../../lib/server/money-report";
import { bearerToken, jsonError, requireStaff, userClient } from "../../../../lib/server/staff-auth";

export const runtime = "nodejs";
const ENTRY_COLUMNS = "id,kind,entry_date,category_id,party_name,description,total_cents,gst_cents,qst_cents,net_cents,taxes_included,payment_method,paid,paid_on,receipt_path,recurring_id,occurrence_date,source,import_key,created_by,created_at,updated_by,updated_at,deleted_at,deleted_by";

export async function GET(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
  if ((format !== "xlsx" && format !== "pdf") || !isISODate(start) || !isISODate(end) || start > end) return jsonError(400, "bad_request");

  const db = userClient(bearerToken(request));
  const entries = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("money_entries").select(ENTRY_COLUMNS).is("deleted_at", null).gte("entry_date", start).lte("entry_date", end).order("entry_date").range(from, from + 999);
    if (error) return jsonError(500, "lookup_failed", error.message);
    entries.push(...(data ?? []).map((r) => rowToEntry(r as Record<string, unknown>)));
    if (!data || data.length < 1000) break;
  }
  const [{ data: cats, error: catError }, { data: set }] = await Promise.all([
    db.from("money_categories").select("id,kind,name_en,name_fr,icon,sort_order,needs_receipt,taxable_default,active").order("sort_order"),
    db.from("money_settings").select("fiscal_year_start_month,tax_frequency,gst_number,qst_number").eq("id", 1).maybeSingle(),
  ]);
  if (catError) return jsonError(500, "lookup_failed", catError.message);
  const categories: MoneyCategory[] = (cats ?? []).map((r) => ({ id: String(r.id), kind: r.kind === "in" ? "in" : "out", en: String(r.name_en), fr: String(r.name_fr), icon: String(r.icon), sortOrder: Number(r.sort_order), needsReceipt: Boolean(r.needs_receipt), taxable: Boolean(r.taxable_default), active: Boolean(r.active) }));
  const settings: MoneySettings = set ? { ...DEFAULT_SETTINGS, fiscalYearStartMonth: Number(set.fiscal_year_start_month) || 1, taxFrequency: set.tax_frequency as MoneySettings["taxFrequency"], gstNumber: String(set.gst_number ?? ""), qstNumber: String(set.qst_number ?? "") } : DEFAULT_SETTINGS;

  const input = { lang: lang as "en" | "fr", range: { start, end }, entries, categories, settings, generatedBy: caller.name };
  const name = `RPM-Diesel_${lang === "fr" ? "comptable" : "accountant"}_${start}_${end}`;
  const body = format === "xlsx" ? await buildWorkbook(input) : buildPdf(input);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
