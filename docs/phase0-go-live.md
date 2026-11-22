# Phase 0 go-live: secure sign-in (Supabase Auth)

About 15 minutes. Pick a quiet moment (no one punched in). Have this page, the Supabase dashboard and Vercel open.

## Before you start

- Run `npm run backup` (with `SUPABASE_SECRET_KEY` in `.env.local`) so you have a copy of every table.
- In Supabase → **Authentication → Sign In / Providers**, turn **Allow new users to sign up** OFF and click **Save**. (On 2026-11-22 the project still reported sign-ups as ON.) Check: `curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings" -H "apikey: <publishable key>"` must show `"disable_signup":true`.

## 1. Add the keys to Vercel

Vercel → your project → **Settings → Environment Variables → Add**:

| Name | Value | Environments | Sensitive |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`) | Production **and** Preview | No (it's public by design) |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **Secret key** (`sb_secret_…`) | **Production** only | Yes |

- Leave **Preview** and **Development** unticked. Preview builds of unfinished branches should not get a key that bypasses all security. If you later want previews to work with sign-in, use a separate Supabase project for them.
- Do **not** add `SUPABASE_DB_URL` to Vercel. It's only used on your Mac to run migrations.
- Leave `NEXT_PUBLIC_SUPABASE_URL` as is. Keep the old `NEXT_PUBLIC_SUPABASE_ANON_KEY` until go-live is confirmed (the app prefers the publishable key and only falls back to it), then delete it from Vercel.
- Don't disable the legacy keys in Supabase until the rollback window has passed (after Step C): the previous deployment still uses the legacy anon key.

## 2. Run Step A (safe, the old site keeps working)

**Already done on 2026-11-22.** Running it again is harmless.

```
npm run db:sql -- supabase/migrations/20261121000100_phase0a_auth_prepare.sql
```

## 3. Deploy the new version

Push to `main` (or click **Redeploy** in Vercel after pushing). Wait for "Ready".
Note the deployment that was live before this one: it's your rollback target.

## 4. Test sign-in on the live site

On panel.rpm-diesel.ca, as Marc:
1. Pick your name, type your **current** password, then press Sign in.
2. The screen asks you to **choose a new password**. Do it.
3. You land on the dashboard. Open Job Queue, Punch Clock, Payroll and Profitability, and check the data is there.
4. In User Management, Marc shows **Secure sign-in ✓**.

If any of that fails, stop here. Nothing is locked yet, and the old site can be restored with Vercel **Instant Rollback** alone.

## 5. Lock the public key out (Step B)

```
npm run check:lock-dry-run      # rehearses Step B and rolls it back; must say "All checks passed"
npm run db:sql -- supabase/migrations/20261121000200_phase0b_auth_lock.sql
npm run check:access
```

`check:access` must end with **All checks passed**. Then reload the live site, sign out, sign in again with the new password, and open each page once more.

## 6. Tell the team

> The dashboard sign-in has changed. Next time you sign in, use your usual password one last time.
> It will then ask you to choose a new one (at least 8 characters, not 12345678). After that, use the new one.
> Forgot it? Ask an Admin to set a temporary password for you in User Management.

> *FR :* La connexion au tableau de bord a changé. À votre prochaine connexion, utilisez votre mot de passe habituel une dernière fois.
> On vous demandera ensuite d'en choisir un nouveau (au moins 8 caractères, pas 12345678). Utilisez ensuite le nouveau.
> Oublié? Demandez à un administrateur de vous donner un mot de passe temporaire dans Gestion des utilisateurs.

## 7. A few days later (Step C)

When **all** active people show **Secure sign-in ✓** in User Management:

```
npm run db:sql -- supabase/migrations/20261121000300_phase0c_drop_legacy_passwords.sql
```

This deletes the old passwords for good. It refuses to run if someone hasn't switched yet. After it runs, the rollback below is no longer possible.

## Rollback (if sign-in breaks after Step B)

1. Run the rollback SQL. It reopens the old access and restores the old passwords:
   ```
   npm run db:sql -- supabase/rollback/20261121000200_phase0b_auth_lock_rollback.sql
   ```
   No Mac at hand? Paste that file into Supabase → **SQL Editor** → Run.
2. Vercel → **Deployments** → the previous deployment → **⋯ → Instant Rollback**.
3. Everyone signs in with their **old** password on the old site.
4. Tell me what broke. Once it's fixed, redo steps 3–5.

If it breaks after Step A but before Step B, only do step 2 (Vercel Instant Rollback).
