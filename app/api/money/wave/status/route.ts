// GET (Admins only): the Wave connection's state, never its tokens.
import { loadConnection } from "../../../../../lib/server/wave-runner";
import { waveConfig } from "../../../../../lib/server/wave";
import { jsonOk, requireStaff, serviceClient } from "../../../../../lib/server/staff-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const db = serviceClient();
  const conn = await loadConnection(db);
  const { data: runs } = await db.from("money_wave_runs").select("id,mode,trigger,started_by,started_at,finished_at,ok,added,updated,linked,trashed,flagged,error").order("id", { ascending: false }).limit(8);
  const { data: lastDry } = await db.from("money_wave_runs").select("id,started_at,summary").eq("mode", "dry-run").eq("ok", true).order("id", { ascending: false }).limit(1).maybeSingle();
  return jsonOk({
    configured: waveConfig().ready,
    emailAlerts: Boolean(process.env.RESEND_API_KEY && process.env.MONEY_ALERT_EMAIL),
    connection: conn && {
      businessName: conn.business_name, status: conn.status, connectedBy: conn.connected_by, connectedAt: conn.connected_at,
      approvedAt: conn.approved_at, approvedBy: conn.approved_by, syncFrom: conn.sync_from, csvUntil: conn.csv_until,
      feeBaselineCents: conn.fee_baseline_cents, lastSyncAt: conn.last_sync_at, lastSuccessAt: conn.last_success_at,
      lastError: conn.last_error, lastErrorAt: conn.last_error_at, tokenExpiresAt: conn.token_expires_at, scope: conn.scope,
    },
    runs: runs ?? [],
    lastDryRun: lastDry ?? null,
  });
}
