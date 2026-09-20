import { hasSupabaseConfig, supabase } from "./supabase";
import { isRetryableError, withRetry } from "./reliability";

export type CloudUnit = {
  unit: string; vin: string; client: string; type: string; service: string;
  due: string; overdue: boolean; usage: string; currentMeter?: number | null; lastPmMeter?: number | null; pmInterval?: number; meterUnit?: "KM" | "HRS";
  updatedAt?: string;
};
export type UnitNote = { id: string; text: string; author: string; createdAt: string };
export type CloudJob = {
  id: string; unit: string; client: string; tech: string;
  priority: "High" | "Normal" | "Low";
  status: "Scheduled" | "In Progress" | "Waiting on Parts" | "Waiting on Estimates" | "Ready for Invoicing" | "Completed";
  issue: string; updated: string; usage: string; meterReading?: number | null; notes?: unknown[]; lineItems?: unknown[];
  updatedAt?: string;
};
export type CloudUser = { id: string; name: string; role: "Admin" | "Technician"; password: string; active: boolean; isTechnician: boolean; hourlyRate?: number | null };
export type CloudTimeEntry = {
  id: string;
  userId: string;
  userName: string;
  workOrderId: string | null;
  clockIn: string;
  clockOut: string | null;
  totalHours: number | null;
  status: "active" | "completed";
  breakMinutes?: number | null;
  breakStartedAt?: string | null;
  lostTimeMinutes?: number | null;
  lostTimeReason?: string | null;
};
export type DailyTimesheetSummaryRow = {
  userId: string;
  userName: string;
  workDate: string;
  dayStart: string | null;
  dayEnd: string | null;
  hasOpenEntry: boolean;
  rawHours: number | null;
  breakMinutes: number | null;
  lostTimeMinutes: number | null;
  netPayableHours: number | null;
  billableHours: number | null;
  hourlyRate: number | null;
};
export type WeeklyTimesheetSummaryRow = {
  userId: string;
  userName: string;
  weekStart: string;
  weekEnd: string;
  weeklyNetHours: number | null;
  weeklyBillableHours: number | null;
  hourlyRate: number | null;
  weeklyGrossPay: number | null;
};
export type PayrollPeriodLock = {
  periodStart: string;
  periodEnd: string;
  lockedBy: string;
  lockedAt: string;
};
export type RealtimeChange<T> = { eventType: "INSERT" | "UPDATE" | "DELETE"; record: T | null; oldRecord: Partial<T> | null };

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Postgres rejects an upsert batch that targets the same ON CONFLICT key twice; keep the last occurrence.
function dedupeByKey<T>(records: T[], getKey: (record: T) => string): T[] {
  const byKey = new Map(records.map((record) => [getKey(record), record]));
  return [...byKey.values()];
}

function mapUnit(row: Record<string, unknown>): CloudUnit {
  return { unit: String(row.unit ?? ""), vin: String(row.vin ?? ""), client: String(row.client ?? ""), type: String(row.type ?? "Fleet unit"), service: String(row.service ?? "Not serviced yet"), due: String(row.due ?? "Schedule PM"), overdue: Boolean(row.overdue), usage: String(row.usage ?? "Not recorded"), currentMeter: finiteNumber(row.current_meter), lastPmMeter: finiteNumber(row.last_pm_meter), pmInterval: finiteNumber(row.pm_interval) ?? 25000, meterUnit: row.meter_unit === "HRS" ? "HRS" : "KM", updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined };
}

