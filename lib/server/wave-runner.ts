// Runs one Wave → Money sync (or a dry run). Server-only; uses the service key, and every change goes through
// money_wave_apply() so the audit history says "Wave sync". Nothing is ever sent to Wave except read queries.
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMoney } from "../money/cents";
import { todayISO, type ISODate } from "../money/dates";
import { normalizeDoc, planSync, type ExistingEntry, type MapRow, type Plan, type ReviewResolution, type WaveAccountRef } from "../money/wave-sync";
import { serviceClient } from "./staff-auth";
import { syncWaveClientsSafely, type ClientSyncSummary } from "./wave-clients";
import { allPages, decrypt, encrypt, graphqlClient, PRO_EXPIRED_MESSAGE, Q_ACCOUNTS, Q_ESTIMATES, Q_INVOICES, refreshTokens, waveConfig, WaveError, type GraphQL } from "./wave";

export type Connection = {
  business_id: string; business_name: string; access_token_enc: string; refresh_token_enc: string | null; token_expires_at: string | null;
  scope: string; connected_by: string | null; connected_at: string; approved_at: string | null; approved_by: string | null;
  sync_from: string | null; csv_until: string | null; fee_account_id: string | null; fee_baseline_cents: number | null;
  status: string; last_sync_at: string | null; last_success_at: string | null; last_error: string | null; last_error_at: string | null; alert_sent_at: string | null;
};

export async function loadConnection(db: SupabaseClient = serviceClient()): Promise<Connection | null> {
  const { data, error } = await db.from("money_wave_connection").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Connection | null) ?? null;
}

/** A valid access token: refreshed (and re-saved, encrypted) when it's about to run out. */
export async function accessToken(db: SupabaseClient, conn: Connection, fetcher: typeof fetch = fetch): Promise<string> {
  const soon = conn.token_expires_at ? Date.parse(conn.token_expires_at) - Date.now() < 5 * 60_000 : false;
  if (!soon) return decrypt(conn.access_token_enc);
  if (!conn.refresh_token_enc) throw new WaveError("auth", "the Wave connection expired; connect again");
  try {
    const t = await refreshTokens(decrypt(conn.refresh_token_enc), fetcher);
    await db.from("money_wave_connection").update({
      access_token_enc: encrypt(t.accessToken), refresh_token_enc: t.refreshToken ? encrypt(t.refreshToken) : conn.refresh_token_enc,
      token_expires_at: t.expiresAt, status: "connected", updated_at: new Date().toISOString(),
    }).eq("id", 1);
    return t.accessToken;
  } catch (e) {
    if (e instanceof WaveError && e.code === "subscription") { await markProExpired(db, conn); throw e; }
    await db.from("money_wave_connection").update({ status: "expired", last_error: "The Wave connection expired. Connect again.", last_error_at: new Date().toISOString() }).eq("id", 1);
    throw e instanceof WaveError ? e : new WaveError("auth", String(e));
  }
}

/** Wave Pro ran out: say so plainly, stop the nightly retries, and allow exactly one alert email (until reconnected). */
export async function markProExpired(db: SupabaseClient, conn: Pick<Connection, "status">) {
  await db.from("money_wave_connection").update({
    status: "pro_expired", last_error: PRO_EXPIRED_MESSAGE, last_error_at: new Date().toISOString(),
    ...(conn.status !== "pro_expired" ? { alert_sent_at: null } : {}),
  }).eq("id", 1);
}

const cents = (decimal: unknown) => (decimal === null || decimal === undefined ? null : parseMoney(String(decimal)));

