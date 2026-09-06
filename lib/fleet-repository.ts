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

export async function loadFleetData() {
  if (!supabase) return null;
  const [{ data: unitRows, error: unitError }, { data: jobRows, error: jobError }] = await Promise.all([
    supabase.from("fleet_units").select("*").order("unit"),
    supabase.from("work_orders").select("*").order("updated_at", { ascending: false }),
  ]);
  if (unitError) throw unitError;
  if (jobError) throw jobError;
  return {
    units: (unitRows ?? []).map((row) => ({ unit: row.unit, vin: row.vin, client: row.client, type: row.type, service: row.service, due: row.due, overdue: row.overdue, usage: row.usage } satisfies CloudUnit)),
    jobs: (jobRows ?? []).map((row) => ({ id: row.id, unit: row.unit, client: row.client, tech: row.tech, priority: row.priority, status: row.status, issue: row.issue, updated: row.updated, usage: row.usage, notes: row.notes ?? [], lineItems: row.line_items ?? [] } satisfies CloudJob)),
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

export function subscribeToFleet(onUnits: (units: CloudUnit[]) => void, onJobs: (jobs: CloudJob[]) => void, onError?: (message: string) => void) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client.channel("rpm-diesel-fleet");
  channel.on("postgres_changes", { event: "*", schema: "public", table: "fleet_units" }, async () => {
    const data = await loadFleetData();
    if (data) onUnits(data.units);
  });
  channel.on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, async () => {
    const data = await loadFleetData();
    if (data) onJobs(data.jobs);
  });
  channel.subscribe((status, error) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(error?.message ?? `Realtime channel ${status.toLowerCase()}`);
  });
  return () => { void client.removeChannel(channel); };
}

export { hasSupabaseConfig };
