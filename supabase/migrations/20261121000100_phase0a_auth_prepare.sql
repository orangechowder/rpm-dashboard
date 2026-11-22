-- Phase 0 · Step A: prepare Supabase Auth.
-- ONLY ADDS things. Safe to run while the current live site is still using plain-text passwords:
-- the old open policies stay in place until Step B.

-- 1. Link each dashboard account to a Supabase Auth user.
alter table public.user_accounts add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.user_accounts add column if not exists must_change_password boolean not null default false;
alter table public.user_accounts add column if not exists legacy_failed_attempts integer not null default 0;
alter table public.user_accounts add column if not exists password_migrated_at timestamptz;
alter table public.user_accounts alter column password drop not null;

-- 2. Private copy of the old passwords, readable only by the server (service role).
--    Used once per person to prove who they are before they choose a new password.
--    Deleted in Step C.
create table if not exists public.legacy_passwords (
  account_id text primary key references public.user_accounts(id) on delete cascade,
  password text not null,
  copied_at timestamptz not null default now()
);
alter table public.legacy_passwords enable row level security;
revoke all on public.legacy_passwords from anon, authenticated;

insert into public.legacy_passwords (account_id, password)
select id, password from public.user_accounts where password is not null
on conflict (account_id) do update set password = excluded.password, copied_at = now();

-- Keep the copy current if someone changes a password on the old site before go-live.
create or replace function public.sync_legacy_password() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.password is not null and new.auth_user_id is null then
    insert into public.legacy_passwords (account_id, password) values (new.id, new.password)
    on conflict (account_id) do update set password = excluded.password, copied_at = now();
  end if;
  return new;
end $$;
drop trigger if exists user_accounts_sync_legacy_password on public.user_accounts;
create trigger user_accounts_sync_legacy_password
  after insert or update of password on public.user_accounts
  for each row execute function public.sync_legacy_password();

-- 3. Who is calling? (used by every policy below). SECURITY DEFINER so they can read user_accounts
--    without tripping its own RLS. They return false/null for anyone not signed in.
create or replace function public.app_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_accounts where auth_user_id = auth.uid() and active);
$$;
create or replace function public.app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_accounts where auth_user_id = auth.uid() and active and role = 'Admin');
$$;
-- time_entries.user_id stores the person's display name, not the account id.
create or replace function public.app_staff_name() returns text
language sql stable security definer set search_path = public as $$
  select name from public.user_accounts where auth_user_id = auth.uid() and active;
$$;
revoke all on function public.app_is_staff(), public.app_is_admin(), public.app_staff_name() from public, anon;
grant execute on function public.app_is_staff(), public.app_is_admin(), public.app_staff_name() to authenticated;

-- 4. Names for the sign-in picker (names only, active accounts only). The login screen already
--    showed these names before anyone signed in.
create or replace function public.staff_login_names() returns table (name text)
language sql stable security definer set search_path = public as $$
  select ua.name from public.user_accounts ua where ua.active order by ua.name;
$$;
revoke all on function public.staff_login_names() from public;
grant execute on function public.staff_login_names() to anon, authenticated;

-- 5. Team list for technicians (no rates, no passwords), for signed-in staff only.
create or replace view public.staff_directory as
select id, name, role, active, is_technician, (auth_user_id is not null) as auth_linked
from public.user_accounts
where public.app_is_staff();
revoke all on public.staff_directory from anon, public;
grant select on public.staff_directory to authenticated;

-- 6. The new, signed-in-only policies. They sit next to the old open ones until Step B removes those.
drop policy if exists "staff read units" on public.fleet_units;
create policy "staff read units" on public.fleet_units for select to authenticated using (public.app_is_staff());
drop policy if exists "staff write units" on public.fleet_units;
create policy "staff write units" on public.fleet_units for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());

drop policy if exists "staff read work orders" on public.work_orders;
create policy "staff read work orders" on public.work_orders for select to authenticated using (public.app_is_staff());
drop policy if exists "staff write work orders" on public.work_orders;
create policy "staff write work orders" on public.work_orders for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());

drop policy if exists "staff read logs" on public.activity_logs;
create policy "staff read logs" on public.activity_logs for select to authenticated using (public.app_is_staff());
drop policy if exists "staff write logs" on public.activity_logs;
create policy "staff write logs" on public.activity_logs for insert to authenticated with check (public.app_is_staff());

-- Accounts: Admins see and edit everyone; everyone else sees only their own row.
drop policy if exists "admin or self read accounts" on public.user_accounts;
create policy "admin or self read accounts" on public.user_accounts for select to authenticated
  using (public.app_is_admin() or auth_user_id = auth.uid());
drop policy if exists "admin update accounts" on public.user_accounts;
create policy "admin update accounts" on public.user_accounts for update to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

-- Punches: all staff can read (work-order history shows every technician's punches);
-- technicians can only create/change their own; only Admins delete.
drop policy if exists "staff read time entries" on public.time_entries;
create policy "staff read time entries" on public.time_entries for select to authenticated using (public.app_is_staff());
drop policy if exists "own or admin insert time entries" on public.time_entries;
create policy "own or admin insert time entries" on public.time_entries for insert to authenticated
  with check (public.app_is_admin() or user_id = public.app_staff_name());
drop policy if exists "own or admin update time entries" on public.time_entries;
create policy "own or admin update time entries" on public.time_entries for update to authenticated
  using (public.app_is_admin() or user_id = public.app_staff_name())
  with check (public.app_is_admin() or user_id = public.app_staff_name());
drop policy if exists "admin delete time entries" on public.time_entries;
create policy "admin delete time entries" on public.time_entries for delete to authenticated using (public.app_is_admin());

drop policy if exists "staff read payroll locks" on public.payroll_period_locks;
create policy "staff read payroll locks" on public.payroll_period_locks for select to authenticated using (public.app_is_staff());
drop policy if exists "admin write payroll locks" on public.payroll_period_locks;
create policy "admin write payroll locks" on public.payroll_period_locks for all to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

notify pgrst, 'reload schema';
