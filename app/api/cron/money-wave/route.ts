// Nightly (Vercel cron, see vercel.json): sync Wave → Money, then email an alert if the connection expired
// or nothing has synced for more than 24 h. Vercel sends "Authorization: Bearer $CRON_SECRET".
import { loadConnection, needsAlert, runWaveSync, sendAlert } from "../../../../lib/server/wave-runner";
import { serviceClient } from "../../../../lib/server/staff-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("forbidden", { status: 403 });
  const db = serviceClient();
  let result: Record<string, unknown> = { skipped: true };
  const before = await loadConnection(db);
  if (before?.approved_at) {
    try {
      const s = await runWaveSync({ mode: "sync", trigger: "cron", by: "Nightly sync" });
      result = { ok: true, ...s.counts };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const conn = await loadConnection(db);
  const alert = needsAlert(conn);
  if (alert) {
    const sent = await sendAlert("RPM Money: the Wave sync needs you", `${alert}\n\nhttps://panel.rpm-diesel.ca`);
    if (sent) await db.from("money_wave_connection").update({ alert_sent_at: new Date().toISOString() }).eq("id", 1);
    result.alert = sent ? "sent" : "not-sent";
  }
  return Response.json(result);
}
