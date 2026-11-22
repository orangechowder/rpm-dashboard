// Supabase keys. New-style keys (sb_publishable_… / sb_secret_…) are preferred; the legacy
// anon / service_role names still work as a fallback until Supabase retires legacy keys (early 2027).
// NEXT_PUBLIC_ names must be written out literally so Next.js can inline them in the browser bundle.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