export async function fetchWave(gql: GraphQL, businessId: string) {
  // account:read is always granted: if even the accounts are refused, Wave has shut the business out (Pro expired).
  const rawAccounts = await allPages(gql, Q_ACCOUNTS, businessId, "accounts").catch((e) => {
    throw e instanceof WaveError && e.code === "forbidden" ? new WaveError("subscription", e.message) : e;
  });
  const accounts = new Map<string, WaveAccountRef>();
  for (const a of rawAccounts) {
    accounts.set(String(a.id), { id: String(a.id), name: String(a.name ?? ""), subtype: String((a.subtype as { value?: string } | null)?.value ?? "") || null });
  }
  const feeAccounts = rawAccounts.filter((a) => (a.subtype as { value?: string } | null)?.value === "PAYMENT_PROCESSING_FEES" && !a.isArchived);
  const feeBalanceCents = feeAccounts.length ? feeAccounts.reduce((s, a) => s + (cents(a.balanceInBusinessCurrency ?? a.balance) ?? 0), 0) : null;
  const invoices = await allPages(gql, Q_INVOICES, businessId, "invoices");
  // Estimates (deposits) need a permission Wave may not grant this app: without it, deposits show up when the invoice is paid.
  let estimates: Record<string, unknown>[] = [];
  let estimatesReadable = true;
  try { estimates = await allPages(gql, Q_ESTIMATES, businessId, "estimates"); } catch (e) {
    if (e instanceof WaveError && e.code === "forbidden") estimatesReadable = false; else throw e;
  }
  const docs = [...invoices.map((r) => normalizeDoc(r, "invoice", accounts)), ...estimates.map((r) => normalizeDoc(r, "estimate", accounts))];
  return { docs, accounts: rawAccounts, feeAccountIds: feeAccounts.map((a) => String(a.id)), feeBalanceCents, invoiceCount: invoices.length, estimateCount: estimates.length, estimatesReadable };
}

const ENTRY_COLS = "id,kind,entry_date,category_id,party_name,description,total_cents,gst_cents,qst_cents,source,import_key,wave_key,deleted_at";
async function loadMoney(db: SupabaseClient) {
  const existing: ExistingEntry[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("money_entries").select(ENTRY_COLS).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) existing.push({
      id: String(r.id), kind: r.kind === "in" ? "in" : "out", date: String(r.entry_date) as ISODate, categoryId: String(r.category_id),
      party: String(r.party_name ?? ""), description: String(r.description ?? ""), totalCents: Number(r.total_cents), gstCents: Number(r.gst_cents),
      qstCents: Number(r.qst_cents), source: String(r.source), importKey: r.import_key ? String(r.import_key) : null, waveKey: r.wave_key ? String(r.wave_key) : null, deleted: Boolean(r.deleted_at),
    });
    if (!data || data.length < 1000) break;
  }
  const [{ data: locks }, { data: map }, { data: decided }] = await Promise.all([
    db.from("money_month_locks").select("month"),
    db.from("money_wave_map").select("wave_ref,kind,label,suggested_category_id,category_id"),
    db.from("money_wave_review").select("ref,resolution").not("resolution", "is", null),
  ]);
  return {
    existing,
    locks: new Set((locks ?? []).map((l) => String(l.month).slice(0, 7))),
    map: (map ?? []).map((m) => ({ ref: String(m.wave_ref), kind: m.kind === "tax" ? "tax" : "item", label: String(m.label ?? ""), suggested: m.suggested_category_id ? String(m.suggested_category_id) : null, categoryId: m.category_id ? String(m.category_id) : null })) as MapRow[],
    decisions: new Map((decided ?? []).map((d) => [String(d.ref), d.resolution as ReviewResolution])),
  };
}