function mapJob(row: Record<string, unknown>): CloudJob {
  return { id: String(row.id ?? ""), unit: String(row.unit ?? ""), client: String(row.client ?? ""), tech: String(row.tech ?? "Unassigned"), priority: row.priority as CloudJob["priority"], status: row.status as CloudJob["status"], issue: String(row.issue ?? ""), updated: String(row.updated ?? ""), usage: String(row.usage ?? "Not recorded"), meterReading: finiteNumber(row.meter_reading), notes: Array.isArray(row.notes) ? row.notes : [], lineItems: Array.isArray(row.line_items) ? row.line_items : [], updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined };
}
function mapUser(row: Record<string, unknown>): CloudUser {
  return { id: String(row.id), name: String(row.name), role: row.role as CloudUser["role"], password: String(row.password), active: Boolean(row.active), isTechnician: Boolean(row.is_technician), hourlyRate: finiteNumber(row.hourly_rate) };
}
function mapTimeEntry(row: Record<string, unknown>): CloudTimeEntry {
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    userName: String(row.user_name ?? ""),
    workOrderId: row.work_order_id ? String(row.work_order_id) : null,
    clockIn: String(row.clock_in ?? ""),
    clockOut: row.clock_out ? String(row.clock_out) : null,
    totalHours: finiteNumber(row.total_hours),
    status: row.status as CloudTimeEntry["status"],
    breakMinutes: finiteNumber(row.break_minutes),
    breakStartedAt: typeof row.break_started_at === "string" ? row.break_started_at : null,
    lostTimeMinutes: finiteNumber(row.lost_time_minutes),
    lostTimeReason: typeof row.lost_time_reason === "string" ? row.lost_time_reason : null,
  };
}

function mapDailyTimesheetSummary(row: Record<string, unknown>): DailyTimesheetSummaryRow {
  return {
    userId: String(row.user_id ?? ""),
    userName: String(row.user_name ?? ""),
    workDate: String(row.work_date ?? ""),
    dayStart: typeof row.day_start === "string" ? row.day_start : null,
    dayEnd: typeof row.day_end === "string" ? row.day_end : null,
    hasOpenEntry: Boolean(row.has_open_entry),
    rawHours: finiteNumber(row.raw_hours),
    breakMinutes: finiteNumber(row.break_minutes),
    lostTimeMinutes: finiteNumber(row.lost_time_minutes),
    netPayableHours: finiteNumber(row.net_payable_hours),
    billableHours: finiteNumber(row.billable_hours),
    hourlyRate: finiteNumber(row.hourly_rate),
  };
}

function mapWeeklyTimesheetSummary(row: Record<string, unknown>): WeeklyTimesheetSummaryRow {
  return {
    userId: String(row.user_id ?? ""),
    userName: String(row.user_name ?? ""),
    weekStart: String(row.week_start ?? ""),
    weekEnd: String(row.week_end ?? ""),
    weeklyNetHours: finiteNumber(row.weekly_net_hours),
    weeklyBillableHours: finiteNumber(row.weekly_billable_hours),
    hourlyRate: finiteNumber(row.hourly_rate),
    weeklyGrossPay: finiteNumber(row.weekly_gross_pay),
  };
}

function mapPayrollPeriodLock(row: Record<string, unknown>): PayrollPeriodLock {
  return {
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    lockedBy: String(row.locked_by ?? ""),
    lockedAt: String(row.locked_at ?? ""),
  };
}

export async function loadFleetData() {
  if (!supabase) return null;
  const [{ data: unitRows, error: unitError }, { data: jobRows, error: jobError }] = await Promise.all([
    supabase.from("fleet_units").select("*").order("unit"),
    supabase.from("work_orders").select("*").order("updated_at", { ascending: false }),
  ]);
  if (unitError) throw unitError;
  if (jobError) throw jobError;
  return {
    units: (unitRows ?? []).map((row) => mapUnit(row as Record<string, unknown>)),
    jobs: (jobRows ?? []).map((row) => mapJob(row as Record<string, unknown>)),
  };
}

