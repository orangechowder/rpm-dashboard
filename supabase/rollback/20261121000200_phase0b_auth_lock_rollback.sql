-- EMERGENCY ROLLBACK for Phase 0 · Step B (lock).
-- Puts back the old, open access so the PREVIOUS site version (plain-text login) works again.
-- Use together with a Vercel "Instant Rollback" to the previous deployment. Everyone logs in with
-- their OLD password on the old site (the old passwords are restored from legacy_passwords below).
-- This re-exposes the data to the public key: re-run Step B as soon as the problem is fixed.

update public.user_accounts ua set password = lp.password
from public.legacy_passwords lp where lp.account_id = ua.id;

grant select, insert, update, delete on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon;
grant select, insert, update, delete on public.user_accounts to authenticated;

do $$
declare v text;
begin
  foreach v in array array['timesheet_entries', 'daily_timesheet_summary', 'weekly_timesheet_summary'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = false)', v);
    end if;
  end loop;
end $$;

drop policy if exists "dashboard users can read units" on public.fleet_units;
drop policy if exists "dashboard users can write units" on public.fleet_units;
drop policy if exists "dashboard users can read work orders" on public.work_orders;
drop policy if exists "dashboard users can write work orders" on public.work_orders;
drop policy if exists "dashboard users can read logs" on public.activity_logs;
drop policy if exists "dashboard users can write logs" on public.activity_logs;
drop policy if exists "dashboard users can read accounts" on public.user_accounts;
drop policy if exists "dashboard users can write accounts" on public.user_accounts;
drop policy if exists "dashboard users can read time entries" on public.time_entries;
drop policy if exists "dashboard users can write time entries" on public.time_entries;
drop policy if exists "dashboard users can read payroll locks" on public.payroll_period_locks;
drop policy if exists "dashboard users can write payroll locks" on public.payroll_period_locks;
create policy "dashboard users can read units" on public.fleet_units for select to anon, authenticated using (true);
create policy "dashboard users can write units" on public.fleet_units for all to anon, authenticated using (true) with check (true);
create policy "dashboard users can read work orders" on public.work_orders for select to anon, authenticated using (true);
create policy "dashboard users can write work orders" on public.work_orders for all to anon, authenticated using (true) with check (true);
create policy "dashboard users can read logs" on public.activity_logs for select to anon, authenticated using (true);
create policy "dashboard users can write logs" on public.activity_logs for insert to anon, authenticated with check (true);
create policy "dashboard users can read accounts" on public.user_accounts for select to anon, authenticated using (true);
create policy "dashboard users can write accounts" on public.user_accounts for all to anon, authenticated using (true) with check (true);
create policy "dashboard users can read time entries" on public.time_entries for select to anon, authenticated using (true);
create policy "dashboard users can write time entries" on public.time_entries for all to anon, authenticated using (true) with check (true);
create policy "dashboard users can read payroll locks" on public.payroll_period_locks for select to anon, authenticated using (true);
create policy "dashboard users can write payroll locks" on public.payroll_period_locks for all to anon, authenticated using (true) with check (true);

-- legacy_passwords stays server-only even in rollback.
revoke all on public.legacy_passwords from anon, authenticated;

notify pgrst, 'reload schema';
