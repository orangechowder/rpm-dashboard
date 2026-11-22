// Admin-only account operations that need the Auth admin API (everything else, like the hourly rate,
// technician flag, role and active switch, is written directly to user_accounts under Admin-only RLS).
//   POST   { name, password, isTechnician }  create a Technician with a temporary password
//   PATCH  { id, password }                  set a temporary password (user must change it at next sign-in)
//   DELETE { id }                            remove the account and its login
import { normalizeStaffName, passwordProblem, staffEmail } from "../../../../lib/staff-identity";
import { ACCOUNT_COLUMNS, jsonError, jsonOk, mapAccount, readJson, requireStaff, serviceClient, text } from "../../../../lib/server/staff-auth";

const PROTECTED_ACCOUNT = "Marc";

export async function POST(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const body = await readJson(request);
  const name = text(body.name).trim();
  const password = text(body.password);
  if (!name) return jsonError(400, "missing_name");
  const problem = passwordProblem(password, password);
  if (problem) return jsonError(400, "weak_password", problem);

  const admin = serviceClient();
  const { data: rows, error: listError } = await admin.from("user_accounts").select("name");
  if (listError) return jsonError(500, "lookup_failed", listError.message);
  if ((rows ?? []).some((row) => normalizeStaffName(String(row.name)) === normalizeStaffName(name))) return jsonError(409, "name_taken");

  const id = `user-${crypto.randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email: staffEmail(name), password, email_confirm: true, app_metadata: { account_id: id } });
  if (created.error || !created.data.user) return jsonError(500, "create_failed", created.error?.message);
  const { error } = await admin.from("user_accounts").insert({
    id, name, role: "Technician", active: true, is_technician: Boolean(body.isTechnician ?? true),
    auth_user_id: created.data.user.id, must_change_password: true, password_migrated_at: new Date().toISOString(),
  });
  if (error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    return jsonError(500, "create_failed", error.message);
  }
  return jsonOk({ id });
}

export async function PATCH(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const body = await readJson(request);
  const id = text(body.id);
  const password = text(body.password);
  const problem = passwordProblem(password, password);
  if (problem) return jsonError(400, "weak_password", problem);

  const admin = serviceClient();
  const { data: row, error } = await admin.from("user_accounts").select(ACCOUNT_COLUMNS).eq("id", id).maybeSingle();
  if (error) return jsonError(500, "lookup_failed", error.message);
  if (!row) return jsonError(404, "not_found");
  const account = mapAccount(row as Record<string, unknown>);

  let authUserId = account.authUserId;
  if (authUserId) {
    const updated = await admin.auth.admin.updateUserById(authUserId, { password });
    if (updated.error) return jsonError(500, "update_failed", updated.error.message);
  } else {
    // Not switched yet: give them a login now, with the temporary password.
    const created = await admin.auth.admin.createUser({ email: staffEmail(account.name), password, email_confirm: true, app_metadata: { account_id: account.id } });
    if (created.error || !created.data.user) return jsonError(500, "create_failed", created.error?.message);
    authUserId = created.data.user.id;
  }
  const { error: saveError } = await admin.from("user_accounts")
    .update({ auth_user_id: authUserId, must_change_password: account.id !== caller.id, legacy_failed_attempts: 0, password_migrated_at: new Date().toISOString() })
    .eq("id", account.id);
  if (saveError) return jsonError(500, "update_failed", saveError.message);
  return jsonOk();
}

export async function DELETE(request: Request) {
  const caller = await requireStaff(request, { admin: true });
  if (caller instanceof Response) return caller;
  const body = await readJson(request);
  const id = text(body.id);
  const admin = serviceClient();
  const { data: row, error } = await admin.from("user_accounts").select(ACCOUNT_COLUMNS).eq("id", id).maybeSingle();
  if (error) return jsonError(500, "lookup_failed", error.message);
  if (!row) return jsonOk();
  const account = mapAccount(row as Record<string, unknown>);
  if (account.id === caller.id || account.name === PROTECTED_ACCOUNT) return jsonError(403, "protected_account");

  const { error: deleteError } = await admin.from("user_accounts").delete().eq("id", account.id);
  if (deleteError) return jsonError(500, "delete_failed", deleteError.message);
  if (account.authUserId) await admin.auth.admin.deleteUser(account.authUserId);
  return jsonOk();
}
