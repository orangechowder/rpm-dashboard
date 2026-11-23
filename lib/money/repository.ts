// Browser data access for Money / Argent. Every call goes through the signed-in user's session, so
// Supabase RLS (Admins only) applies; nothing here uses a server key.
import { supabase } from "../supabase";
import type { Cents } from "./cents";
import { addDays, todayISO, type ISODate } from "./dates";
import type { RecurringRule } from "./recurring";
import { DEFAULT_SETTINGS, type MoneyCategory, type MoneyEntry, type MoneySettings } from "./types";

function client() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

const ENTRY_COLUMNS = "id,kind,entry_date,category_id,party_name,description,total_cents,gst_cents,qst_cents,net_cents,taxes_included,payment_method,paid,paid_on,receipt_path,receipt_ref,recurring_id,occurrence_date,source,import_key,created_by,created_at,updated_by,updated_at,deleted_at,deleted_by";

import { int, rowToEntry, str, toTaxMode, type Row } from "./rows";
export { rowToEntry };

export type EntryInput = Pick<MoneyEntry, "kind" | "date" | "categoryId" | "party" | "description" | "totalCents" | "gstCents" | "qstCents" | "taxesIncluded" | "paymentMethod" | "paid" | "paidOn" | "receiptPath">
  & Partial<Pick<MoneyEntry, "recurringId" | "occurrenceDate" | "source" | "importKey" | "receiptRef">>;

export function entryToRow(input: EntryInput): Row {
  return {
    kind: input.kind,
    entry_date: input.date,
    category_id: input.categoryId,
    party_name: input.party.trim().slice(0, 120),
    description: input.description.trim().slice(0, 500),
    total_cents: input.totalCents,
    gst_cents: input.gstCents,
    qst_cents: input.qstCents,
    taxes_included: input.taxesIncluded,
    payment_method: input.paymentMethod,
    paid: input.paid,
    paid_on: input.paid ? (input.paidOn ?? input.date) : null,
    receipt_path: input.receiptPath,
    ...(input.receiptRef !== undefined ? { receipt_ref: input.receiptRef.trim().slice(0, 120) } : {}),
    ...(input.recurringId !== undefined ? { recurring_id: input.recurringId, occurrence_date: input.occurrenceDate ?? null } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.importKey !== undefined ? { import_key: input.importKey } : {}),
  };
}

export class MoneyError extends Error {
  constructor(public code: "locked" | "offline" | "forbidden" | "duplicate" | "other", message: string) { super(message); }
}

function wrap(error: { message?: string; code?: string } | null): never | void {
  if (!error) return;
  const message = error.message ?? "";
  if (message.includes("money_month_locked")) throw new MoneyError("locked", message);
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) throw new MoneyError("offline", message);
  if (error.code === "42501" || message.includes("row-level security")) throw new MoneyError("forbidden", message);
  if (error.code === "23505") throw new MoneyError("duplicate", message);
  throw new MoneyError("other", message);
}

/** All live entries + those deleted in the last 30 days (for the trash). */
export async function loadEntries(now: Date = new Date()): Promise<MoneyEntry[]> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const out: MoneyEntry[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await client()
      .from("money_entries")
      .select(ENTRY_COLUMNS)
      .or(`deleted_at.is.null,deleted_at.gt.${cutoff}`)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + page - 1);
    wrap(error);
    out.push(...(data ?? []).map((row) => rowToEntry(row as Row)));
    if (!data || data.length < page) break;
  }
  return out;
}

export async function createEntry(input: EntryInput): Promise<MoneyEntry> {
  const { data, error } = await client().from("money_entries").insert(entryToRow(input)).select(ENTRY_COLUMNS).single();
  wrap(error);
  return rowToEntry(data as Row);
}

/** Inserts many (import / recurring). Rows that already exist (same import key or occurrence) are skipped. */
export async function createEntries(inputs: EntryInput[], conflict: "import_key" | "recurring_id,occurrence_date"): Promise<MoneyEntry[]> {
  const out: MoneyEntry[] = [];
  for (let i = 0; i < inputs.length; i += 200) {
    const { data, error } = await client()
      .from("money_entries")
      .upsert(inputs.slice(i, i + 200).map(entryToRow), { onConflict: conflict, ignoreDuplicates: true })
      .select(ENTRY_COLUMNS);
    wrap(error);
    out.push(...(data ?? []).map((row) => rowToEntry(row as Row)));
  }
  return out;
}

