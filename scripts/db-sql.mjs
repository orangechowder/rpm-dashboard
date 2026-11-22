// Runs one or more .sql files (each in a single transaction) against the Supabase database.
// Usage: npm run db:sql -- supabase/migrations/<file>.sql [more.sql ...]
//        npm run db:sql -- --query "select 1"
// Needs SUPABASE_DB_URL in .env.local (Project Settings → Database → Connection string, Session pooler).
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is missing from .env.local");
  process.exit(1);
}
const args = process.argv.slice(2);
if (!args.length) {
  console.error("Give at least one .sql file, or --query \"...\"");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  if (args[0] === "--query") {
    const result = await client.query(args.slice(1).join(" "));
    for (const item of Array.isArray(result) ? result : [result]) {
      if (item.rows?.length) console.table(item.rows);
      else console.log(item.command, item.rowCount ?? "");
    }
  } else {
    for (const file of args) {
      const sql = await readFile(file, "utf8");
      process.stdout.write(`→ ${file} … `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
        console.log("done");
      } catch (error) {
        await client.query("rollback");
        console.log("FAILED (nothing was changed)");
        throw error;
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
