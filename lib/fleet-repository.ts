import { hasSupabaseConfig, supabase } from "./supabase";

export type CloudUnit = {
  unit: string; vin: string; client: string; type: string; service: string;
  due: string; overdue: boolean; usage: string;
};
export type CloudJob = {
  id: string; unit: string; client: string; tech: string;
  priority: "High" | "Normal" | "Low";
  status: "In Progress" | "Waiting on Parts" | "Waiting on Estimates" | "Completed";
  issue: string; updated: string; usage: string; notes?: unknown[]; lineItems?: unknown[];
};
export type CloudUser = { id: string; name: string; role: "Admin" | "Technician"; password: string; active: boolean; isTechnician: boolean };
export type CloudTimeEntry = { id: string; userId: string; userName: string; workOrderId: string | null; clockIn: string; clockOut: string | null; totalHours: number | null; status: "active" | "completed" };
export type RealtimeChange<T> = { eventType: "INSERT" | "UPDATE" | "DELETE"; record: T | null; oldRecord: Partial<T> | null };

function mapUnit(row: Record<string, unknown>): CloudUnit {
  return { unit: String(row.unit), vin: String(row.vin), client: String(row.client), type: String(row.type), service: String(row.service), due: String(row.due), overdue: Boolean(row.overdue), usage: String(row.usage) };
}

function mapJob(row: Record<string, unknown>): CloudJob {
  return { id: String(row.id), unit: String(row.unit), client: String(row.client), tech: String(row.tech), priority: row.priority as CloudJob["priority"], status: row.status as CloudJob["status"], issue: String(row.issue), updated: String(row.updated), usage: String(row.usage), notes: Array.isArray(row.notes) ? row.notes : [], lineItems: Array.isArray(row.line_items) ? row.line_items : [] };
}
function mapUser(row: Record<string, unknown>): CloudUser {
  return { id: String(row.id), name: String(row.name), role: row.role as CloudUser["role"], password: String(row.password), active: Boolean(row.active), isTechnician: Boolean(row.is_technician) };
}
function mapTimeEntry(row: Record<string, unknown>): CloudTimeEntry {
  return { id: String(row.id), userId: String(row.user_id), userName: String(row.user_name), workOrderId: row.work_order_id ? String(row.work_order_id) : null, clockIn: String(row.clock_in), clockOut: row.clock_out ? String(row.clock_out) : null, totalHours: row.total_hours == null ? null : Number(row.total_hours), status: row.status as CloudTimeEntry["status"] };
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
  if (!supabase) return;
  const { error } = await supabase.from("fleet_units").upsert(units.map((unit) => ({ ...unit, updated_at: new Date().toISOString() })), { onConflict: "unit" });
  if (error) throw error;
}

export async function saveJobs(jobs: CloudJob[]) {
  if (!supabase) return;
  const { error } = await supabase.from("work_orders").upsert(jobs.map((job) => ({
    id: job.id,
    unit: job.unit,
    client: job.client,
    tech: job.tech,
    priority: job.priority,
    status: job.status,
    issue: job.issue,
    updated: job.updated,
    usage: job.usage,
    notes: job.notes ?? [],
    line_items: job.lineItems ?? [],
    updated_at: new Date().toISOString(),
  })), { onConflict: "id" });
  if (error) throw error;
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
  const { error } = await supabase.from("user_accounts").upsert(users.map((user) => ({ id: user.id, name: user.name, role: user.role, password: user.password, active: user.active, is_technician: user.isTechnician, updated_at: new Date().toISOString() })), { onConflict: "id" });
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
  const { data, error } = await supabase.from("time_entries").insert({ user_id: entry.userId, user_name: entry.userName, work_order_id: entry.workOrderId, clock_in: entry.clockIn, status: "active" }).select().single();
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

export async function removeUnit(unit: string) {
  if (!supabase) return;
  const { error } = await supabase.from("fleet_units").delete().eq("unit", unit);
  if (error) throw error;
}

export async function removeJob(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("work_orders").delete().eq("id", id);
  if (error) throw error;
}

export async function writeActivityLog(actor: string, action: string, entityType: "unit" | "work_order", entityId: string, details: Record<string, unknown> = {}) {
  if (!supabase) return;
  const { error } = await supabase.from("activity_logs").insert({ actor, action, entity_type: entityType, entity_id: entityId, details });
  if (error) throw error;
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
