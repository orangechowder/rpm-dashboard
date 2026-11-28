// Wave customers → client list (Admins only).
//   GET                    → approval state + the last result (what was / would be added, "Check these")
//   POST { mode: "preview" } → reads Wave, writes nothing in the list
//   POST { mode: "approve" } → after a preview: turns adding on and adds the missing names now
import { accessToken, loadConnection } from "../../../../lib/server/wave-runner";
import { graphqlClient, waveConfig, WaveError } from "../../../../lib/server/wave";
import { loadClientState, syncWaveClients } from "../../../../lib/server/wave-clients";
import { jsonError, jsonOk, readJson, requireStaff, serviceClient } from "../../../../lib/server/staff-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const db = serviceClient();
  const [state, conn] = await Promise.all([loadClientState(db), loadConnection(db)]);
  return jsonOk({ connected: Boolean(conn), state });
}

export async function POST(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const mode = String((await readJson(request)).mode ?? "");
  if (mode !== "preview" && mode !== "approve") return jsonError(400, "bad_mode");
  if (!waveConfig().ready) return jsonError(409, "wave_not_configured");
  const db = serviceClient();
  const conn = await loadConnection(db);
  if (!conn) return jsonError(409, "not_connected");
  try {
    if (mode === "approve") {
      const state = await loadClientState(db);
      if (!state?.last_summary) return jsonError(409, "preview_first");
      await db.from("client_wave_state").upsert({ id: 1, approved_at: new Date().toISOString(), approved_by: caller.name }, { onConflict: "id" });
    }
    const gql = graphqlClient(await accessToken(db, conn), fetch);
    return jsonOk({ summary: await syncWaveClients(db, gql, conn.business_id, { apply: mode === "approve" }) });
  } catch (e) {
    if (e instanceof WaveError) return jsonError(e.code === "auth" ? 401 : 502, `wave_${e.code}`, e.message);
    return jsonError(500, "clients_sync_failed", e instanceof Error ? e.message : String(e));
  }
}
