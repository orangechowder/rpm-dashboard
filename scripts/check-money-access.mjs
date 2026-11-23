// Money / Argent security check. Runs INSIDE a transaction and ROLLS BACK: nothing is left behind
// (no test entries, no audit rows). Proves: Admins only (tables + receipts bucket), public key and
// Technicians get nothing, closed months are frozen, entries can't be hard-deleted, the audit log is
// append-only and records who/old/new.
// Usage: npm run check:money                (checks the live database)
//        npm run check:money -- <file.sql>  (applies a migration first, inside the same rolled-back transaction)
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

try {
  await client.query("begin");
  await client.query("set local lock_timeout = '3s'; set local statement_timeout = '30s'");
  for (const file of process.argv.slice(2)) {
    await client.query(await readFile(file, "utf8"));
    console.log(`(applied ${file} inside the transaction)`);
  }
  const techAuth = "00000000-0000-4000-8000-0000000000b1", bossAuth = "00000000-0000-4000-8000-0000000000b2";
  for (const [id, email] of [[techAuth, "zz-moneycheck-tech@staff.rpm-diesel.ca"], [bossAuth, "zz-moneycheck-boss@staff.rpm-diesel.ca"]]) {
    await client.query(`insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`, [id, email]);
  }
  await client.query(`insert into public.user_accounts (id, name, role, active, is_technician, auth_user_id) values
    ('user-zz-moneycheck-tech', 'ZZ Moneycheck Tech', 'Technician', true, true, $1), ('user-zz-moneycheck-boss', 'ZZ Moneycheck Boss', 'Admin', true, false, $2)`, [techAuth, bossAuth]);
  const tech = { role: "authenticated", sub: techAuth }, boss = { role: "authenticated", sub: bossAuth };
  // Every Money table that exists (so new ones are covered automatically).
  const tables = (await client.query(`select tablename from pg_tables where schemaname = 'public' and tablename like 'money\\_%' order by 1`)).rows.map((r) => r.tablename);
  const insertEntry = `insert into public.money_entries (kind, entry_date, category_id, party_name, total_cents, gst_cents, qst_cents, taxes_included) values ('out', $1, 'fuel', 'Petro-Canada', 11498, 500, 998, true) returning id, net_cents, created_by`;

  console.log("\nPublic key (anon):");
  for (const t of tables) {
    const r = await as("anon", null, `select * from public.${t} limit 1`);
    ok(r.rows.length === 0, `${t}: nothing readable`, r.error ?? `${r.rows.length} rows`);
  }
  ok(Boolean((await as("anon", null, insertEntry, ["2026-11-05"])).error), "cannot add an entry");
  ok(Boolean((await as("anon", null, `insert into storage.objects (bucket_id, name) values ('money-receipts', 'x/anon.jpg')`)).error), "cannot upload a receipt");

  console.log("\nTechnician:");
  for (const t of tables) {
    const r = await as("authenticated", tech, `select * from public.${t} limit 1`);
    ok(r.rows.length === 0, `${t}: nothing readable`, r.error ?? `${r.rows.length} rows`);
  }
  ok(Boolean((await as("authenticated", tech, insertEntry, ["2026-11-05"])).error), "cannot add an entry");
  ok((await as("authenticated", tech, `update public.money_settings set tax_frequency = 'monthly' returning id`)).rows.length === 0, "cannot change settings");
  ok(Boolean((await as("authenticated", tech, `insert into storage.objects (bucket_id, name) values ('money-receipts', 'x/tech.jpg')`)).error), "cannot upload a receipt");

  console.log("\nAdmin:");
  const made = await as("authenticated", boss, insertEntry, ["2026-11-05"]);
  ok(!made.error && Number(made.rows[0]?.net_cents) === 10000, "adds an entry; amount before taxes is computed by the database", made.error);
  ok(made.rows[0]?.created_by === "ZZ Moneycheck Boss", "who is recorded by the server, not the browser", made.rows[0]?.created_by);
  const id = made.rows[0]?.id;
  ok((await as("authenticated", boss, `select count(*)::int n from public.money_categories`)).rows[0]?.n === 21, "sees the 21 categories");
  ok(Boolean((await as("authenticated", boss, `insert into public.money_entries (kind, entry_date, category_id, total_cents, gst_cents, qst_cents) values ('out', '2026-11-05', 'fuel', 100, 80, 30)`)).error), "refuses taxes bigger than the total");
  ok(Boolean((await as("authenticated", boss, `insert into public.money_entries (kind, entry_date, category_id, total_cents) values ('out', '2026-11-05', 'fuel', -5)`)).error), "refuses a negative amount");
  const edit = await as("authenticated", boss, `update public.money_entries set total_cents = 22996, gst_cents = 1000, qst_cents = 1996 where id = $1 returning net_cents`, [id]);
  ok(Number(edit.rows[0]?.net_cents) === 20000, "can edit", edit.error);
  ok(Boolean((await as("authenticated", boss, `delete from public.money_entries where id = $1`, [id])).error), "can't hard-delete (trash only)");
  ok((await as("service_role", null, `delete from public.money_entries where id = $1`, [id])).error?.includes("money_forbidden") === true, "can't hard-delete even with the server key");
  ok((await as("authenticated", boss, `update public.money_entries set deleted_at = now() where id = $1 returning deleted_by`, [id])).rows[0]?.deleted_by === "ZZ Moneycheck Boss", "moves to trash, records who");
  ok((await as("authenticated", boss, `update public.money_entries set deleted_at = null where id = $1 returning id`, [id])).rows.length === 1, "restores from trash");

  const audit = await as("authenticated", boss, `select action, actor, old_data->>'total_cents' old_total, new_data->>'total_cents' new_total from public.money_audit_log where row_id = $1 order by id`, [id]);
  ok(audit.rows.length === 4 && audit.rows[1].old_total === "11498" && audit.rows[1].new_total === "22996" && audit.rows.every((r) => r.actor === "ZZ Moneycheck Boss"), "audit log: who, old value, new value for each change", JSON.stringify(audit.rows));
  ok(Boolean((await as("authenticated", boss, `update public.money_audit_log set actor = 'x'`)).error), "audit log can't be edited by an Admin");
  ok(Boolean((await as("authenticated", boss, `delete from public.money_audit_log`)).error), "audit log can't be deleted by an Admin");
  ok(Boolean((await as("service_role", null, `update public.money_audit_log set actor = 'x'`)).error), "audit log can't be edited even with the server key");
  ok(Boolean((await as("authenticated", tech, `select * from public.money_audit_log`)).rows.length === 0), "Technician can't read the audit log");

  ok(!(await as("authenticated", boss, `insert into public.money_month_locks (month) values ('2026-11-01')`)).error, "closes November");
  ok((await as("authenticated", boss, `update public.money_entries set total_cents = 1 , gst_cents = 0, qst_cents = 0 where id = $1`, [id])).error?.includes("money_month_locked") === true, "a closed month can't be changed");
  ok((await as("authenticated", boss, insertEntry, ["2026-11-20"])).error?.includes("money_month_locked") === true, "nothing can be added to a closed month");
  ok((await as("authenticated", boss, `update public.money_entries set entry_date = '2026-12-01' where id = $1`, [id])).error?.includes("money_month_locked") === true, "nothing can be moved out of a closed month");
  ok(!(await as("authenticated", boss, `delete from public.money_month_locks where month = '2026-11-01'`)).error, "reopens November");
  const unlockLog = await as("authenticated", boss, `select action from public.money_audit_log where table_name = 'money_month_locks' and actor = 'ZZ Moneycheck Boss' order by id`);
  ok(unlockLog.rows.map((r) => r.action).join() === "insert,delete", "closing and reopening are both logged");
  ok(!(await as("authenticated", boss, `insert into public.money_bank_balances (month, balance_cents) values ('2026-11-01', 1234567)`)).error, "types a bank balance");
  ok(!(await as("authenticated", boss, `update public.money_settings set tax_frequency = 'monthly' where id = 1`)).error, "changes settings");
  ok(!(await as("authenticated", boss, `insert into public.money_parties (name, kind, default_category_id) values ('ZZ Check Supplier', 'supplier', 'fuel')`)).error, "remembers a supplier");
  ok(Boolean((await as("authenticated", boss, `insert into public.money_parties (name, kind) values ('  zz check   supplier ', 'supplier')`)).error), "same supplier name can't be stored twice");
  const up = await as("authenticated", boss, `insert into storage.objects (bucket_id, name, owner_id) values ('money-receipts', '2026/11/zz-check.jpg', $1) returning name`, [bossAuth]);
  ok(!up.error, "uploads a receipt to the private bucket", up.error);
  ok((await as("authenticated", tech, `select name from storage.objects where bucket_id = 'money-receipts'`)).rows.length === 0, "Technician can't see receipts");
  ok((await as("anon", null, `select name from storage.objects where bucket_id = 'money-receipts'`)).rows.length === 0, "public key can't see receipts");
  ok((await as("authenticated", boss, `select name from storage.objects where bucket_id = 'money-receipts'`)).rows.length >= 1, "Admin can see receipts");
  const bucket = await client.query(`select public from storage.buckets where id = 'money-receipts'`);
  ok(bucket.rows[0]?.public === false, "receipts bucket is private (no public links)");
  if ((await client.query(`select to_regclass('public.money_recurring') is not null e`)).rows[0].e) {
    console.log("\nBills that repeat:");
    const rule = `insert into public.money_recurring (name, category_id, amount_cents, frequency, start_date) values ('ZZ rent', 'shop_rent', 100000, 'monthly', '2026-01-01') returning id, created_by`;
    ok(Boolean((await as("anon", null, rule)).error), "public key can't add a bill");
    ok(Boolean((await as("authenticated", tech, rule)).error), "Technician can't add a bill");
    const r = await as("authenticated", boss, rule);
    ok(!r.error && r.rows[0]?.created_by === "ZZ Moneycheck Boss", "Admin adds a bill (who recorded)", r.error);
    const rid = r.rows[0]?.id;
    await as("authenticated", boss, `insert into public.money_entries (kind, entry_date, category_id, total_cents, recurring_id, occurrence_date, source) values ('out', '2026-01-01', 'shop_rent', 100000, $1, '2026-01-01', 'recurring')`, [rid]);
    ok(Boolean((await as("authenticated", boss, `insert into public.money_entries (kind, entry_date, category_id, total_cents, recurring_id, occurrence_date, source) values ('out', '2026-01-01', 'shop_rent', 100000, $1, '2026-01-01', 'recurring')`, [rid])).error), "the same bill date can never be logged twice");
    ok((await as("service_role", null, `delete from public.money_recurring where id = $1`, [rid])).error?.includes("money_forbidden") === true, "bills are never hard-deleted");
  }
  if ((await client.query(`select to_regclass('public.money_tax_filings') is not null e`)).rows[0].e) {
    console.log("\nTaxes & imports:");
    const filing = `insert into public.money_tax_filings (period_start, period_end, amount_cents) values ('2001-01-01', '2001-03-31', 12345) returning created_by`;
    ok(Boolean((await as("anon", null, filing)).error), "public key can't mark taxes as sent");
    ok(Boolean((await as("authenticated", tech, filing)).error), "Technician can't mark taxes as sent");
    const f = await as("authenticated", boss, filing);
    ok(!f.error && f.rows[0]?.created_by === "ZZ Moneycheck Boss", "Admin marks a period as sent (who recorded)", f.error);
    ok(!(await as("authenticated", boss, `delete from public.money_tax_filings where period_start = '2001-01-01'`)).error, "Admin can undo it (recorded in history)");
    const batch = `insert into public.money_import_batches (source, file_name, row_count) values ('bank', 'x.csv', 3) returning id`;
    ok(Boolean((await as("authenticated", tech, batch)).error), "Technician can't import");
    const b = await as("authenticated", boss, batch);
    ok(!b.error, "Admin can import", b.error);
    ok(Boolean((await as("service_role", null, `delete from public.money_import_batches where id = $1`, [b.rows[0]?.id])).error), "import records can't be deleted");
  }
  const open = await client.query(`select tablename, policyname from pg_policies where schemaname = 'public' and tablename like 'money_%' and ('anon' = any(roles) or 'public' = any(roles))`);
  ok(open.rows.length === 0, "no Money rule open to the public key", JSON.stringify(open.rows));
  const grants = await client.query(`select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and table_name like 'money_%'`);
  ok(grants.rows.length === 0, "public key has no grants on Money tables", JSON.stringify(grants.rows));
} catch (e) {
  failures++;
  console.error("ERROR:", e.message);
} finally {
  await client.query("rollback");
  await client.end();
}
console.log("\n(rolled back: nothing was saved)");
console.log(failures ? `${failures} check(s) FAILED` : "All Money access checks passed");
process.exitCode = failures ? 1 : 0;