export async function updateEntry(id: string, input: Partial<EntryInput>): Promise<MoneyEntry> {
  const patch: Row = {};
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.date !== undefined) patch.entry_date = input.date;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.party !== undefined) patch.party_name = input.party.trim().slice(0, 120);
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 500);
  if (input.totalCents !== undefined) patch.total_cents = input.totalCents;
  if (input.gstCents !== undefined) patch.gst_cents = input.gstCents;
  if (input.qstCents !== undefined) patch.qst_cents = input.qstCents;
  if (input.taxesIncluded !== undefined) patch.taxes_included = input.taxesIncluded;
  if (input.paymentMethod !== undefined) patch.payment_method = input.paymentMethod;
  if (input.receiptPath !== undefined) patch.receipt_path = input.receiptPath;
  if (input.paid !== undefined) {
    patch.paid = input.paid;
    patch.paid_on = input.paid ? (input.paidOn ?? input.date ?? todayISO()) : null;
  } else if (input.paidOn !== undefined) {
    patch.paid_on = input.paidOn;
  }
  const { data, error } = await client().from("money_entries").update(patch).eq("id", id).select(ENTRY_COLUMNS).single();
  wrap(error);
  return rowToEntry(data as Row);
}

export async function trashEntry(id: string): Promise<MoneyEntry> {
  const { data, error } = await client().from("money_entries").update({ deleted_at: new Date().toISOString() }).eq("id", id).select(ENTRY_COLUMNS).single();
  wrap(error);
  return rowToEntry(data as Row);
}

export async function restoreEntry(id: string): Promise<MoneyEntry> {
  const { data, error } = await client().from("money_entries").update({ deleted_at: null }).eq("id", id).select(ENTRY_COLUMNS).single();
  wrap(error);
  return rowToEntry(data as Row);
}

// ---------- Categories / parties / settings ----------
export async function loadCategories(): Promise<MoneyCategory[]> {
  const { data, error } = await client().from("money_categories").select("id,kind,name_en,name_fr,icon,sort_order,needs_receipt,taxable_default,tax_mode,active").order("sort_order");
  wrap(error);
  return (data ?? []).map((r: Row) => ({ id: str(r.id), kind: r.kind === "in" ? "in" : "out", en: str(r.name_en), fr: str(r.name_fr), icon: str(r.icon), sortOrder: Number(r.sort_order), needsReceipt: Boolean(r.needs_receipt), taxable: Boolean(r.taxable_default), taxMode: toTaxMode(r.tax_mode, Boolean(r.taxable_default)), active: Boolean(r.active) }));
}

export async function updateCategory(id: string, patch: Partial<Pick<MoneyCategory, "en" | "fr" | "active" | "needsReceipt" | "taxable" | "taxMode">>) {
  const row: Row = {};
  if (patch.en !== undefined) row.name_en = patch.en.trim();
  if (patch.fr !== undefined) row.name_fr = patch.fr.trim();
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.needsReceipt !== undefined) row.needs_receipt = patch.needsReceipt;
  if (patch.taxable !== undefined) row.taxable_default = patch.taxable;
  if (patch.taxMode !== undefined) { row.tax_mode = patch.taxMode; row.taxable_default = patch.taxMode !== "none"; }
  const { error } = await client().from("money_categories").update(row).eq("id", id);
  wrap(error);
}

export type Party = { id: string; name: string; kind: "client" | "supplier" | "both"; categoryId: string | null };

export async function loadParties(): Promise<Party[]> {
  const { data, error } = await client().from("money_parties").select("id,name,kind,default_category_id").order("name");
  wrap(error);
  return (data ?? []).map((r: Row) => ({ id: str(r.id), name: str(r.name), kind: (r.kind as Party["kind"]) ?? "supplier", categoryId: r.default_category_id ? str(r.default_category_id) : null }));
}

/** Supplier → category memory (Petro-Canada → Fuel). Same name in any case/spacing = same party. */
export async function rememberParty(name: string, kind: "client" | "supplier", categoryId: string, existing: Party[]): Promise<Party | null> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) return null;
  const key = clean.toLowerCase();
  const found = existing.find((p) => p.name.trim().replace(/\s+/g, " ").toLowerCase() === key);
  if (found) {
    if (found.categoryId === categoryId && (found.kind === kind || found.kind === "both")) return found;
    const nextKind = found.kind === kind || found.kind === "both" ? found.kind : "both";
    const { data, error } = await client().from("money_parties").update({ default_category_id: categoryId, kind: nextKind }).eq("id", found.id).select("id,name,kind,default_category_id").single();
    wrap(error);
    return { id: str(data!.id), name: str(data!.name), kind: data!.kind as Party["kind"], categoryId: str(data!.default_category_id) };
  }
  const { data, error } = await client().from("money_parties").insert({ name: clean, kind, default_category_id: categoryId }).select("id,name,kind,default_category_id").single();
  if (error?.code === "23505") return null; // created meanwhile by someone else
  wrap(error);
  return { id: str(data!.id), name: str(data!.name), kind: data!.kind as Party["kind"], categoryId: str(data!.default_category_id) };
}