export async function saveUnits(units: CloudUnit[]) {
  const client = supabase;
  if (!client) return;
  const dedupedUnits = dedupeByKey(units, (unit) => `${unit.unit}::${unit.client}`);
  const meterRows = dedupedUnits.map((unit) => ({ unit: unit.unit, vin: unit.vin, client: unit.client, type: unit.type, service: unit.service, due: unit.due, overdue: unit.overdue, usage: unit.usage, current_meter: unit.currentMeter ?? null, last_pm_meter: unit.lastPmMeter ?? null, pm_interval: unit.pmInterval ?? 25000, meter_unit: unit.meterUnit ?? "KM", updated_at: unit.updatedAt ?? new Date().toISOString() }));
  const result = await withRetry(async () => await client.from("fleet_units").upsert(meterRows, { onConflict: "unit,client" }), { shouldRetry: isRetryableError });
  if (!result.error) return;
  const missingMeterColumn = result.error.code === "PGRST204" || result.error.code === "42703" || /current_meter|last_pm_meter|pm_interval|meter_unit/i.test(result.error.message);
  if (!missingMeterColumn) throw result.error;
  const legacyRows = dedupedUnits.map((unit) => ({ unit: unit.unit, vin: unit.vin, client: unit.client, type: unit.type, service: unit.service, due: unit.due, overdue: unit.overdue, usage: unit.usage, updated_at: new Date().toISOString() }));
  const legacyResult = await client.from("fleet_units").upsert(legacyRows, { onConflict: "unit,client" });
  if (legacyResult.error) throw legacyResult.error;
}

export async function saveJobs(jobs: CloudJob[]) {
  const client = supabase;
  if (!client) return;
  const toRow = (job: CloudJob) => ({
    id: job.id,
    unit: job.unit,
    client: job.client,
    tech: job.tech,
    priority: job.priority,
    status: job.status,
    issue: job.issue,
    updated: job.updated,
    usage: job.usage,
    meter_reading: job.meterReading,
    notes: job.notes ?? [],
    line_items: job.lineItems ?? [],
    updated_at: job.updatedAt ?? new Date().toISOString(),
  });
  const meterRows = dedupeByKey(jobs, (job) => job.id).map(toRow);
  const result = await withRetry(async () => await client.from("work_orders").upsert(meterRows, { onConflict: "id" }), { shouldRetry: isRetryableError });
  if (!result.error) return;
  // work_orders no longer has a DB-level FK to fleet_units (unit numbers repeat across clients); orphan
  // references are rejected up front by app/page.tsx's submitForm instead of retried here.
  const missingMeterColumn = result.error.code === "PGRST204" || result.error.code === "42703" || /meter_reading/i.test(result.error.message);
  if (!missingMeterColumn) throw result.error;
  const legacyRows = jobs.map((job) => ({
    id: job.id, unit: job.unit, client: job.client, tech: job.tech, priority: job.priority,
    status: job.status, issue: job.issue, updated: job.updated, usage: job.usage,
    notes: job.notes ?? [], line_items: job.lineItems ?? [], updated_at: job.updatedAt ?? new Date().toISOString(),
  }));
  const legacyResult = await client.from("work_orders").upsert(legacyRows, { onConflict: "id" });
  if (legacyResult.error) throw legacyResult.error;
}

export async function loadUsers() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("user_accounts").select("*").order("name");
  if (error?.code === "PGRST205") return null;
  if (error) throw error;
  return (data ?? []).map((row) => mapUser(row as Record<string, unknown>));
}

export async function saveUsers(users: CloudUser[]) {
  if (!supabase) return;
  const { error } = await supabase.from("user_accounts").upsert(users.map((user) => ({ id: user.id, name: user.name, role: user.role, password: user.password, active: user.active, is_technician: user.isTechnician, hourly_rate: user.hourlyRate ?? null, updated_at: new Date().toISOString() })), { onConflict: "id" });
  if (error?.code === "PGRST205") return;
  if (error) throw error;
}

export async function removeUserAccount(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("user_accounts").delete().eq("id", id);
  if (error?.code === "PGRST205") return;
  if (error) throw error;
}

export async function loadTimeEntries(userId?: string) {
  if (!supabase) return null;
  let query = supabase.from("time_entries").select("*").order("clock_in", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error?.code === "PGRST205") return null;
  if (error) throw error;
  return (data ?? []).map((row) => mapTimeEntry(row as Record<string, unknown>));
}

