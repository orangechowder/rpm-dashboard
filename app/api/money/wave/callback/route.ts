// Wave sends the person back here after "Allow". The signed state proves an Admin started it (no session cookie
// exists on this request). Tokens are encrypted and stored server-side only.
import { encrypt, exchangeCode, graphqlClient, Q_BUSINESSES, readState, waveConfig } from "../../../../../lib/server/wave";
import { serviceClient } from "../../../../../lib/server/staff-auth";
import { redirectUri } from "../redirect";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => Response.redirect(`${url.origin}/?money=settings&wave=${encodeURIComponent(result)}`, 303);
  if (!waveConfig().ready) return back("not-configured");
  if (url.searchParams.get("error")) return back("denied");
  const state = readState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  if (!state || !code) return back("expired-link");
  const db = serviceClient();
  const { data: staff } = await db.from("user_accounts").select("name,role,active").eq("id", state.staffId).maybeSingle();
  if (!staff || staff.role !== "Admin" || staff.active === false) return back("forbidden");
  try {
    const tokens = await exchangeCode(code, redirectUri(request));
    const data = await graphqlClient(tokens.accessToken)(Q_BUSINESSES);
    const all = (((data.businesses as { edges?: Array<{ node: Record<string, unknown> }> })?.edges) ?? []).map((e) => e.node).filter((b) => !b.isArchived);
    const business = all.find((b) => String(b.id) === tokens.businessId) ?? all.find((b) => /rpm/i.test(String(b.name))) ?? all.find((b) => !b.isPersonal) ?? all[0];
    if (!business) return back("no-business");
    const { data: existing } = await db.from("money_wave_connection").select("business_id,approved_at,approved_by,sync_from,csv_until,fee_baseline_cents").eq("id", 1).maybeSingle();
    const same = existing && existing.business_id === String(business.id);
    const { error } = await db.from("money_wave_connection").upsert({
      id: 1, business_id: String(business.id), business_name: String(business.name ?? ""),
      access_token_enc: encrypt(tokens.accessToken), refresh_token_enc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      token_expires_at: tokens.expiresAt, scope: tokens.scope, connected_by: String(staff.name), connected_at: new Date().toISOString(),
      status: "connected", last_error: null, last_error_at: null, alert_sent_at: null,
      // Reconnecting the same business keeps the approval and settings; a different business starts over.
      approved_at: same ? existing.approved_at : null, approved_by: same ? existing.approved_by : null,
      sync_from: same ? existing.sync_from : null, csv_until: same ? existing.csv_until : null, fee_baseline_cents: same ? existing.fee_baseline_cents : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) return back("save-failed");
    return back("connected");
  } catch {
    return back("failed");
  }
}