export async function loadSettings(): Promise<MoneySettings> {
  const { data, error } = await client().from("money_settings").select("fiscal_year_start_month,tax_frequency,gst_number,qst_number,setup_completed_at").eq("id", 1).maybeSingle();
  wrap(error);
  if (!data) return DEFAULT_SETTINGS;
  return {
    fiscalYearStartMonth: Number(data.fiscal_year_start_month) || 1,
    taxFrequency: (["monthly", "quarterly", "yearly"].includes(str(data.tax_frequency)) ? str(data.tax_frequency) : "quarterly") as MoneySettings["taxFrequency"],
    gstNumber: str(data.gst_number),
    qstNumber: str(data.qst_number),
    setupCompletedAt: data.setup_completed_at ? str(data.setup_completed_at) : null,
  };
}

export async function saveSettings(patch: Partial<MoneySettings>) {
  const row: Row = {};
  if (patch.fiscalYearStartMonth !== undefined) row.fiscal_year_start_month = patch.fiscalYearStartMonth;
  if (patch.taxFrequency !== undefined) row.tax_frequency = patch.taxFrequency;
  if (patch.gstNumber !== undefined) row.gst_number = patch.gstNumber.trim();
  if (patch.qstNumber !== undefined) row.qst_number = patch.qstNumber.trim();
  if (patch.setupCompletedAt !== undefined) row.setup_completed_at = patch.setupCompletedAt;
  const { error } = await client().from("money_settings").update(row).eq("id", 1);
  wrap(error);
}

// ---------- Month locks & bank balances ----------
export async function loadLocks(): Promise<Set<string>> {
  const { data, error } = await client().from("money_month_locks").select("month");
  wrap(error);
  return new Set((data ?? []).map((r: Row) => str(r.month).slice(0, 7)));
}

export async function closeMonth(month: string) {
  const { error } = await client().from("money_month_locks").insert({ month: `${month}-01` });
  wrap(error);
}

export async function reopenMonth(month: string) {
  const { error } = await client().from("money_month_locks").delete().eq("month", `${month}-01`);
  wrap(error);
}

export async function loadBankBalances(): Promise<Map<string, Cents>> {
  const { data, error } = await client().from("money_bank_balances").select("month,balance_cents");
  wrap(error);
  return new Map((data ?? []).map((r: Row) => [str(r.month).slice(0, 7), int(r.balance_cents)]));
}

export async function saveBankBalance(month: string, cents: Cents | null) {
  if (cents === null) {
    // A typed balance is never erased (it's history); set it again to correct it.
    return;
  }
  const { error } = await client().from("money_bank_balances").upsert({ month: `${month}-01`, balance_cents: cents }, { onConflict: "month" });
  wrap(error);
}

// ---------- Audit log ----------
export type AuditRow = { id: number; at: string; actor: string; table: string; rowId: string; action: "insert" | "update" | "delete"; oldData: Row | null; newData: Row | null };

export async function loadAudit(limit = 200, before?: number): Promise<AuditRow[]> {
  let query = client().from("money_audit_log").select("id,at,actor,table_name,row_id,action,old_data,new_data").order("id", { ascending: false }).limit(limit);
  if (before) query = query.lt("id", before);
  const { data, error } = await query;
  wrap(error);
  return (data ?? []).map((r: Row) => ({ id: Number(r.id), at: str(r.at), actor: str(r.actor), table: str(r.table_name), rowId: str(r.row_id), action: r.action as AuditRow["action"], oldData: (r.old_data as Row) ?? null, newData: (r.new_data as Row) ?? null }));
}

// ---------- Receipts (private bucket, Admins only) ----------
const BUCKET = "money-receipts";

/** Shrinks photos (max 1600 px, JPEG) so receipts stay small and upload fast on a phone. */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadReceipt(file: File, date: ISODate): Promise<string> {
  const blob = await compressImage(file);
  const ext = blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : blob.type.includes("heic") || blob.type.includes("heif") ? "heic" : blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${date.slice(0, 4)}/${date.slice(5, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client().storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "application/octet-stream", upsert: false });
  wrap(error);
  return path;
}

export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 300);
  wrap(error);
  return data!.signedUrl;
}

// ---------- Labour (for "Real profit") ----------
export async function loadTimesheetDays(start: ISODate, end: ISODate) {
  const { data, error } = await client()
    .from("daily_timesheet_summary")
    .select("billable_hours,lost_time_minutes,hourly_rate,work_date")
    .gte("work_date", start)
    .lte("work_date", end);
  wrap(error);
  return (data ?? []).map((r: Row) => ({ billableHours: Number(r.billable_hours ?? 0), lostTimeMinutes: Number(r.lost_time_minutes ?? 0), hourlyRate: r.hourly_rate === null || r.hourly_rate === undefined ? null : Number(r.hourly_rate) }));
}

