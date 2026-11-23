// POST (Admins only) { mode: "dry-run" | "sync" | "approve", feeBaselineCents? }
//   dry-run → shows what would be added / linked / changed; writes nothing in Money
//   approve → turns syncing on (after a dry run was checked) and runs the first sync
//   sync    → "Sync now"
import { runWaveSync, loadConnection } from "../../../../../lib/server/wave-runner";
import { WaveError } from "../../../../../lib/server/wave";
import { jsonError, jsonOk, readJson, requireStaff, serviceClient } from "../../../../../lib/server/staff-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const body = await readJson(request);
  const mode = String(body.mode ?? "");
  if (!["dry-run", "sync", "approve"].includes(mode)) return jsonError(400, "bad_mode");
  try {
    if (mode === "approve") {
      const db = serviceClient();
      const conn = await loadConnection(db);
      if (!conn) return jsonError(409, "not_connected");
      const { count } = await db.from("money_wave_runs").select("id", { count: "exact", head: true }).eq("mode", "dry-run").eq("ok", true);
      if (!count) return jsonError(409, "dry_run_first");
      const baseline = body.feeBaselineCents === undefined || body.feeBaselineCents === null ? conn.fee_baseline_cents : Number(body.feeBaselineCents);
      if (baseline !== null && !Number.isSafeInteger(baseline)) return jsonError(400, "bad_fee_baseline");
      await db.from("money_wave_connection").update({ approved_at: new Date().toISOString(), approved_by: caller.name, fee_baseline_cents: baseline }).eq("id", 1);
      return jsonOk({ summary: await runWaveSync({ mode: "sync", trigger: "approve", by: caller.name }) });
    }
    return jsonOk({ summary: await runWaveSync({ mode: mode as "dry-run" | "sync", trigger: "manual", by: caller.name }) });
  } catch (e) {
    if (e instanceof WaveError) return jsonError(e.code === "auth" ? 401 : e.code === "not_configured" ? 409 : 502, `wave_${e.code}`, e.message);
    return jsonError(500, "sync_failed", e instanceof Error ? e.message : String(e));
  }
}
