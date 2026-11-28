// Shared client list (public.clients). Everyone signed in reads it; only Admins change it (database rules).
import { supabase } from "../supabase";

export type ClientRow = { id: string; name: string; removed: boolean; pending: boolean; createdBy: string | null };

export async function loadClients(): Promise<ClientRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("clients").select("id,name,removed_at,pending,created_by").order("name");
  if (error) return null; // table not there yet (migration not applied) → the screen keeps the browser's list
  return (data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), removed: Boolean(r.removed_at), pending: Boolean(r.pending), createdBy: r.created_by ? String(r.created_by) : null }));
}

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Technician adding a name from the unit form: it waits for an Admin in "Check these". */
export async function proposeClient(name: string, rows: ClientRow[]) {
  if (rows.some((r) => key(r.name) === key(name))) return; // already there, waiting, or removed by an Admin
  const { error } = await supabase!.from("clients").insert({ name: name.trim(), source: "dashboard", pending: true });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
}

/** Admin "Check these": approve a technician's name, or leave it out (hidden; the unit keeps its name). */
export async function decidePending(id: string, approve: boolean) {
  const { error } = await supabase!.from("clients").update(approve ? { pending: false } : { pending: false, removed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Adds a client, or brings back one that was removed (or approves one waiting) under the same name. */
export async function addClient(name: string, rows: ClientRow[]) {
  const existing = rows.find((r) => key(r.name) === key(name));
  if (existing && !existing.removed && !existing.pending) return;
  const { error } = existing
    ? await supabase!.from("clients").update({ removed_at: null, pending: false }).eq("id", existing.id)
    : await supabase!.from("clients").insert({ name: name.trim(), source: "dashboard" });
  if (error) throw new Error(error.message);
}

export async function renameClient(id: string, name: string) {
  const { error } = await supabase!.from("clients").update({ name: name.trim() }).eq("id", id);
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "A client with that name already exists." : error.message);
}

/** Hidden, not deleted: units/work orders keep their name, and the Wave sync won't add it back. */
export async function removeClient(id: string) {
  const { error } = await supabase!.from("clients").update({ removed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** One-time move of this browser's list into the shared table (names already there, even removed ones, are skipped). */
export async function moveBrowserList(names: string[], rows: ClientRow[]): Promise<number> {
  const have = new Set(rows.map((r) => key(r.name)));
  const missing = [...new Map(names.map((n) => n.trim()).filter((n) => n && n.length <= 120 && !have.has(key(n))).map((n) => [key(n), n])).values()];
  if (!missing.length) return 0;
  const { error } = await supabase!.from("clients").upsert(missing.map((name) => ({ name, source: "dashboard" })), { onConflict: "name_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return missing.length;
}
