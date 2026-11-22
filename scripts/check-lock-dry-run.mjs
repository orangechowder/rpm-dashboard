// Dry run of Phase 0 Step B: applies the lock INSIDE a transaction, runs the app's real queries as the
// public key / a Technician / an Admin, then ROLLS BACK. Nothing is committed; the live site is unaffected.
// Usage: npm run check:lock-dry-run   (needs SUPABASE_DB_URL; run it after Step A, before Step B)
import { readFile } from "node:fs/promises";
import pg from "pg";

const root = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
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
    await client.query(`reset role`);
    await client.query(`release savepoint ${name}`);
    return { rows: r.rows, count: r.rowCount, error: null };
  } catch (e) {
    await client.query(`rollback to savepoint ${name}`);
    return { rows: [], count: 0, error: e.message };
  }
}

try {
  await client.query("begin");
  await client.query("set local lock_timeout = '3s'; set local statement_timeout = '20s'");
  const t0 = Date.now();
  await client.query(await readFile(`${root}/supabase/migrations/20261121000200_phase0b_auth_lock.sql`, "utf8"));
  console.log(`Step B applied inside the transaction (${Date.now() - t0} ms)`);

  const techAuth = "00000000-0000-4000-8000-00000000a001", bossAuth = "00000000-0000-4000-8000-00000000a002";
  for (const [id, email] of [[techAuth, "zz-tech@staff.rpm-diesel.ca"], [bossAuth, "zz-boss@staff.rpm-diesel.ca"]]) {
    await client.query(`insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`, [id, email]);
  }
  await client.query(`insert into public.user_accounts (id, name, role, active, is_technician, hourly_rate, auth_user_id) values
    ('user-zz-tech', 'ZZ Tech', 'Technician', true, true, 30, $1), ('user-zz-boss', 'ZZ Boss', 'Admin', true, false, 50, $2)`, [techAuth, bossAuth]);
  const marcEntry = (await client.query(`select id from public.time_entries where user_id = 'Marc' limit 1`)).rows[0]?.id;
  const tech = { role: "authenticated", sub: techAuth }, boss = { role: "authenticated", sub: bossAuth };

  console.log("\nPublic key (anon):");
  for (const t of ["fleet_units", "work_orders", "activity_logs", "user_accounts", "time_entries", "payroll_period_locks", "legacy_passwords", "timesheet_entries", "daily_timesheet_summary", "weekly_timesheet_summary", "staff_directory"]) {
    const r = await as("anon", null, `select * from public.${t} limit 5`);
    ok(r.rows.length === 0, `${t}: nothing readable`, `${r.rows.length} rows`);
  }
  ok(Boolean((await as("anon", null, `insert into public.work_orders (id, unit, client, tech, priority, status, issue, updated, usage) values ('ZZ','x','x','x','Low','Scheduled','x','x','x')`)).error), "cannot write work orders");
  ok(Boolean((await as("anon", null, `update public.user_accounts set role = 'Admin'`)).error), "cannot change accounts");
  const names = await as("anon", null, `select * from public.staff_login_names()`);
  ok(!names.error && names.rows.length >= 5 && names.rows.every((r) => Object.keys(r).join() === "name"), `sign-in name list: ${names.rows.map((r) => r.name).join(", ")}`, names.error);

  console.log("\nTechnician (ZZ Tech) — the app's own queries:");
  const cols = "id,name,role,active,is_technician,hourly_rate,auth_user_id,must_change_password";
  ok((await as("authenticated", tech, `select count(*)::int n from public.fleet_units`)).rows[0]?.n > 0, "Units: list loads");
  ok((await as("authenticated", tech, `select count(*)::int n from public.work_orders`)).rows[0]?.n > 0, "Job Queue: list loads");
  ok(!(await as("authenticated", tech, `insert into public.work_orders (id, unit, client, tech, priority, status, issue, updated, usage) values ('ZZ-WO','x','x','ZZ Tech','Low','Scheduled','x','x','x') on conflict (id) do update set status = excluded.status`)).error, "Job Queue: can save a work order");
  ok(!(await as("authenticated", tech, `update public.fleet_units set usage = usage where id = (select id from public.fleet_units limit 1)`)).error, "Units: can save a unit");
  ok(!(await as("authenticated", tech, `insert into public.activity_logs (actor, action, entity_type, entity_id, details) values ('ZZ Tech','zz','unit','x','{}')`)).error, "Activity log / unit notes: can write");
  ok((await as("authenticated", tech, `select count(*)::int n from public.activity_logs`)).rows[0]?.n > 0, "Activity log / unit notes: can read");
  const own = await as("authenticated", tech, `select ${cols} from public.user_accounts`);
  ok(!own.error && own.rows.length === 1 && own.rows[0].id === "user-zz-tech", "Accounts: sees only own row", own.error ?? `${own.rows.length} rows`);
  ok(Boolean((await as("authenticated", tech, `select password from public.user_accounts`)).error), "Accounts: cannot read the password column");
  const dir = await as("authenticated", tech, `select * from public.staff_directory`);
  ok(!dir.error && dir.rows.length >= 7 && !("hourly_rate" in (dir.rows[0] ?? {})), `Team list: ${dir.rows.length} names, no rates`, dir.error);
  ok((await as("authenticated", tech, `select count(*)::int n from public.time_entries`)).rows[0]?.n >= 226, "Work-order history: sees all punches");
  const punch = await as("authenticated", tech, `insert into public.time_entries (user_id, user_name, status, clock_in) values ('ZZ Tech','ZZ Tech','active', now()) returning id`);
  ok(!punch.error, "Punch Clock: can punch in as themself", punch.error);
  const punchId = punch.rows[0]?.id;
  const out = await as("authenticated", tech, `update public.time_entries set status='completed', clock_out=now(), total_hours=0.01 where id=$1 returning id`, [punchId]);
  ok(out.rows.length === 1, "Punch Clock: can punch out", out.error);
  ok(Boolean((await as("authenticated", tech, `insert into public.time_entries (user_id, user_name, status) values ('Marc','Marc','active')`)).error), "Punch Clock: cannot punch in as Marc");
  ok((await as("authenticated", tech, `update public.time_entries set total_hours = 99 where id=$1 returning id`, [marcEntry])).rows.length === 0, "cannot edit Marc's punch");
  ok((await as("authenticated", tech, `update public.time_entries set user_id='Marc', user_name='Marc' where id=$1 returning id`, [punchId])).rows.length === 0 , "cannot hand own punch to someone else");
  ok((await as("authenticated", tech, `delete from public.time_entries where id=$1 returning id`, [punchId])).rows.length === 0, "cannot delete punches");
  const myPay = await as("authenticated", tech, `select * from public.daily_timesheet_summary where user_id = 'ZZ Tech'`);
  ok(!myPay.error && myPay.rows.length >= 1 && Number(myPay.rows[0].hourly_rate) === 30, "My Payroll: own day summary with own rate", myPay.error ?? JSON.stringify(myPay.rows[0]));
  ok(!(await as("authenticated", tech, `select * from public.weekly_timesheet_summary where user_id = 'ZZ Tech'`)).error, "My Payroll: weekly summary loads");
  const otherRates = await as("authenticated", tech, `select count(*)::int n from public.daily_timesheet_summary where user_id <> 'ZZ Tech' and hourly_rate is not null`);
  ok(!otherRates.error && otherRates.rows[0].n === 0, "cannot see anyone else's hourly rate", otherRates.error ?? `${otherRates.rows[0]?.n} rows`);
  const otherWeekly = await as("authenticated", tech, `select count(*)::int n from public.weekly_timesheet_summary where user_id <> 'ZZ Tech' and (hourly_rate is not null or weekly_gross_pay > 0)`);
  ok(!otherWeekly.error && otherWeekly.rows[0].n === 0, "cannot see anyone else's pay (weekly)", otherWeekly.error ?? `${otherWeekly.rows[0]?.n} rows`);
  ok(!(await as("authenticated", tech, `select * from public.payroll_period_locks`)).error, "payroll locks: can read (to know a week is locked)");
  ok(Boolean((await as("authenticated", tech, `insert into public.payroll_period_locks (period_start, period_end, locked_by) values ('2001-01-01','2001-01-07','ZZ Tech')`)).error), "cannot lock payroll");
  ok((await as("authenticated", tech, `update public.user_accounts set role='Admin' where id='user-zz-tech' returning id`)).rows.length === 0, "cannot make themself Admin");
  ok(Boolean((await as("authenticated", tech, `select * from public.legacy_passwords`)).error), "cannot read old passwords");

  console.log("\nAdmin (ZZ Boss) — the app's own queries:");
  const all = await as("authenticated", boss, `select ${cols} from public.user_accounts`);
  ok(!all.error && all.rows.length === 7, `User Management: sees all ${all.rows.length} accounts`, all.error);
  ok(Boolean((await as("authenticated", boss, `select password from public.user_accounts`)).error), "cannot read the password column either");
  ok((await as("authenticated", boss, `update public.user_accounts set hourly_rate = 31, updated_at = now() where id='user-zz-tech' returning id`)).rows.length === 1, "User Management: can change rate / role / active");
  ok(Boolean((await as("authenticated", boss, `insert into public.user_accounts (id, name, role) values ('x','x','Admin')`)).error), "cannot create accounts directly (server route only)");
  const pay = await as("authenticated", boss, `select user_id,user_name,work_date,raw_hours,net_payable_hours,billable_hours from public.daily_timesheet_summary where work_date >= current_date - 60`);
  ok(!pay.error && pay.rows.length > 0, `Payroll: summary loads (${pay.rows.length} day-rows, last 60 days)`, pay.error);
  const prof = await as("authenticated", boss, `select name, hourly_rate from public.user_accounts`);
  ok(!prof.error && prof.rows.length === 7, "Profitability: rates for everyone", prof.error);
  const rated = await as("authenticated", boss, `select count(*)::int n from public.daily_timesheet_summary where hourly_rate is not null and user_id <> 'ZZ Boss'`);
  ok(!rated.error && rated.rows[0].n > 0, "Payroll: sees other people's rates", rated.error);
  ok(!(await as("authenticated", boss, `insert into public.payroll_period_locks (period_start, period_end, locked_by, locked_at) values ('2001-01-01','2001-01-07','ZZ Boss', now()) on conflict (period_start, period_end) do update set locked_at = excluded.locked_at`)).error, "Payroll: can lock a period");
  ok(!(await as("authenticated", boss, `delete from public.payroll_period_locks where period_start='2001-01-01'`)).error, "Payroll: can unlock a period");
  ok(!(await as("authenticated", boss, `insert into public.time_entries (user_id, user_name, status, clock_in, clock_out, total_hours) values ('ZZ Tech','ZZ Tech','completed', now() - interval '1 hour', now(), 1)`)).error, "Punch Clock: can add a manual punch for someone else");
  ok((await as("authenticated", boss, `update public.time_entries set total_hours = total_hours where id=$1 returning id`, [marcEntry])).rows.length === 1, "can edit anyone's punch");
  ok((await as("authenticated", boss, `delete from public.time_entries where id=$1 returning id`, [punchId])).rows.length === 1, "can delete a punch");

  console.log("\nOther checks:");
  const pw = await client.query(`select count(*)::int n from public.user_accounts where password is not null`);
  ok(pw.rows[0].n === 0, "plain-text passwords cleared from user_accounts");
  const legacy = await client.query(`select count(*)::int n from public.legacy_passwords`);
  ok(legacy.rows[0].n === 5, "old passwords kept server-side for the first sign-in (5)");
  const pub = await client.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`);
  ok(!pub.rows.some((r) => r.tablename === "user_accounts"), `realtime tables: ${pub.rows.map((r) => r.tablename).join(", ")}`);
  const leftover = await client.query(`select tablename, policyname from pg_policies where schemaname='public' and ('anon' = any(roles) or 'public' = any(roles))`);
  ok(leftover.rows.length === 0, "no rule left open to the public key", JSON.stringify(leftover.rows));
} catch (e) {
  failures++;
  console.error("ERROR:", e.message);
} finally {
  await client.query("rollback");
  const check = await client.query(`select count(*)::int n from pg_policies where schemaname='public' and 'anon' = any(roles)`);
  console.log(`\nRolled back. Live database unchanged (old open rules still present: ${check.rows[0].n}).`);
  await client.end();
}
console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exitCode = failures ? 1 : 0;
