-- ROLLBACK for Money / Argent · Phase 1. Removes ONLY what 20261122000100_money_phase1.sql created.
-- It DELETES all Money data. It refuses to run if any entry exists, unless you first run in the same
-- session:   set money.rollback_confirm = 'delete-all-money-data';
-- Supabase doesn't allow deleting storage buckets or files from SQL: the private "money-receipts"
-- bucket (and any receipt photos in it) stays. To remove it too: Supabase → Storage → money-receipts →
-- empty it, then delete the bucket. With the policies below removed, nobody can read it from the app.
-- Run AFTER the Phase 3 and Phase 4 rollbacks if those were applied.

do $$
begin
  if exists (select 1 from public.money_entries) and coalesce(current_setting('money.rollback_confirm', true), '') <> 'delete-all-money-data' then
    raise exception 'money_entries has data. Export it first, then: set money.rollback_confirm = ''delete-all-money-data'';';
  end if;
end $$;

drop policy if exists "money receipts admin read" on storage.objects;
drop policy if exists "money receipts admin upload" on storage.objects;

drop table if exists public.money_audit_log;
drop table if exists public.money_bank_balances;
drop table if exists public.money_month_locks;
drop table if exists public.money_settings;
drop table if exists public.money_entries;
drop table if exists public.money_parties;
drop table if exists public.money_categories;
drop function if exists public.money_stamp();
drop function if exists public.money_audit();
drop function if exists public.money_check_month_lock();
drop function if exists public.money_forbid_change();

notify pgrst, 'reload schema';
