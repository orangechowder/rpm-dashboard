// Server-only helpers for API route handlers. Uses the service-role key, which bypasses RLS:
// every caller must be checked with requireStaff() before any data is read or written.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicKey, supabaseUrl } from "../supabase-env";

if (typeof window !== "undefined") throw new Error("lib/server/staff-auth must never be imported in the browser");

export type StaffAccount = {
  id: string;
  name: string;
  role: "Admin" | "Technician";
  active: boolean;
  isTechnician: boolean;
  authUserId: string | null;
  mustChangePassword: boolean;
};

let cachedAdmin: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const url = supabaseUrl;
  // sb_secret_… key (new) or legacy service_role key. Server only, never NEXT_PUBLIC_.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ServerConfigError();
  cachedAdmin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cachedAdmin;
}

/** A throwaway public-key client, used only to verify a password by signing in (never persisted). */
export function verifierClient(): SupabaseClient {
  if (!supabaseUrl || !supabasePublicKey) throw new ServerConfigError();
  return createClient(supabaseUrl, supabasePublicKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class ServerConfigError extends Error {
  constructor() { super("Server is missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) or the Supabase URL/publishable key"); }
}

export const ACCOUNT_COLUMNS = "id,name,role,active,is_technician,auth_user_id,must_change_password";

export function mapAccount(row: Record<string, unknown>): StaffAccount {
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role === "Admin" ? "Admin" : "Technician",
    active: Boolean(row.active),
    isTechnician: Boolean(row.is_technician),
    authUserId: typeof row.auth_user_id === "string" ? row.auth_user_id : null,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export function jsonError(status: number, code: string, message?: string) {
  return Response.json({ error: code, message: message ?? code }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk(body: Record<string, unknown> = {}) {
  return Response.json({ ok: true, ...body }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Resolves the signed-in dashboard account from the request's Bearer token.
 * Returns null for a missing/expired token, an Auth user with no linked account, or a disabled account.
 */
export async function currentStaff(request: Request): Promise<StaffAccount | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: row, error: rowError } = await admin.from("user_accounts").select(ACCOUNT_COLUMNS).eq("auth_user_id", data.user.id).maybeSingle();
  if (rowError || !row) return null;
  const account = mapAccount(row as Record<string, unknown>);
  return account.active ? account : null;
}

/** Guard for route handlers: returns the account, or a ready-to-return error Response. */
export async function requireStaff(request: Request, options: { admin?: boolean } = {}): Promise<StaffAccount | Response> {
  try {
    const account = await currentStaff(request);
    if (!account) return jsonError(401, "unauthenticated");
    if (options.admin && account.role !== "Admin") return jsonError(403, "forbidden");
    return account;
  } catch (error) {
    if (error instanceof ServerConfigError) return jsonError(500, "server_not_configured", error.message);
    throw error;
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/**
 * A client that acts AS the signed-in person (their token), so database RLS still applies and the
 * Money audit log records who did it. Use after requireStaff(); never the service key for Money data.
 */
export function userClient(token: string): SupabaseClient {
  if (!supabaseUrl || !supabasePublicKey) throw new ServerConfigError();
  return createClient(supabaseUrl, supabasePublicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
