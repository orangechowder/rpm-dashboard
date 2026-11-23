// POST (Admins only): forget the Wave tokens. Entries already synced stay in Money.
import { jsonError, jsonOk, requireStaff, serviceClient } from "../../../../../lib/server/staff-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const { error } = await serviceClient().from("money_wave_connection").delete().eq("id", 1);
  if (error) return jsonError(500, "disconnect_failed", error.message);
  return jsonOk({ disconnected: true });
}
