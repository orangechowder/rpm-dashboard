-- Money / Argent · Phase 3: bills that repeat.
-- ADDITIVE ONLY (one new table + its rules). ADMINS ONLY via RLS. Rollback: supabase/rollback/20261122000200_money_phase3_rollback.sql
-- Generated entries point to a rule with money_entries.recurring_id + occurrence_date, which already has a
-- unique key (money_entries_one_per_occurrence): the same bill date can never be logged twice.

create table public.money_recurring (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null default 'out' check (kind in ('in', 'out')),
  category_id text not null references public.money_categories(id),
  party_name text not null default '' check (length(party_name) <= 120),
  amount_cents bigint not null check (amount_cents > 0),
  taxes_included boolean not null default true,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  paused boolean not null default false,
  paused_on date,
  auto_paid boolean not null default true,
  payment_method text check (payment_method in ('debit', 'credit', 'transfer', 'cheque', 'cash', 'preauthorized', 'other')),
  skipped_dates date[] not null default '{}',
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create function public.money_recurring_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(public.app_staff_name(), current_user);
begin
  if tg_op = 'INSERT' then new.created_by := who; new.created_at := now(); end if;
  new.updated_by := who;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.money_recurring_stamp() from public, anon, authenticated;

create trigger money_recurring_stamp before insert or update on public.money_recurring for each row execute function public.money_recurring_stamp();
create trigger money_recurring_audit after insert or update on public.money_recurring for each row execute function public.money_audit();
create trigger money_recurring_no_delete before delete on public.money_recurring for each row execute function public.money_forbid_change();

alter table public.money_recurring enable row level security;
create policy "money admin read recurring" on public.money_recurring for select to authenticated using (public.app_is_admin());
create policy "money admin insert recurring" on public.money_recurring for insert to authenticated with check (public.app_is_admin());
create policy "money admin update recurring" on public.money_recurring for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
revoke all on public.money_recurring from anon, authenticated;
grant select, insert, update on public.money_recurring to authenticated;

notify pgrst, 'reload schema';
