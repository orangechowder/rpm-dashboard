-- ROLLBACK for the Wave → Money sync. Removes only what 20261123000100_money_wave_sync.sql created and restores
-- the original trigger functions. Entries the sync added stay as ordinary entries (source 'wave' becomes 'import')
-- so no money disappears; their Wave IDs are dropped.
drop function if exists public.money_wave_apply(jsonb);
drop table if exists public.money_wave_review;
drop function if exists public.money_wave_review_stamp();
drop table if exists public.money_wave_map;
drop table if exists public.money_wave_runs;
drop table if exists public.money_wave_connection;

alter table public.money_entries disable trigger money_entries_lock;
update public.money_entries set source = 'import' where source = 'wave';
alter table public.money_entries enable trigger money_entries_lock;
alter table public.money_entries drop constraint money_entries_source_check;
alter table public.money_entries add constraint money_entries_source_check check (source in ('manual', 'recurring', 'import'));
alter table public.money_entries drop constraint if exists money_entries_wave_once;
drop index if exists public.money_entries_wave_payment_idx;
alter table public.money_entries drop column if exists wave_key, drop column if exists wave_payment_id;

create or replace function public.money_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(public.app_staff_name(), current_user);
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'money_entries' then new.created_by := who; new.created_at := now(); end if;
  end if;
  if tg_table_name = 'money_month_locks' then new.locked_by := who; new.locked_at := now();
  elsif tg_table_name in ('money_entries', 'money_settings', 'money_bank_balances') then new.updated_by := who; new.updated_at := now();
  elsif tg_table_name in ('money_parties', 'money_categories') then new.updated_at := now();
  end if;
  if tg_table_name = 'money_entries' then
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then new.deleted_by := who; end if;
    if new.deleted_at is null then new.deleted_by := null; end if;
  end if;
  return new;
end $$;

create or replace function public.money_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare key text;
begin
  key := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'month', to_jsonb(old) ->> 'month', '');
  insert into public.money_audit_log (actor, actor_auth_id, table_name, row_id, action, old_data, new_data)
  values (coalesce(public.app_staff_name(), current_user), auth.uid(), tg_table_name, key, lower(tg_op),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create or replace function public.money_check_month_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and exists (select 1 from public.money_month_locks where month = date_trunc('month', old.entry_date)::date) then
    raise exception 'money_month_locked: % is closed', to_char(old.entry_date, 'YYYY-MM') using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and exists (select 1 from public.money_month_locks where month = date_trunc('month', new.entry_date)::date) then
    raise exception 'money_month_locked: % is closed', to_char(new.entry_date, 'YYYY-MM') using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.money_created_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(public.app_staff_name(), current_user);
  new.created_at := now();
  return new;
end $$;

drop function if exists public.money_actor();
notify pgrst, 'reload schema';
