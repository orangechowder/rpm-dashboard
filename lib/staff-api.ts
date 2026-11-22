// Browser-side calls to the app's own API routes, authenticated with the Supabase session token.
import { supabase } from "./supabase";

export type StaffApiResult = { ok: true; [key: string]: unknown } | { ok: false; status: number; error: string; message: string };

export async function staffApi(path: string, method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, options: { anonymous?: boolean } = {}): Promise<StaffApiResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!options.anonymous) {
    const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) return { ok: false, status: 401, error: "unauthenticated", message: "Not signed in" };
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const response = await fetch(path, { method, headers, body: JSON.stringify(body), cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { ok: true, ...payload };
    return { ok: false, status: response.status, error: String(payload.error ?? "request_failed"), message: String(payload.message ?? payload.error ?? response.statusText) };
  } catch (error) {
    return { ok: false, status: 0, error: "network", message: (error as Error).message };
  }
}
