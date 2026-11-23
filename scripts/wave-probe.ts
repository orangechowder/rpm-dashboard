// READ-ONLY test of the Wave connection (run after "Connect Wave"): npm run wave:probe [-- --refresh]
// Confirms what Wave really returns for RPM DIESEL. Sends only GraphQL queries; nothing is written to Wave.
// With --refresh it also proves the refresh token works (the new tokens are saved, encrypted, like the app does).
import { createClient } from "@supabase/supabase-js";
import { allPages, decrypt, encrypt, graphqlClient, Q_ACCOUNTS, Q_BUSINESSES, Q_ESTIMATES, Q_INVOICES, refreshTokens, WAVE_GRAPHQL } from "../lib/server/wave";
import { normalizeDoc, type WaveAccountRef } from "../lib/money/wave-sync";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
const line = (label: string, value: unknown) => console.log(`  ${label.padEnd(34)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
const count = <T,>(list: T[], key: (x: T) => string) => list.reduce<Record<string, number>>((m, x) => { const k = key(x) || "(empty)"; m[k] = (m[k] ?? 0) + 1; return m; }, {});

const { data: conn, error } = await db.from("money_wave_connection").select("*").eq("id", 1).maybeSingle();
if (error || !conn) { console.error("No Wave connection stored yet. Click “Connect Wave” in Money → Settings first."); process.exit(1); }

console.log("\nConnection");
line("Business", `${conn.business_name} (${conn.business_id})`);
line("Scopes granted", conn.scope || "(Wave didn't say)");
line("Access token expires", conn.token_expires_at ? `${conn.token_expires_at} (${Math.round((Date.parse(conn.token_expires_at) - Date.parse(conn.connected_at)) / 60000)} min after connecting)` : "no expiry given");
line("Refresh token stored", Boolean(conn.refresh_token_enc));

let token = decrypt(conn.access_token_enc);
if (process.argv.includes("--refresh")) {
  if (!conn.refresh_token_enc) console.log("  ✗ no refresh token: the connection will need a new “Connect Wave” when it expires");
  else {
    const t = await refreshTokens(decrypt(conn.refresh_token_enc));
    await db.from("money_wave_connection").update({ access_token_enc: encrypt(t.accessToken), refresh_token_enc: t.refreshToken ? encrypt(t.refreshToken) : conn.refresh_token_enc, token_expires_at: t.expiresAt }).eq("id", 1);
    token = t.accessToken;
    line("Refresh works", `yes · new token lasts until ${t.expiresAt} · refresh token ${t.refreshToken ? "rotated" : "kept"}`);
  }
}

const stats = { calls: 0, retries: 0, rateHeaders: {} as Record<string, string> };
const gql = graphqlClient(token, fetch, stats);
const raw = await fetch(WAVE_GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ query: Q_BUSINESSES }) });
console.log("\nRate limits (response headers)");
raw.headers.forEach((v, k) => { if (/rate|limit|retry|quota/i.test(k)) line(k, v); });

const biz = await gql(Q_BUSINESSES);
console.log("\nBusinesses visible");
for (const e of ((biz.businesses as { edges: Array<{ node: Record<string, unknown> }> }).edges)) line(String(e.node.name), { id: e.node.id, personal: e.node.isPersonal, archived: e.node.isArchived });

const accounts = await allPages(gql, Q_ACCOUNTS, conn.business_id, "accounts");
const byId = new Map<string, WaveAccountRef>(accounts.map((a) => [String(a.id), { id: String(a.id), name: String(a.name), subtype: (a.subtype as { value?: string })?.value ?? null }]));
console.log("\nAccounts");
line("Total", accounts.length);
for (const a of accounts.filter((x) => ["CASH_AND_BANK", "MONEY_IN_TRANSIT", "PAYMENT_PROCESSING_FEES", "SALES_TAX", "SYSTEM_CUSTOMER_CREDITS", "INCOME"].includes(String((x.subtype as { value?: string })?.value)))) {
  line(String(a.name), { subtype: (a.subtype as { value?: string })?.value, balance: a.balance, balanceInBusinessCurrency: a.balanceInBusinessCurrency });
}

const invoices = await allPages(gql, Q_INVOICES, conn.business_id, "invoices");
const estimates = await allPages(gql, Q_ESTIMATES, conn.business_id, "estimates");
const docs = [...invoices.map((r) => normalizeDoc(r, "invoice", byId)), ...estimates.map((r) => normalizeDoc(r, "estimate", byId))];
const payments = docs.flatMap((d) => d.payments.map((p) => ({ ...p, doc: d })));
const rawPayments = invoices.flatMap((i) => (i.payments as Record<string, unknown>[]) ?? []);
console.log("\nInvoices, estimates, payments");
line("Invoices", `${invoices.length} (statuses ${JSON.stringify(count(invoices, (i) => String(i.status)))})`);
line("Estimates", `${estimates.length} (${estimates.filter((e) => ((e.payments as unknown[]) ?? []).length).length} with deposits)`);
line("Payments", payments.length);
line("Payments in 2026", payments.filter((p) => p.date >= "2026-01-01").length);
line("Amount format (first 3)", rawPayments.slice(0, 3).map((p) => p.amount));
line("Payment state values", count(rawPayments, (p) => String(p.state)));
line("transactionType values", count(rawPayments, (p) => String(p.transactionType)));
line("paymentMethod values", count(rawPayments, (p) => String(p.paymentMethod)));
line("Receiving accounts", count(payments, (p) => `${p.account?.name ?? "?"} [${p.account?.subtype ?? "?"}]`));
line("Inactive payments", payments.filter((p) => !p.active).length);
line("Refund-like payments", payments.filter((p) => p.amountCents < 0 || /refund/i.test(p.transactionType ?? "")).length);
line("Tax names seen", count(docs.flatMap((d) => d.lines.flatMap((l) => l.taxes)), (t) => `${t.name} / ${t.abbreviation}`));
line("Products seen", Object.keys(count(docs.flatMap((d) => d.lines), (l) => l.productName ?? "(no product)")).length);
const y2026 = payments.filter((p) => p.date >= "2026-01-01" && ["CASH_AND_BANK", "MONEY_IN_TRANSIT"].includes(p.account?.subtype ?? ""));
line("2026 cash received (gross)", (y2026.reduce((s, p) => s + p.amountCents, 0) / 100).toFixed(2));

console.log("\nWave API calls");
line("Calls / retries", `${stats.calls} / ${stats.retries}`);
line("Rate headers seen", stats.rateHeaders);
console.log("\nRead-only: no mutation was sent. Nothing changed in Wave or in Money" + (process.argv.includes("--refresh") ? " (except the refreshed, encrypted token)." : "."));
