// Signed-in user changes their own password. The current password is required, except right after an
// Admin set a temporary one (must_change_password), where the user is already proven by that sign-in.
import { passwordProblem } from "../../../../lib/staff-identity";
import { jsonError, jsonOk, readJson, requireStaff, serviceClient, text, verifierClient } from "../../../../lib/server/staff-auth";

export async function POST(request: Request) {
  const caller = await requireStaff(request);
  if (caller instanceof Response) return caller;
  if (!caller.authUserId) return jsonError(401, "unauthenticated");
  const body = await readJson(request);
  const currentPassword = text(body.currentPassword);
  const newPassword = text(body.newPassword);
  const problem = passwordProblem(newPassword, text(body.confirmPassword), currentPassword || undefined);
  if (problem) return jsonError(400, "weak_password", problem);

  const admin = serviceClient();
  if (!caller.mustChangePassword) {
    const { data: authUser } = await admin.auth.admin.getUserById(caller.authUserId);
    const email = authUser.user?.email;
    if (!email || !currentPassword) return jsonError(401, "wrong_current_password");
    const check = await verifierClient().auth.signInWithPassword({ email, password: currentPassword });
    if (check.error) return jsonError(401, "wrong_current_password");
  }

  const updated = await admin.auth.admin.updateUserById(caller.authUserId, { password: newPassword });
  if (updated.error) return jsonError(500, "update_failed", updated.error.message);
  const { error } = await admin.from("user_accounts").update({ must_change_password: false }).eq("id", caller.id);
  if (error) return jsonError(500, "update_failed", error.message);
  return jsonOk();
}
