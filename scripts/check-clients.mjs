// Shared client list: database rules check. Runs INSIDE a transaction and ROLLS BACK (nothing is left behind).
// Proves: technicians can read but not change the list; Admins can add/rename/remove (hide); nobody can delete a row;
// the sync state is server-only; clients_wave_apply only adds and attaches IDs, recorded as "Wave sync"; rollback works.
// Usage: npm run check:clients -- supabase/migrations/20261128000100_clients.sql   (until it's applied)
import { readFile } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
let failures = 0, sp = 0;
const ok = (c, label, detail = "") => { if (!c) failures++; console.log(`  ${c ? "✓" : "✗"} ${label}${!c && detail ? ` — ${detail}` : ""}`); };
async function as(role, claims, sql, params = []) {
  const name = `s${++sp}`;
  await client.query(`savepoint ${name}`);
  try {
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role })]);
    const r = await client.query(sql, params);
    await client.query("reset role");
    await client.query(`release savepoint ${name}`);
    return { rows: r.rows, count: r.rowCount, error: null };
  } catch (e) {
    await client.query(`rollback to savepoint ${name}`);
    return { rows: [], count: 0, error: e.message };
  }
}
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

try {
  await client.query("begin");
  await client.query("set local lock_timeout = '3s'; set local statement_timeout = '60s'");
  for (const file of process.argv.slice(2)) { await client.query(await readFile(file, "utf8")); console.log(`(applied ${file} inside the transaction)`); }
  const techAuth = "00000000-0000-4000-8000-0000000000d1", bossAuth = "00000000-0000-4000-8000-0000000000d2";
  for (const [id, email] of [[techAuth, "zz-clientcheck-tech@staff.rpm-diesel.ca"], [bossAuth, "zz-clientcheck-boss@staff.rpm-diesel.ca"]]) {
    await client.query(`insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`, [id, email]);
  }
  await client.query(`insert into public.user_accounts (id, name, role, active, is_technician, auth_user_id) values
    ('user-zz-clientcheck-tech', 'ZZ Clientcheck Tech', 'Technician', true, true, $1), ('user-zz-clientcheck-boss', 'ZZ Clientcheck Boss', 'Admin', true, false, $2)`, [techAuth, bossAuth]);
  const tech = { role: "authenticated", sub: techAuth }, boss = { role: "authenticated", sub: bossAuth };

  console.log("\nClient list:");
  let r = await as("authenticated", boss, `insert into public.clients (name) values ('ZZ Transport Test') returning id, created_by`);
  ok(r.rows.length === 1 && r.rows[0].created_by === "ZZ Clientcheck Boss", "Admin can add a client (recorded under their name)", r.error ?? JSON.stringify(r.rows));
  const id = r.rows[0]?.id;
  ok((await as("authenticated", tech, `select id from public.clients where id = $1`, [id])).rows.length === 1, "Technician can see the list");
  r = await as("authenticated", tech, `insert into public.clients (name) values ('ZZ Tech Added')`);
  ok(Boolean(r.error), "Technician cannot add", r.error ?? "inserted");
  r = await as("authenticated", tech, `insert into public.clients (name, pending) values ('ZZ Tech Proposed', true) returning created_by`);
  ok(r.rows[0]?.created_by === "ZZ Clientcheck Tech", "Technician can propose a name (waits for an Admin)", r.error ?? "");
  r = await as("authenticated", tech, `update public.clients set pending = false where name = 'ZZ Tech Proposed'`);
  ok(r.count === 0, "Technician cannot approve it", r.error ?? `${r.count} rows`);
  r = await as("authenticated", boss, `update public.clients set pending = false where name = 'ZZ Tech Proposed'`);
  ok(r.count === 1, "Admin can approve it", r.error ?? "");
  r = await as("authenticated", tech, `update public.clients set name = 'ZZ Hacked' where id = $1`, [id]);
  ok(r.count === 0, "Technician cannot rename", r.error ?? `${r.count} rows`);
  ok((await as("anon", null, `select * from public.clients`)).rows.length === 0, "public key sees nothing");
  r = await as("authenticated", boss, `update public.clients set name = 'ZZ Transport Test 2' where id = $1`, [id]);
  ok(r.count === 1, "Admin can rename", r.error ?? "");
  r = await as("authenticated", boss, `update public.clients set removed_at = now() where id = $1`, [id]);
  ok(r.count === 1, "Admin can remove (hide)", r.error ?? "");
  r = await as("authenticated", boss, `delete from public.clients where id = $1`, [id]);
  ok(Boolean(r.error) || r.count === 0, "nobody deletes a row for real", r.error ?? `${r.count} rows`);
  r = await as("authenticated", boss, `insert into public.clients (name) values ('  zz transport   TEST 2 ')`);
  ok(Boolean(r.error), "same name twice is refused (case/spaces)", r.error ?? "inserted");
  const audit = await q(`select count(*)::int n from public.money_audit_log where table_name = 'clients' and row_id = $1`, [id]);
  ok(audit[0].n >= 3, "add / rename / remove are in the audit log", `${audit[0].n}`);

  console.log("\nWave sync:");
  ok((await as("authenticated", boss, `select * from public.client_wave_state`)).rows.length === 0, "sync state is server-only");
  ok(Boolean((await as("authenticated", boss, `select public.clients_wave_apply('[]', '[]')`)).error), "Admin cannot call the apply function directly");
  await q(`select set_config('request.jwt.claims', '', true)`); // the server calls with no signed-in person
  await q(`insert into public.clients (name) values ('ZZ Link Me')`);
  const linkId = (await q(`select id from public.clients where name = 'ZZ Link Me'`))[0].id;
  const res = (await q(`select public.clients_wave_apply($1::jsonb, $2::jsonb) r`, [JSON.stringify([{ name: "ZZ From Wave", wave_id: "ZZW1" }, { name: "zz from wave", wave_id: "ZZW2" }]), JSON.stringify([{ client_id: linkId, wave_id: "ZZW3" }])]))[0].r;
  ok(res.added === 1 && res.linked === 1, "adds once (same name skipped) and attaches a Wave ID", JSON.stringify(res));
  const w = (await q(`select created_by, source from public.clients where wave_customer_id = 'ZZW1'`))[0];
  ok(w?.created_by === "Wave sync" && w?.source === "wave", "recorded as “Wave sync”", JSON.stringify(w));
  await q(`select public.clients_wave_apply('[]'::jsonb, $1::jsonb)`, [JSON.stringify([{ client_id: linkId, wave_id: "ZZW9" }])]);
  ok((await q(`select wave_customer_id from public.clients where id = $1`, [linkId]))[0].wave_customer_id === "ZZW3", "never replaces a Wave ID already attached");
  r = await as("authenticated", boss, `insert into public.client_wave_skip (wave_customer_id, wave_name, same_as) values ('ZZW5', 'X', 'Y') returning decided_by`);
  ok(r.rows[0]?.decided_by === "ZZ Clientcheck Boss", "Admin can mark “same client”", r.error ?? "");
  ok(Boolean((await as("authenticated", tech, `insert into public.client_wave_skip (wave_customer_id) values ('ZZW6')`)).error), "Technician cannot");

  console.log("\nWave Pro expired:");
  r = await as("service_role", { role: "service_role" }, `update public.money_wave_connection set status = 'pro_expired'`);
  ok(!r.error, "connection can be marked “Wave Pro expired”", r.error ?? "");

  console.log("\nRollback script:");
  await client.query("savepoint rb");
  await client.query(await readFile("supabase/rollback/20261128000100_clients_rollback.sql", "utf8"));
  if (process.argv.some((f) => f.includes("20261128000200"))) await client.query(await readFile("supabase/rollback/20261128000200_wave_pro_expired_rollback.sql", "utf8"));
  ok((await q(`select to_regclass('public.clients') t`))[0].t === null, "rollback removes the tables");
  await client.query("rollback to savepoint rb");
} catch (e) {
  failures++; console.error("✗ check crashed:", e.message);
} finally {
  await client.query("rollback");
  await client.end();
}
console.log(failures ? `\n${failures} problem(s). Nothing was kept (rolled back).` : "\nAll good. Nothing was kept (rolled back).");
process.exit(failures ? 1 : 0);
