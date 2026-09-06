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
export type RealtimeChange<T> = { eventType: "INSERT" | "UPDATE" | "DELETE"; record: T | null; oldRecord: Partial<T> | null };

function mapUnit(row: Record<string, unknown>): CloudUnit {
  return { unit: String(row.unit), vin: String(row.vin), client: String(row.client), type: String(row.type), service: String(row.service), due: String(row.due), overdue: Boolean(row.overdue), usage: String(row.usage) };
}

function mapJob(row: Record<string, unknown>): CloudJob {
  return { id: String(row.id), unit: String(row.unit), client: String(row.client), tech: String(row.tech), priority: row.priority as CloudJob["priority"], status: row.status as CloudJob["status"], issue: String(row.issue), updated: String(row.updated), usage: String(row.usage), notes: Array.isArray(row.notes) ? row.notes : [], lineItems: Array.isArray(row.line_items) ? row.line_items : [] };
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
  const { error } = await supabase.from("work_orders").upsert(jobs.map((job) => ({ ...job, line_items: job.lineItems ?? [], notes: job.notes ?? [], updated_at: new Date().toISOString() })), { onConflict: "id" });
  if (error) throw error;
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

export function subscribeToFleet(onUnits: (change: RealtimeChange<CloudUnit>) => void, onJobs: (change: RealtimeChange<CloudJob>) => void, onError?: (message: string) => void) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client.channel("rpm-diesel-fleet");
  channel.on("postgres_changes", { event: "*", schema: "public", table: "fleet_units" }, (payload) => {
    onUnits({ eventType: payload.eventType as RealtimeChange<CloudUnit>["eventType"], record: payload.new && Object.keys(payload.new).length ? mapUnit(payload.new as Record<string, unknown>) : null, oldRecord: payload.old && Object.keys(payload.old).length ? mapUnit(payload.old as Record<string, unknown>) : null });
  });
  channel.on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, (payload) => {
    onJobs({ eventType: payload.eventType as RealtimeChange<CloudJob>["eventType"], record: payload.new && Object.keys(payload.new).length ? mapJob(payload.new as Record<string, unknown>) : null, oldRecord: payload.old && Object.keys(payload.old).length ? mapJob(payload.old as Record<string, unknown>) : null });
  });
  channel.subscribe((status, error) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(error?.message ?? `Realtime channel ${status.toLowerCase()}`);
  });
  return () => { void client.removeChannel(channel); };
}

export { hasSupabaseConfig };
