-- Phase 0 · Step B: LOCK. After this, the public (anon) key can read or write nothing except the
-- list of names on the sign-in screen. Run it only AFTER the new site (Supabase Auth login) is live.
-- Undo: supabase/rollback/20261121000200_phase0b_auth_lock_rollback.sql

-- 1. Remove every policy that lets the public key (or "everyone") in.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and (roles && array['anon', 'public']::name[])
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- 2. Take away the public key's table, view and function rights (RLS is the second lock behind this one).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.staff_login_names() to anon, authenticated;
grant execute on function public.app_is_staff(), public.app_is_admin(), public.app_staff_name() to authenticated;
-- Tables created later must not be public by default either.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- 3. Views must apply the caller's RLS, not the owner's (otherwise they would bypass it).
do $$
declare v text;
begin
  foreach v in array array['timesheet_entries', 'daily_timesheet_summary', 'weekly_timesheet_summary'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = true)', v);
      execute format('revoke all on public.%I from anon', v);
      execute format('grant select on public.%I to authenticated', v);
    end if;
  end loop;
end $$;

-- 4. Accounts: signed-in users can never read the password column or write login fields.
--    New accounts / deletions / passwords go through the server (service role) only.
revoke all on public.user_accounts from anon, authenticated;
grant select (id, name, role, active, is_technician, hourly_rate, updated_at, auth_user_id, must_change_password, password_migrated_at)
  on public.user_accounts to authenticated;
grant update (role, active, is_technician, hourly_rate, updated_at) on public.user_accounts to authenticated;

-- The old passwords are now only in the server-only legacy_passwords table (kept for rollback, deleted in Step C).
update public.legacy_passwords lp set password = ua.password, copied_at = now()
from public.user_accounts ua where ua.id = lp.account_id and ua.password is not null and ua.password <> lp.password;
insert into public.legacy_passwords (account_id, password)
select id, password from public.user_accounts where password is not null
on conflict (account_id) do nothing;
update public.user_accounts set password = null where password is not null;

-- Nothing in the app listens to account changes live; stop broadcasting them.
do $$
begin
  if exists (
    select 1 from pg_publication_rel pr join pg_class c on c.oid = pr.prrelid join pg_namespace n on n.oid = c.relnamespace
    where pr.prpubid = (select oid from pg_publication where pubname = 'supabase_realtime') and n.nspname = 'public' and c.relname = 'user_accounts'
  ) then
    alter publication supabase_realtime drop table public.user_accounts;
  end if;
end $$;

-- 5. Signed-in staff keep normal table rights; RLS policies from Step A decide which rows.
grant select, insert, update, delete on public.fleet_units, public.work_orders, public.time_entries, public.payroll_period_locks to authenticated;
grant select, insert on public.activity_logs to authenticated;

notify pgrst, 'reload schema';
