// Wave → Money sync: database rules check. Runs INSIDE a transaction and ROLLS BACK (nothing is left behind).
// Proves: Wave tokens are unreadable even for Admins; only the server can apply a sync; changes are recorded as
// "Wave sync"; closed months are never changed (but a Wave ID can be attached); Admins can map categories and
// resolve review items (recorded under their own name); the rollback script works.
// Usage: npm run check:wave                 (live database)
//        npm run check:wave -- <file.sql>   (applies a migration first, inside the same rolled-back transaction)
import { readFile } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
let failures = 0;
const ok = (c, label, detail = "") => { if (!c) failures++; console.log(`  ${c ? "✓" : "✗"} ${label}${!c && detail ? ` — ${detail}` : ""}`); };
let sp = 0;
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
  for (const file of process.argv.slice(2)) {
    await client.query(await readFile(file, "utf8"));
    console.log(`(applied ${file} inside the transaction)`);
  }
  const techAuth = "00000000-0000-4000-8000-0000000000c1", bossAuth = "00000000-0000-4000-8000-0000000000c2";
  for (const [id, email] of [[techAuth, "zz-wavecheck-tech@staff.rpm-diesel.ca"], [bossAuth, "zz-wavecheck-boss@staff.rpm-diesel.ca"]]) {
    await client.query(`insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`, [id, email]);
  }
  await client.query(`insert into public.user_accounts (id, name, role, active, is_technician, auth_user_id) values
    ('user-zz-wavecheck-tech', 'ZZ Wavecheck Tech', 'Technician', true, true, $1), ('user-zz-wavecheck-boss', 'ZZ Wavecheck Boss', 'Admin', true, false, $2)`, [techAuth, bossAuth]);
  const tech = { role: "authenticated", sub: techAuth }, boss = { role: "authenticated", sub: bossAuth };

  // Sample rows the server would write.
  await q(`delete from public.money_wave_connection`);
  await q(`insert into public.money_wave_connection (id, business_id, business_name, access_token_enc) values (1, 'B', 'ZZ Biz', 'v1:secret')`);
  await q(`insert into public.money_wave_map (wave_ref, kind, label, suggested_category_id) values ('product:ZZ', 'item', 'ZZ Hour rate', 'labour_revenue')`);
  await q(`insert into public.money_wave_review (ref, kind, title) values ('csv:ZZ', 'unmatched', 'ZZ Client')`);
  await q(`insert into public.money_wave_runs (mode, trigger) values ('dry-run', 'manual')`);

  console.log("\nTokens:");
  for (const [who, claims] of [["Admin", boss], ["Technician", tech]]) {
    const r = await as("authenticated", claims, `select access_token_enc from public.money_wave_connection`);
    ok(r.rows.length === 0, `${who} cannot read the Wave tokens`, r.error ?? `${r.rows.length} rows`);
  }
  ok((await as("anon", null, `select * from public.money_wave_connection`)).rows.length === 0, "public key cannot read the Wave tokens");

  console.log("\nAdmin:");
  ok((await as("authenticated", boss, `select * from public.money_wave_runs`)).rows.length >= 1, "can see sync runs");
  ok((await as("authenticated", boss, `update public.money_wave_map set category_id = 'labour_revenue' where wave_ref = 'product:ZZ'`)).count === 1, "can choose a category for a Wave item");
  ok(Boolean((await as("authenticated", boss, `update public.money_wave_map set label = 'hacked' where wave_ref = 'product:ZZ'`)).error), "cannot rename Wave items");
  ok(Boolean((await as("authenticated", boss, `insert into public.money_wave_review (ref, kind) values ('x', 'gap')`)).error), "cannot invent review items");
  ok(Boolean((await as("authenticated", boss, `insert into public.money_wave_runs (mode, trigger) values ('sync', 'manual')`)).error), "cannot fake a sync run");
  ok(Boolean((await as("authenticated", boss, `select public.money_wave_apply('[]'::jsonb)`)).error), "cannot apply a sync (server only)");
  const res = await as("authenticated", boss, `update public.money_wave_review set resolution = 'ignored', resolved_at = now() where ref = 'csv:ZZ' returning resolved_by`);
  ok(res.rows[0]?.resolved_by === "ZZ Wavecheck Boss", "resolving a review item is recorded under the Admin's name", res.error ?? JSON.stringify(res.rows));
  const mapAudit = await q(`select actor from public.money_audit_log where table_name = 'money_wave_map' and row_id = 'product:ZZ' and action = 'update' order by id desc limit 1`);
  ok(mapAudit[0]?.actor === "ZZ Wavecheck Boss", "category choice is in the audit history", JSON.stringify(mapAudit));

  console.log("\nTechnician / public key:");
  ok((await as("authenticated", tech, `update public.money_wave_map set category_id = 'parts_sales'`)).count === 0, "Technician cannot change the mapping");
  ok(Boolean((await as("authenticated", tech, `select public.money_wave_apply('[]'::jsonb)`)).error), "Technician cannot apply a sync");
  ok(Boolean((await as("anon", null, `select public.money_wave_apply('[]'::jsonb)`)).error), "public key cannot apply a sync");

  console.log("\nApplying a sync (server):");
  const row = (o) => JSON.stringify(o);
  const ins = { kind: "in", date: "2026-10-15", category_id: "labour_revenue", party: "ZZ Client", description: "ZZ Payment", total_cents: 11498, gst_cents: 500, qst_cents: 998, payment_method: "credit", wave_key: "wp:ZZPAY:labour_revenue", wave_payment_id: "ZZPAY" };
  const r1 = await as("service_role", { role: "service_role" }, `select public.money_wave_apply($1::jsonb) as r`, [row([{ op: "insert", row: ins }, { op: "insert", row: ins }, { op: "bogus" }])]);
  ok(r1.rows[0]?.r.done === 1, "adds the entry once, even if sent twice", r1.error ?? JSON.stringify(r1.rows[0]?.r));
  ok(r1.rows[0]?.r.failed.length === 1, "a bad line is reported without stopping the others");
  const e = (await q(`select id, created_by, source, net_cents, paid_on from public.money_entries where wave_key = 'wp:ZZPAY:labour_revenue'`))[0];
  ok(e?.created_by === "Wave sync" && e?.source === "wave" && Number(e?.net_cents) === 10000, "recorded as “Wave sync”, source wave, taxes exact", JSON.stringify(e));
  const audit = await q(`select actor from public.money_audit_log where table_name = 'money_entries' and row_id = $1`, [e.id]);
  ok(audit.length === 1 && audit[0].actor === "Wave sync", "audit history says “Wave sync”", JSON.stringify(audit));
  const r2 = await as("service_role", { role: "service_role" }, `select public.money_wave_apply($1::jsonb) as r`, [row([{ op: "update", id: e.id, row: { ...ins, total_cents: 22996, gst_cents: 1000, qst_cents: 1996 } }])]);
  ok(r2.rows[0]?.r.done === 1 && Number((await q(`select total_cents from public.money_entries where id = $1`, [e.id]))[0].total_cents) === 22996, "updates a changed payment");
  const upd = await q(`select actor, old_data->>'total_cents' a, new_data->>'total_cents' b from public.money_audit_log where row_id = $1 and action = 'update' order by id desc limit 1`, [e.id]);
  ok(upd[0]?.actor === "Wave sync" && upd[0]?.a === "11498" && upd[0]?.b === "22996", "the edit is in the audit history with old and new values", JSON.stringify(upd));

  console.log("\nClosed month:");
  const csv = (await q(`insert into public.money_entries (kind, entry_date, category_id, total_cents, source, import_key) values ('in', '2026-10-20', 'parts_sales', 5000, 'import', 'wave|zz') returning id`))[0];
  await q(`insert into public.money_month_locks (month) values ('2026-10-01')`);
  const r3 = await as("service_role", { role: "service_role" }, `select public.money_wave_apply($1::jsonb) as r`, [row([{ op: "update", id: e.id, row: { ...ins, total_cents: 1 , gst_cents: 0, qst_cents: 0 } }, { op: "trash", id: e.id }])]);
  ok(r3.rows[0]?.r.done === 0 && r3.rows[0]?.r.failed.every((f) => f.error.includes("money_month_locked")), "a sync can never change or remove an entry in a closed month", JSON.stringify(r3.rows[0]?.r));
  const r4 = await as("service_role", { role: "service_role" }, `select public.money_wave_apply($1::jsonb) as r`, [row([{ op: "link", id: csv.id, wave_key: "wp:ZZ2:parts_sales", wave_payment_id: "ZZ2" }])]);
  ok(r4.rows[0]?.r.done === 1, "…but it can attach a Wave ID to an existing entry (the money doesn't change)", JSON.stringify(r4.rows[0]?.r ?? r4.error));
  ok(Boolean((await as("authenticated", boss, `update public.money_entries set total_cents = 1 where id = $1`, [csv.id])).error), "a person still can't change that closed-month entry");

  console.log("\nPeople are still recorded under their own name:");
  await q(`delete from public.money_month_locks where month = '2026-10-01'`);
  const mine = await as("authenticated", boss, `insert into public.money_entries (kind, entry_date, category_id, total_cents) values ('out', '2026-10-21', 'fuel', 100) returning created_by`);
  ok(mine.rows[0]?.created_by === "ZZ Wavecheck Boss", "an Admin's own entry says the Admin's name", mine.error ?? JSON.stringify(mine.rows));

  if ((await q(`select to_regclass('public.money_bank_rules') as t`))[0].t) {
    console.log("\nRemembered bank lines + tax setting + receipt reference:");
    const add = await as("authenticated", boss, `insert into public.money_bank_rules (match_key, kind, action) values ('virement interac a', 'out', 'transfer') returning created_by`);
    ok(add.rows[0]?.created_by === "ZZ Wavecheck Boss", "an Admin's “not an expense” choice is remembered under their name", add.error ?? "");
    ok(Boolean((await as("authenticated", boss, `insert into public.money_bank_rules (match_key, kind, action) values ('petro can', 'out', 'category')`)).error), "a category rule must name a category");
    ok(Boolean((await as("authenticated", tech, `insert into public.money_bank_rules (match_key, kind, action) values ('x y', 'out', 'transfer')`)).error), "a Technician cannot add rules");
    ok((await as("authenticated", tech, `delete from public.money_bank_rules`)).count === 0, "a Technician cannot remove rules");
    const ruleAudit = await q(`select actor from public.money_audit_log where table_name = 'money_bank_rules' and row_id = 'virement interac a'`);
    ok(ruleAudit[0]?.actor === "ZZ Wavecheck Boss", "rules are in the audit history", JSON.stringify(ruleAudit));
    const modes = await q(`select id, tax_mode from public.money_categories where id in ('fuel', 'insurance', 'bank_fees', 'parts_purchases') order by id`);
    ok(JSON.stringify(modes.map((m) => m.tax_mode)) === JSON.stringify(["none", "gst_qst", "none", "gst_qst"]), "tax settings start from “taxable yes/no” (bank fees, insurance: no tax)", JSON.stringify(modes));
    const ref = await as("authenticated", boss, `insert into public.money_entries (kind, entry_date, category_id, total_cents, receipt_ref) values ('out', '2026-10-23', 'fuel', 100, 'Facture 4412') returning receipt_ref`);
    ok(ref.rows[0]?.receipt_ref === "Facture 4412", "an entry keeps its receipt reference", ref.error ?? "");
    await client.query("savepoint rb2");
    try {
      await client.query(await readFile("supabase/rollback/20261123000200_money_expenses_rollback.sql", "utf8"));
      const gone = await q(`select (select count(*) from information_schema.columns where table_name = 'money_entries' and column_name = 'receipt_ref')::int a, (select count(*) from information_schema.columns where table_name = 'money_categories' and column_name = 'tax_mode')::int b, (to_regclass('public.money_bank_rules') is null) c`);
      ok(gone[0].a === 0 && gone[0].b === 0 && gone[0].c, "the expenses rollback removes exactly what it added");
    } catch (err) { ok(false, "expenses rollback runs", err.message); }
    await client.query("rollback to savepoint rb2");
  }

  console.log("\nRollback script:");
  await client.query("savepoint rb");
  try {
    await client.query(await readFile("supabase/rollback/20261123000100_money_wave_sync_rollback.sql", "utf8"));
    const cols = await q(`select column_name from information_schema.columns where table_name = 'money_entries' and column_name like 'wave%'`);
    const tables = await q(`select tablename from pg_tables where tablename like 'money_wave%'`);
    ok(cols.length === 0 && tables.length === 0, "removes everything the migration added");
    ok((await q(`select count(*)::int n from public.money_entries where source = 'wave'`))[0].n === 0, "synced entries stay (as imported entries)");
    const after = await as("authenticated", boss, `insert into public.money_entries (kind, entry_date, category_id, total_cents) values ('out', '2026-10-22', 'fuel', 100) returning created_by`);
    ok(after.rows[0]?.created_by === "ZZ Wavecheck Boss", "original stamping works after rollback", after.error ?? "");
  } catch (err) {
    ok(false, "rollback script runs", err.message);
  }
  await client.query("rollback to savepoint rb");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll Wave sync checks passed (everything rolled back)");
process.exit(failures ? 1 : 0);