/** The last day covered by the Wave CSV import (its payments must be matched, never added again). */
function csvCutoff(existing: ExistingEntry[]): ISODate | null {
  const dates = existing.filter((e) => e.source === "import" && e.importKey?.startsWith("wave|")).map((e) => e.date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export type RunSummary = {
  mode: "dry-run" | "sync"; counts: Plan["counts"]; months: Plan["months"]; review: Plan["review"]; feeDeltaCents: number;
  feeBalanceCents: number | null; feeBaselineCents: number | null; syncFrom: string; csvUntil: string | null; newMappings: number;
  invoices: number; estimates: number; estimatesReadable: boolean; samples: Array<{ op: string; date: string; party: string; description: string; category: string; total: number; before?: number }>;
  failed: number; wave: { calls: number; retries: number; rateHeaders: Record<string, string> };
  clients?: ClientSyncSummary | { error: string };
};

export async function runWaveSync(options: { mode: "dry-run" | "sync"; trigger: "manual" | "cron" | "approve"; by: string | null; fetcher?: typeof fetch }): Promise<RunSummary> {
  if (!waveConfig().ready) throw new WaveError("not_configured", "Wave isn't set up on the server yet");
  const db = serviceClient();
  const conn = await loadConnection(db);
  if (!conn) throw new WaveError("not_configured", "Wave isn't connected");
  if (options.mode === "sync" && !conn.approved_at) throw new WaveError("not_configured", "Run a dry run and approve it first");
  const { data: run } = await db.from("money_wave_runs").insert({ mode: options.mode, trigger: options.trigger, started_by: options.by }).select("id").single();
  const finish = (patch: Record<string, unknown>) => (run ? db.from("money_wave_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run.id) : Promise.resolve());
  try {
    const stats = { calls: 0, retries: 0, rateHeaders: {} as Record<string, string> };
    const gql = graphqlClient(await accessToken(db, conn, options.fetcher), options.fetcher, stats);
    const wave = await fetchWave(gql, conn.business_id);
    const money = await loadMoney(db);
    const today = todayISO();
    const csvUntil = conn.csv_until ?? csvCutoff(money.existing);
    const syncFrom = conn.sync_from ?? `${(csvUntil ?? today).slice(0, 4)}-01-01`;
    const plan = planSync({
      docs: wave.docs, map: money.map, existing: money.existing, locks: money.locks, syncFrom: syncFrom as ISODate, csvUntil: csvUntil as ISODate | null,
      decisions: money.decisions, fees: { balanceCents: wave.feeBalanceCents, baselineCents: conn.fee_baseline_cents }, today,
      creditDeposits: !wave.estimatesReadable,
    });

    // New Wave products/taxes always get a row (with a suggestion) so they can be mapped in Settings, even on a dry run.
    if (plan.newMapRows.length) {
      await db.from("money_wave_map").upsert(plan.newMapRows.map((m) => ({ wave_ref: m.ref, kind: m.kind, label: m.label.slice(0, 120), suggested_category_id: m.suggested, category_id: null })), { onConflict: "wave_ref", ignoreDuplicates: true });
    }

    let failed = 0;
    if (options.mode === "sync") {
      for (let i = 0; i < plan.ops.length; i += 200) {
        const chunk = plan.ops.slice(i, i + 200).map((o) => (o.op === "insert" || o.op === "update" ? { op: o.op, id: o.op === "update" ? o.id : undefined, row: o.row } : o.op === "link" ? o : { op: o.op, id: o.id }));
        const { data, error } = await db.rpc("money_wave_apply", { ops: chunk });
        if (error) throw new Error(error.message);
        failed += ((data as { failed?: unknown[] })?.failed ?? []).length;
      }
      // "To review": refresh open items; items that went away on their own are marked fixed.
      const now = new Date().toISOString();
      if (plan.review.length) {
        await db.from("money_wave_review").upsert(plan.review.map((r) => ({ ref: r.ref, kind: r.kind, title: r.title.slice(0, 200), details: r.details, amount_cents: r.amountCents, last_seen_at: now, resolved_at: null, resolved_by: null, resolution: null })), { onConflict: "ref" });
      }
      const { data: open } = await db.from("money_wave_review").select("ref").is("resolved_at", null);
      const still = new Set(plan.review.map((r) => r.ref));
      const gone = (open ?? []).map((o) => String(o.ref)).filter((ref) => !still.has(ref));
      if (gone.length) await db.from("money_wave_review").update({ resolved_at: now, resolved_by: "Wave sync", resolution: "fixed" }).in("ref", gone);
      await db.from("money_wave_connection").update({
        status: "connected", last_sync_at: now, last_success_at: now, last_error: null, last_error_at: null, alert_sent_at: null,
        fee_account_id: wave.feeAccountIds[0] ?? null, csv_until: csvUntil, sync_from: syncFrom, updated_at: now,
      }).eq("id", 1);
    } else {
      await db.from("money_wave_connection").update({ last_sync_at: new Date().toISOString(), fee_account_id: wave.feeAccountIds[0] ?? null }).eq("id", 1);
    }

    // Wave customers → client list (add only; only after its own preview was approved). A failure here never stops Money.
    const clients = await syncWaveClientsSafely(db, gql, conn.business_id, { apply: options.mode === "sync" });

    const label = (o: Plan["ops"][number]) => (o.op === "insert" || o.op === "update" ? o.row : null);
    const summary: RunSummary = {
      mode: options.mode, counts: plan.counts, months: plan.months, review: plan.review, feeDeltaCents: plan.feeDeltaCents,
      feeBalanceCents: wave.feeBalanceCents, feeBaselineCents: conn.fee_baseline_cents, syncFrom, csvUntil, newMappings: plan.newMapRows.length,
      invoices: wave.invoiceCount, estimates: wave.estimateCount, estimatesReadable: wave.estimatesReadable, failed, wave: stats, clients,
      samples: plan.ops.filter((o) => o.op !== "link").slice(0, 300).map((o) => {
        const r = label(o);
        const before = o.op === "update" || o.op === "trash" ? o.before : null;
        return { op: o.op, date: r?.date ?? before?.date ?? "", party: r?.party ?? before?.party ?? "", description: r?.description ?? before?.description ?? "", category: r?.category_id ?? before?.categoryId ?? "", total: r?.total_cents ?? before?.totalCents ?? 0, before: before?.totalCents };
      }),
    };
    await finish({ ok: failed === 0, added: plan.counts.added, updated: plan.counts.updated, linked: plan.counts.linked, trashed: plan.counts.trashed, flagged: plan.counts.flagged, summary, error: failed ? `${failed} change(s) refused by the database` : null });
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish({ ok: false, error: message.slice(0, 500) });
    if (e instanceof WaveError && e.code === "subscription") await markProExpired(db, conn);
    else await db.from("money_wave_connection").update({ last_error: message.slice(0, 500), last_error_at: new Date().toISOString(), ...(e instanceof WaveError && e.code === "auth" ? { status: "expired" } : {}) }).eq("id", 1);
    throw e;
  }
}

// ---- alerts --------------------------------------------------------------------------------------------
export function needsAlert(conn: Connection | null, now = Date.now()): string | null {
  if (!conn || !conn.approved_at) return null;
  // Wave Pro expired: one email only; it's re-armed when Wave is connected again.
  if (conn.status === "pro_expired") return conn.alert_sent_at ? null : PRO_EXPIRED_MESSAGE.replace("click", "open Money → Settings and click");
  const quiet = !conn.alert_sent_at || now - Date.parse(conn.alert_sent_at) > 24 * 3600_000;
  if (!quiet) return null;
  if (conn.status === "expired") return "The Wave connection expired. Open Money → Settings and click “Connect Wave” again.";
  const last = conn.last_success_at ? Date.parse(conn.last_success_at) : Date.parse(conn.approved_at);
  if (now - last > 24 * 3600_000) return `The Wave sync hasn't worked for more than 24 hours.${conn.last_error ? ` Last error: ${conn.last_error}` : ""} Open Money → Settings → Wave.`;
  return null;
}

export async function sendAlert(subject: string, text: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.MONEY_ALERT_EMAIL;
  const from = process.env.MONEY_ALERT_FROM || "RPM Money <money@send.rpm-diesel.ca>";
  if (!key || !to) return false;
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, text }),
  });
  return response.ok;
}
