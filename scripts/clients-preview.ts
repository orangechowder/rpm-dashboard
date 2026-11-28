// READ-ONLY preview of Wave customers → client list, before the database change is applied.
//   npm run clients:preview                 compares with every client name the live database already knows
//                                           (units, work orders, Money clients) + the list built into app/page.tsx
//   npm run clients:preview -- names.json   compares with a list you export from a browser (JSON array of names)
// Sends only GraphQL queries to Wave; writes nothing anywhere.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { allPages, decrypt, graphqlClient, Q_CUSTOMERS } from "../lib/server/wave";
import { planClientSync } from "../lib/clients/wave-match";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
const { data: conn } = await db.from("money_wave_connection").select("business_id,access_token_enc,token_expires_at").eq("id", 1).maybeSingle();
if (!conn) { console.error("No Wave connection stored."); process.exit(1); }
if (conn.token_expires_at && Date.parse(conn.token_expires_at) < Date.now()) { console.error("The Wave token has expired; run “Sync now” or the dry run in Money once, then retry."); process.exit(1); }

const file = process.argv[2];
async function databaseNames(): Promise<string[]> {
  const out: string[] = [];
  for (const [table, column, filter] of [["clients", "name", null], ["fleet_units", "client", null], ["work_orders", "client", null], ["money_parties", "name", ["client", "both"]]] as const) {
    let query = db.from(table).select(column).limit(10000);
    if (filter) query = query.in("kind", filter as unknown as string[]);
    const { data, error } = await query;
    if (error) { if (table !== "clients") console.error(`(could not read ${table}: ${error.message})`); continue; }
    out.push(...(data ?? []).map((r) => String((r as Record<string, unknown>)[column] ?? "")));
  }
  return out;
}
const builtIn: string[] = JSON.parse(`[${(await readFile("app/page.tsx", "utf8")).match(/const defaultClients = \[([\s\S]*?)\];/)![1].replace(/,\s*$/, "")}]`);
const fromDb = file ? [] : await databaseNames();
const names = [...new Set((file ? JSON.parse(await readFile(file, "utf8")) as string[] : [...builtIn, ...fromDb]).map((n) => n.trim()).filter(Boolean))];
if (!file) console.log(`\nList used: ${builtIn.length} built-in names + ${new Set(fromDb.map((n) => n.trim()).filter(Boolean)).size} names found in the live database (units, work orders, Money clients).`);
const raw = await allPages(graphqlClient(decrypt(conn.access_token_enc)), Q_CUSTOMERS, conn.business_id, "customers");
const plan = planClientSync(names.map((name, i) => ({ id: `local-${i}`, name, waveId: null, removed: false })), raw.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), archived: Boolean(r.isArchived) })));

console.log(`Compared with ${file ?? "that list"} (${names.length} names). Wave: ${plan.counts.wave} customers (${plan.counts.archived} archived, skipped).`);
console.log(`Already in the list: ${plan.counts.alreadyThere}\n\nWOULD ADD (${plan.add.length}):`);
for (const a of plan.add) console.log(`  + ${a.name}`);
console.log(`\nCHECK THESE (${plan.check.length}), not added:`);
for (const c of plan.check) console.log(`  ? ${c.waveName}   ~ ${c.similar.join(" | ")}`);