export async function createTimeEntry(entry: Omit<CloudTimeEntry, "id" | "clockOut" | "totalHours" | "status">) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("time_entries").insert({
    user_id: entry.userId,
    user_name: entry.userName,
    work_order_id: entry.workOrderId,
    clock_in: entry.clockIn,
    status: "active",
    break_minutes: entry.breakMinutes ?? 0,
    break_started_at: entry.breakStartedAt ?? null,
    lost_time_minutes: entry.lostTimeMinutes ?? 0,
    lost_time_reason: entry.lostTimeReason ?? null,
  }).select().single();
  if (error?.code === "PGRST205") return null;
  if (error) throw error;
  return mapTimeEntry(data as Record<string, unknown>);
}

export async function completeTimeEntry(id: string, clockOut: string, totalHours: number) {
  if (!supabase) return;
  const { error } = await supabase.from("time_entries").update({ clock_out: clockOut, total_hours: totalHours, status: "completed" }).eq("id", id);
  if (error?.code === "PGRST205") throw new Error("The time_entries table is not installed. Run supabase/schema.sql first.");
  if (error) throw error;
}

export async function createManualTimeEntry(entry: { userId: string; userName: string; workOrderId: string | null; clockIn: string; clockOut: string; totalHours: number }) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("time_entries").insert({ user_id: entry.userId, user_name: entry.userName, work_order_id: entry.workOrderId, clock_in: entry.clockIn, clock_out: entry.clockOut, total_hours: entry.totalHours, status: "completed" }).select().single();
  if (error?.code === "PGRST205") throw new Error("The time_entries table is not installed. Run supabase/schema.sql first.");
  if (error) throw error;
  return mapTimeEntry(data as Record<string, unknown>);
}

export async function updateTimeEntry(entry: CloudTimeEntry) {
  if (!supabase) return;
  const { data, error } = await supabase.from("time_entries").update({
    user_id: entry.userId,
    user_name: entry.userName,
    work_order_id: entry.workOrderId,
    clock_in: entry.clockIn,
    clock_out: entry.clockOut,
    total_hours: entry.totalHours,
    status: entry.status,
    break_minutes: entry.breakMinutes ?? 0,
    break_started_at: entry.breakStartedAt ?? null,
    lost_time_minutes: entry.lostTimeMinutes ?? 0,
    lost_time_reason: entry.lostTimeReason ?? null,
  }).eq("id", entry.id).select("id");
  if (error?.code === "PGRST205") throw new Error("The time_entries table is not installed. Run supabase/schema.sql first.");
  if (error) throw error;
  if (!data?.length) throw new Error("The time entry was not found or could not be updated.");
}

export async function removeTimeEntry(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error?.code === "PGRST205") throw new Error("The time_entries table is not installed. Run supabase/schema.sql first.");
  if (error) throw error;
}

export async function removeUnit(unit: string, client: string) {
  if (!supabase) return;
  const { error } = await supabase.from("fleet_units").delete().eq("unit", unit).eq("client", client);
  if (error) throw error;
}

export async function removeJob(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("work_orders").delete().eq("id", id);
  if (error) throw error;
}

export async function writeActivityLog(actor: string, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("activity_logs").insert({ actor, action, entity_type: entityType, entity_id: entityId, details }).select("id").single();
  if (error) throw error;
  return data ? String(data.id) : null;
}

