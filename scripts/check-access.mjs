// Security check: proves what the public key, a Technician and an Admin can and cannot do.
// Usage: npm run check:access                 (public-key checks only, read-only)
//        npm run check:access -- --signed-in  (also creates 2 temporary test accounts, runs the
//                                              Technician/Admin checks, then deletes everything it made)
//        add --api http://localhost:3000 to also check the app's /api routes
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const signedIn = args.includes("--signed-in");
const apiBase = args.includes("--api") ? args[args.indexOf("--api") + 1] : null;
if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing");

const options = { auth: { persistSession: false, autoRefreshToken: false } };
let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, detail) => { failures += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); };
const expect = (condition, label, detail) => (condition ? pass(label) : fail(label, detail));

const PROTECTED = ["fleet_units", "work_orders", "activity_logs", "user_accounts", "time_entries", "payroll_period_locks", "legacy_passwords", "timesheet_entries", "daily_timesheet_summary", "weekly_timesheet_summary", "staff_directory", ...(process.env.CHECK_EXTRA_TABLES ?? "").split(",").filter(Boolean)];

async function rowsVisible(client, table) {
  const { data, error } = await client.from(table).select("*").limit(5);
  if (error) return { count: 0, error: error.message };
  return { count: data.length, error: null };
}

console.log("\nPublic key (anyone on the internet):");
const anon = createClient(url, anonKey, options);
for (const table of PROTECTED) {
  const { count, error } = await rowsVisible(anon, table);
  expect(count === 0, `${table}: nothing readable`, error ? undefined : `${count} row(s) visible`);
}
{
  const { error } = await anon.from("work_orders").insert({ id: "ZZ-CHECK", unit: "x", client: "x", tech: "x", priority: "Low", status: "Scheduled", issue: "x", updated: "x", usage: "x" });
  expect(Boolean(error), "work_orders: cannot write");
  const { data, error: rpcError } = await anon.rpc("staff_login_names");
  expect(!rpcError && Array.isArray(data) && data.every((row) => Object.keys(row).join() === "name"), "sign-in name list returns names only", rpcError?.message);
}

