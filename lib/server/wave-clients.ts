// Wave customers → shared client list (public.clients). ADD ONLY; read-only on Wave's side.
// Preview (dry run) writes nothing in the list. Adds start only after an Admin approves a preview; after that
// they run with the nightly sync and "Sync now". Changes go through clients_wave_apply() → audited as "Wave sync".
import type { SupabaseClient } from "@supabase/supabase-js";
import { planClientSync, type ClientPlan, type ListClient, type WaveCustomer } from "../clients/wave-match";
import { allPages, Q_CUSTOMERS, type GraphQL } from "./wave";

export type ClientSyncSummary = {
  mode: "preview" | "sync"; applied: boolean; at: string; counts: ClientPlan["counts"];
  add: ClientPlan["add"]; check: ClientPlan["check"]; linked: number; added: number;
};
export type ClientSyncState = { approved_at: string | null; approved_by: string | null; last_run_at: string | null; last_mode: string | null; last_summary: ClientSyncSummary | null; last_error: string | null };

export async function loadClientState(db: SupabaseClient): Promise<ClientSyncState | null> {
  const { data, error } = await db.from("client_wave_state").select("approved_at,approved_by,last_run_at,last_mode,last_summary,last_error").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClientSyncState | null) ?? null;
}

async function loadList(db: SupabaseClient): Promise<{ list: ListClient[]; skipped: Set<string> }> {
  const list: ListClient[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("clients").select("id,name,wave_customer_id,removed_at").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) list.push({ id: String(r.id), name: String(r.name), waveId: r.wave_customer_id ? String(r.wave_customer_id) : null, removed: Boolean(r.removed_at) });
    if (!data || data.length < 1000) break;
  }
  const { data: skip, error } = await db.from("client_wave_skip").select("wave_customer_id");
  if (error) throw new Error(error.message);
  return { list, skipped: new Set((skip ?? []).map((s) => String(s.wave_customer_id))) };
}

/** apply=false: preview only. apply=true: also needs the Admin's approval to be on record. */
export async function syncWaveClients(db: SupabaseClient, gql: GraphQL, businessId: string, options: { apply: boolean }): Promise<ClientSyncSummary> {
  const state = await loadClientState(db);
  const apply = options.apply && Boolean(state?.approved_at);
  const raw = await allPages(gql, Q_CUSTOMERS, businessId, "customers");
  const customers: WaveCustomer[] = raw.map((r) => ({ id: String(r.id ?? ""), name: String(r.name ?? ""), archived: Boolean(r.isArchived) }));
  const { list, skipped } = await loadList(db);
  const plan = planClientSync(list, customers, skipped);
  let added = 0, linked = 0;
  if (apply && (plan.add.length || plan.link.length)) {
    const { data, error } = await db.rpc("clients_wave_apply", {
      adds: plan.add.map((a) => ({ name: a.name, wave_id: a.waveId })),
      links: plan.link.map((l) => ({ client_id: l.clientId, wave_id: l.waveId })),
    });
    if (error) throw new Error(error.message);
    added = Number((data as { added?: number })?.added ?? 0);
    linked = Number((data as { linked?: number })?.linked ?? 0);
  }
  const at = new Date().toISOString();
  const summary: ClientSyncSummary = { mode: apply ? "sync" : "preview", applied: apply, at, counts: plan.counts, add: plan.add, check: plan.check, linked, added };
  await db.from("client_wave_state").upsert({ id: 1, last_run_at: at, last_mode: summary.mode, last_summary: summary, last_error: null }, { onConflict: "id" });
  return summary;
}

/** Never lets a customer problem stop the Money sync: the error is saved and shown on the card. */
export async function syncWaveClientsSafely(db: SupabaseClient, gql: GraphQL, businessId: string, options: { apply: boolean }): Promise<ClientSyncSummary | { error: string }> {
  try { return await syncWaveClients(db, gql, businessId, options); } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.from("client_wave_state").upsert({ id: 1, last_run_at: new Date().toISOString(), last_error: message }, { onConflict: "id" });
    return { error: message };
  }
}