// Unit notes have no dedicated table; they're reconstructed by replaying add/update/delete
// events stored in activity_logs (details.noteId links updates/deletes back to the add event's id).
export async function loadUnitNotes() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("activity_logs")
    .select("id,actor,entity_id,action,details,created_at")
    .eq("entity_type", "unit")
    .in("action", ["unit_note_added", "unit_note_updated", "unit_note_deleted"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  const notesById = new Map<string, UnitNote & { unitId: string }>();
  for (const row of data ?? []) {
    const unitId = String(row.entity_id);
    if (row.action === "unit_note_added") {
      notesById.set(String(row.id), { id: String(row.id), unitId, text: String(row.details?.text ?? ""), author: String(row.actor ?? "Unknown"), createdAt: String(row.created_at ?? new Date().toISOString()) });
    } else if (row.action === "unit_note_updated") {
      const noteId = String(row.details?.noteId ?? "");
      const existing = notesById.get(noteId);
      if (existing) notesById.set(noteId, { ...existing, text: String(row.details?.text ?? existing.text) });
    } else if (row.action === "unit_note_deleted") {
      notesById.delete(String(row.details?.noteId ?? ""));
    }
  }
  return Array.from(notesById.values());
}

export async function loadDailyTimesheetSummary(userId?: string) {
  if (!supabase) return null;
  let query = supabase.from("daily_timesheet_summary").select("*").order("work_date", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error?.code === "PGRST205") return null;
  if (error) throw error;
  return (data ?? []).map((row) => mapDailyTimesheetSummary(row as Record<string, unknown>));
}

export async function loadWeeklyTimesheetSummary(userId?: string) {
  if (!supabase) return null;
  let query = supabase.from("weekly_timesheet_summary").select("*").order("week_start", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error?.code === "PGRST205") return null;
  if (error) throw error;
  return (data ?? []).map((row) => mapWeeklyTimesheetSummary(row as Record<string, unknown>));
}

export async function loadPayrollLocks() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("payroll_period_locks").select("*\n").order("period_start", { ascending: false });
  if (error?.code === "PGRST205") return null;
  if (error) throw error;
  return (data ?? []).map((row) => mapPayrollPeriodLock(row as Record<string, unknown>));
}

export async function upsertPayrollLock(lock: { periodStart: string; periodEnd: string; lockedBy: string }) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("payroll_period_locks").upsert({
    period_start: lock.periodStart,
    period_end: lock.periodEnd,
    locked_by: lock.lockedBy,
    locked_at: new Date().toISOString(),
  }, { onConflict: "period_start,period_end" }).select().single();
  if (error?.code === "PGRST205") return null;
  if (error) throw error;
  return mapPayrollPeriodLock(data as Record<string, unknown>);
}

export function subscribeToFleet(onUnits: (change: RealtimeChange<CloudUnit>) => void, onJobs: (change: RealtimeChange<CloudJob>) => void, onError?: (message: string) => void, onUsers?: (change: RealtimeChange<CloudUser>) => void, onTimeEntries?: (change: RealtimeChange<CloudTimeEntry>) => void, timeEntryUserId?: string) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client.channel("rpm-diesel-fleet");
  channel.on("postgres_changes", { event: "*", schema: "public", table: "fleet_units" }, (payload) => {
    onUnits({ eventType: payload.eventType as RealtimeChange<CloudUnit>["eventType"], record: payload.new && Object.keys(payload.new).length ? mapUnit(payload.new as Record<string, unknown>) : null, oldRecord: payload.old && Object.keys(payload.old).length ? mapUnit(payload.old as Record<string, unknown>) : null });
  });
  channel.on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, (payload) => {
    onJobs({ eventType: payload.eventType as RealtimeChange<CloudJob>["eventType"], record: payload.new && Object.keys(payload.new).length ? mapJob(payload.new as Record<string, unknown>) : null, oldRecord: payload.old && Object.keys(payload.old).length ? mapJob(payload.old as Record<string, unknown>) : null });
  });
  channel.on("postgres_changes", { event: "*", schema: "public", table: "time_entries", ...(timeEntryUserId ? { filter: `user_id=eq.${timeEntryUserId}` } : {}) }, (payload) => {
    if (onTimeEntries) onTimeEntries({ eventType: payload.eventType as RealtimeChange<CloudTimeEntry>["eventType"], record: payload.new && Object.keys(payload.new).length ? mapTimeEntry(payload.new as Record<string, unknown>) : null, oldRecord: payload.old && Object.keys(payload.old).length ? mapTimeEntry(payload.old as Record<string, unknown>) : null });
  });
  channel.subscribe((status, error) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(error?.message ?? `Realtime channel ${status.toLowerCase()}`);
  });
  return () => { void client.removeChannel(channel); };
}

export { hasSupabaseConfig };
