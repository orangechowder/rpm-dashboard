// POST (Admins only) → the Wave sign-in address to open. Wave asks the person to allow read-only access.
import { authorizeUrl, signState, waveConfig } from "../../../../../lib/server/wave";
import { jsonError, jsonOk, requireStaff } from "../../../../../lib/server/staff-auth";
import { redirectUri } from "../redirect";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  if (!waveConfig().ready) return jsonError(503, "wave_not_configured", "WAVE_CLIENT_ID, WAVE_CLIENT_SECRET and MONEY_TOKEN_KEY must be set in Vercel");
  return jsonOk({ url: authorizeUrl(redirectUri(request), signState(caller.id)) });
}