if (signedIn) {
  if (!serviceKey) throw new Error("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) missing");
  const admin = createClient(url, serviceKey, options);
  const stamp = Date.now().toString(36);
  const made = { authIds: [], accountIds: [], entryIds: [] };
  const makeAccount = async (role) => {
    const name = `ZZ Check ${role} ${stamp}`;
    const email = `zz-check-${role.toLowerCase()}-${stamp}@staff.rpm-diesel.ca`;
    const password = `Chk-${crypto.randomUUID()}`;
    const id = `user-zz-check-${role.toLowerCase()}-${stamp}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { account_id: id } });
    if (error) throw error;
    made.authIds.push(data.user.id);
    const insert = await admin.from("user_accounts").insert({ id, name, role, active: true, is_technician: true, auth_user_id: data.user.id });
    if (insert.error) throw insert.error;
    made.accountIds.push(id);
    const client = createClient(url, anonKey, options);
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return { id, name, client, token: signIn.data.session.access_token };
  };
  try {
    const tech = await makeAccount("Technician");
    const boss = await makeAccount("Admin");

    console.log("\nTechnician:");
    const ownRows = await tech.client.from("user_accounts").select("id,hourly_rate");
    expect(!ownRows.error && ownRows.data.length === 1 && ownRows.data[0].id === tech.id, "sees only their own account row", ownRows.error?.message ?? `${ownRows.data?.length} rows`);
    const pw = await tech.client.from("user_accounts").select("password").limit(1);
    expect(Boolean(pw.error), "cannot read the password column");
    const dir = await tech.client.from("staff_directory").select("*");
    expect(!dir.error && dir.data.length >= 2 && !("hourly_rate" in (dir.data[0] ?? {})), "team list has names but no rates", dir.error?.message);
    const legacy = await rowsVisible(tech.client, "legacy_passwords");
    expect(legacy.count === 0, "cannot read old passwords");
    const otherPunch = await tech.client.from("time_entries").insert({ user_id: "Marc", user_name: "Marc", status: "active" }).select("id");
    expect(Boolean(otherPunch.error), "cannot punch in as someone else");
    if (otherPunch.data?.[0]) made.entryIds.push(otherPunch.data[0].id);
    const ownPunch = await tech.client.from("time_entries").insert({ user_id: tech.name, user_name: tech.name, status: "active" }).select("id");
    expect(!ownPunch.error, "can punch in as themself", ownPunch.error?.message);
    const ownPunchId = ownPunch.data?.[0]?.id;
    if (ownPunchId) made.entryIds.push(ownPunchId);
    const close = await tech.client.from("time_entries").update({ status: "completed", clock_out: new Date().toISOString(), total_hours: 0.01 }).eq("id", ownPunchId).select("id");
    expect(!close.error && close.data.length === 1, "can punch out", close.error?.message);
    const del = await tech.client.from("time_entries").delete().eq("id", ownPunchId).select("id");
    expect(!del.error && del.data.length === 0, "cannot delete punches");
    const promote = await tech.client.from("user_accounts").update({ role: "Admin" }).eq("id", tech.id).select("id");
    expect(promote.data?.length === 0 || Boolean(promote.error), "cannot make themself Admin");
    const lock = await tech.client.from("payroll_period_locks").insert({ period_start: "2001-01-01", period_end: "2001-01-07", locked_by: tech.name }).select("period_start");
    expect(Boolean(lock.error), "cannot lock payroll");
    const rates = await tech.client.from("daily_timesheet_summary").select("user_id,hourly_rate").not("hourly_rate", "is", null);
    expect(!rates.error && rates.data.every((row) => row.user_id === tech.name), "cannot see other people's hourly rates", rates.error?.message);

    console.log("\nAdmin:");
    const all = await boss.client.from("user_accounts").select("id");
    expect(!all.error && all.data.length >= 3, "sees every account", all.error?.message);
    const bossPw = await boss.client.from("user_accounts").select("password").limit(1);
    expect(Boolean(bossPw.error), "cannot read the password column either");
    const rate = await boss.client.from("user_accounts").update({ hourly_rate: 1 }).eq("id", tech.id).select("id");
    expect(!rate.error && rate.data.length === 1, "can change an hourly rate", rate.error?.message);
    const insertAccount = await boss.client.from("user_accounts").insert({ id: `user-zz-direct-${stamp}`, name: `ZZ direct ${stamp}`, role: "Admin" });
    expect(Boolean(insertAccount.error), "cannot create accounts directly (must use the server)");
    const adminDel = await boss.client.from("time_entries").delete().eq("id", ownPunchId).select("id");
    expect(!adminDel.error && adminDel.data.length === 1, "can delete a punch", adminDel.error?.message);

    if (apiBase) {
      console.log(`\nApp API (${apiBase}):`);
      // If the "cannot make themself Admin" check above failed, undo it so the API checks still test a real Technician.
      await admin.from("user_accounts").update({ role: "Technician" }).eq("id", tech.id);
      const call = (token, method, body) => fetch(`${apiBase}/api/admin/users`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      expect((await call(null, "POST", { name: "x", password: "x" })).status === 401, "admin API refuses no sign-in");
      expect((await call(tech.token, "PATCH", { id: boss.id, password: "Whatever-123" })).status === 403, "admin API refuses a Technician");
      const reset = await call(boss.token, "PATCH", { id: tech.id, password: `Tmp-${stamp}-x` });
      expect(reset.status === 200, "admin API lets an Admin set a temporary password", String(reset.status));
      const flagged = await admin.from("user_accounts").select("must_change_password").eq("id", tech.id).single();
      expect(flagged.data?.must_change_password === true, "temporary password forces a change at next sign-in");
      const legacyProbe = await fetch(`${apiBase}/api/auth/first-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tech.name, oldPassword: "definitely-wrong" }) });
      expect(legacyProbe.status === 401, "first-login API rejects a wrong old password", String(legacyProbe.status));
    }
  } finally {
    if (made.entryIds.length) await admin.from("time_entries").delete().in("id", made.entryIds);
    // Rows that only exist if a "cannot write" check failed (database still open).
    await admin.from("work_orders").delete().eq("id", "ZZ-CHECK");
    await admin.from("user_accounts").delete().like("id", "user-zz-direct-%");
    if (made.accountIds.length) await admin.from("user_accounts").delete().in("id", made.accountIds);
    for (const id of made.authIds) await admin.auth.admin.deleteUser(id);
    console.log("\n(temporary test accounts and punches deleted)");
  }
}

console.log(failures ? `\n${failures} check(s) FAILED\n` : "\nAll checks passed\n");
process.exitCode = failures ? 1 : 0;
