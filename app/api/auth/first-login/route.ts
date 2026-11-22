// One-time move from the old plain-text password to Supabase Auth.
// 1) { name, oldPassword }                       -> 200 { step: "choose_new_password" } when the old password is right
// 2) { name, oldPassword, newPassword, confirm }  -> creates the Auth login with the NEW password and links the account
// The old password is never accepted again once an account is linked.
import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeStaffName, passwordProblem, staffEmail } from "../../../../lib/staff-identity";
import { ACCOUNT_COLUMNS, jsonError, jsonOk, mapAccount, readJson, serviceClient, ServerConfigError, text } from "../../../../lib/server/staff-auth";

const MAX_FAILED_ATTEMPTS = 10;

function sameSecret(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const name = text(body.name);
  const oldPassword = text(body.oldPassword).trim();
  const newPassword = text(body.newPassword);
  const confirm = text(body.confirmPassword);
  if (!name || !oldPassword) return jsonError(400, "missing_fields");

  try {
    const admin = serviceClient();
    const { data: rows, error } = await admin.from("user_accounts").select(`${ACCOUNT_COLUMNS},legacy_failed_attempts`).eq("active", true);
    if (error) return jsonError(500, "lookup_failed", error.message);
    const row = (rows ?? []).find((candidate) => normalizeStaffName(String(candidate.name)) === normalizeStaffName(name));
    // Same answer for "no such person", "already switched" and "wrong password": nothing to learn by probing.
    if (!row) return jsonError(401, "invalid_login");
    const account = mapAccount(row as Record<string, unknown>);
    if (account.authUserId) return jsonError(401, "invalid_login");
    const failed = Number((row as Record<string, unknown>).legacy_failed_attempts ?? 0);
    if (failed >= MAX_FAILED_ATTEMPTS) return jsonError(429, "locked");

    const { data: legacy, error: legacyError } = await admin.from("legacy_passwords").select("password").eq("account_id", account.id).maybeSingle();
    if (legacyError) return jsonError(500, "lookup_failed", legacyError.message);
    const stored = typeof legacy?.password === "string" ? legacy.password : "";
    if (!stored || !sameSecret(stored, oldPassword)) {
      await admin.from("user_accounts").update({ legacy_failed_attempts: failed + 1 }).eq("id", account.id);
      return jsonError(401, "invalid_login");
    }

    if (!newPassword) return jsonOk({ step: "choose_new_password" });
    const problem = passwordProblem(newPassword, confirm, oldPassword);
    if (problem) return jsonError(400, "weak_password", problem);

    const email = staffEmail(account.name);
    let authUserId: string | null = null;
    const created = await admin.auth.admin.createUser({ email, password: newPassword, email_confirm: true, app_metadata: { account_id: account.id } });
    if (created.data.user) {
      authUserId = created.data.user.id;
    } else {
      // A previous attempt may have created the login but failed before linking it: reuse it.
      const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = listed?.users.find((user) => user.email?.toLowerCase() === email);
      if (!existing) return jsonError(500, "create_failed", created.error?.message);
      const updated = await admin.auth.admin.updateUserById(existing.id, { password: newPassword, app_metadata: { account_id: account.id } });
      if (updated.error) return jsonError(500, "create_failed", updated.error.message);
      authUserId = existing.id;
    }

    const { error: linkError } = await admin.from("user_accounts")
      .update({ auth_user_id: authUserId, must_change_password: false, legacy_failed_attempts: 0, password_migrated_at: new Date().toISOString() })
      .eq("id", account.id);
    if (linkError) return jsonError(500, "link_failed", linkError.message);
    return jsonOk({ step: "done", email });
  } catch (error) {
    if (error instanceof ServerConfigError) return jsonError(500, "server_not_configured", error.message);
    return jsonError(500, "unexpected", (error as Error).message);
  }
}
