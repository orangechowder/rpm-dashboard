// Exports every RPM Dashboard table to JSON files in backups/<timestamp>/.
// Usage: npm run backup   (needs SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in .env.local)
// The service-role key bypasses row-level security so the export is complete; never ship it to the browser.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const key = secret || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY");
if (!secret) console.warn("Warning: no secret key — rows hidden by RLS will be missing from the backup.");
// New sb_… keys are not JWTs: send them only as `apikey`. Legacy JWT keys also go in Authorization.
const authHeaders = key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };

const tables = ["fleet_units", "work_orders", "time_entries", "user_accounts", "activity_logs", "payroll_period_locks"];
const pageSize = 1000;
const dir = join("backups", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(dir, { recursive: true });

let failed = false;
for (const table of tables) {
  const rows = [];
  try {
    for (let offset = 0; ; offset += pageSize) {
      const response = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: { ...authHeaders, Range: `${offset}-${offset + pageSize - 1}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const page = await response.json();
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    await writeFile(join(dir, `${table}.json`), JSON.stringify(rows, null, 2));
    console.log(`${table}: ${rows.length} rows`);
  } catch (error) {
    failed = true;
    console.error(`${table}: FAILED — ${error.message}`);
  }
}
console.log(`Backup written to ${dir}`);
if (failed) process.exit(1);