// ---------- Recurring bills (Phase 3 table) ----------
const RULE_COLUMNS = "id,name,kind,category_id,party_name,amount_cents,taxes_included,frequency,start_date,end_date,paused,paused_on,auto_paid,payment_method,skipped_dates,deleted_at";

export type RecurringRow = RecurringRule & { pausedOn: ISODate | null };

function rowToRule(r: Row): RecurringRow {
  return {
    id: str(r.id), name: str(r.name), kind: r.kind === "in" ? "in" : "out", categoryId: str(r.category_id), party: str(r.party_name),
    amountCents: int(r.amount_cents), taxesIncluded: Boolean(r.taxes_included), frequency: str(r.frequency) as RecurringRule["frequency"],
    startDate: str(r.start_date), endDate: r.end_date ? str(r.end_date) : null, paused: Boolean(r.paused), pausedOn: r.paused_on ? str(r.paused_on) : null,
    autoPaid: Boolean(r.auto_paid), paymentMethod: r.payment_method ? str(r.payment_method) : null,
    skippedDates: Array.isArray(r.skipped_dates) ? (r.skipped_dates as unknown[]).map(str) : [], deletedAt: r.deleted_at ? str(r.deleted_at) : null,
  };
}

export async function loadRules(): Promise<RecurringRow[]> {
  const { data, error } = await client().from("money_recurring").select(RULE_COLUMNS).is("deleted_at", null).order("name");
  if (error?.code === "42P01" || error?.code === "PGRST205") return []; // table not installed yet
  wrap(error);
  return (data ?? []).map((r) => rowToRule(r as Row));
}

export type RuleInput = Omit<RecurringRow, "id" | "deletedAt">;

function ruleToRow(rule: Partial<RuleInput>): Row {
  const row: Row = {};
  const map: Record<string, string> = { name: "name", kind: "kind", categoryId: "category_id", party: "party_name", amountCents: "amount_cents", taxesIncluded: "taxes_included", frequency: "frequency", startDate: "start_date", endDate: "end_date", paused: "paused", pausedOn: "paused_on", autoPaid: "auto_paid", paymentMethod: "payment_method", skippedDates: "skipped_dates" };
  for (const [field, column] of Object.entries(map)) if ((rule as Row)[field] !== undefined) row[column] = (rule as Row)[field];
  return row;
}

export async function saveRule(rule: Partial<RuleInput>, id?: string): Promise<RecurringRow> {
  const query = id
    ? client().from("money_recurring").update(ruleToRow(rule)).eq("id", id).select(RULE_COLUMNS).single()
    : client().from("money_recurring").insert(ruleToRow(rule)).select(RULE_COLUMNS).single();
  const { data, error } = await query;
  wrap(error);
  return rowToRule(data as Row);
}

export async function trashRule(id: string) {
  const { error } = await client().from("money_recurring").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  wrap(error);
}

/** Existing occurrence dates for each rule (deleted entries count too: a deleted bill isn't re-created). */
export function occurrencesByRule(entries: MoneyEntry[]): Map<string, ISODate[]> {
  const map = new Map<string, ISODate[]>();
  for (const entry of entries) {
    if (!entry.recurringId || !entry.occurrenceDate) continue;
    map.set(entry.recurringId, [...(map.get(entry.recurringId) ?? []), entry.occurrenceDate]);
  }
  return map;
}

// ---------- Tax filings (Phase 4 table) ----------
export async function loadFilings(): Promise<Map<string, { filedOn: string; amountCents: Cents }>> {
  const { data, error } = await client().from("money_tax_filings").select("period_start,period_end,filed_on,amount_cents");
  if (error?.code === "42P01" || error?.code === "PGRST205") return new Map();
  wrap(error);
  return new Map((data ?? []).map((r: Row) => [`${str(r.period_start)}|${str(r.period_end)}`, { filedOn: str(r.filed_on), amountCents: int(r.amount_cents) }]));
}

export async function markFiled(start: ISODate, end: ISODate, amountCents: Cents) {
  const { error } = await client().from("money_tax_filings").upsert({ period_start: start, period_end: end, filed_on: todayISO(), amount_cents: amountCents }, { onConflict: "period_start,period_end" });
  wrap(error);
}

export async function unmarkFiled(start: ISODate, end: ISODate) {
  const { error } = await client().from("money_tax_filings").delete().eq("period_start", start).eq("period_end", end);
  wrap(error);
}

export const TRASH_DAYS = 30;
export function trashExpires(deletedAt: string): ISODate {
  return addDays(deletedAt.slice(0, 10), TRASH_DAYS);
}
