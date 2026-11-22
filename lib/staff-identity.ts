// Shared by the browser and the server: how a dashboard name maps to its Supabase Auth login,
// and the password rules every new password must pass.

/** Accent- and case-insensitive comparison key for staff names ("Andrée-Anne" === "andree-anne"). */
export function normalizeStaffName(value: string): string {
  return value.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Supabase Auth needs an email; staff only ever type their name. The address is derived from the name,
 * lives on a subdomain with no mailbox, and is never shown or emailed.
 */
export function staffEmail(name: string): string {
  const slug = normalizeStaffName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "staff";
  return `${slug}@staff.rpm-diesel.ca`;
}

const BANNED_PASSWORDS = new Set(["12345678", "123456789", "1234567890", "password", "motdepasse", "rpmdiesel", "rpm-diesel"]);

export type PasswordProblem = "tooShort" | "tooCommon" | "sameAsOld" | "mismatch";

export function passwordProblem(next: string, confirm: string, previous?: string): PasswordProblem | null {
  if (next.length < 8) return "tooShort";
  if (BANNED_PASSWORDS.has(next.toLowerCase())) return "tooCommon";
  if (previous && next === previous) return "sameAsOld";
  if (next !== confirm) return "mismatch";
  return null;
}

export const passwordProblemText: Record<"en" | "fr", Record<PasswordProblem, string>> = {
  en: {
    tooShort: "Use at least 8 characters.",
    tooCommon: "That password is too easy to guess. Pick another one.",
    sameAsOld: "Choose a password different from your old one.",
    mismatch: "The two passwords don't match.",
  },
  fr: {
    tooShort: "Utilisez au moins 8 caractères.",
    tooCommon: "Ce mot de passe est trop facile à deviner. Choisissez-en un autre.",
    sameAsOld: "Choisissez un mot de passe différent de l'ancien.",
    mismatch: "Les deux mots de passe ne correspondent pas.",
  },
};
