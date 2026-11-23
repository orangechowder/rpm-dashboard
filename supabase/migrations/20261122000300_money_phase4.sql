-- Money / Argent · Phase 4: GST/QST filings marked as sent, and CSV import batches.
-- ADDITIVE ONLY. ADMINS ONLY via RLS. Rollback: supabase/rollback/20261122000300_money_phase4_rollback.sql

create table public.money_tax_filings (
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  filed_on date not null default current_date,
  amount_cents bigint not null,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (period_start, period_end)
);

create table public.money_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('bank', 'wave', 'desjardins')),
  file_name text not null default '' check (length(file_name) <= 200),
  row_count integer not null default 0 check (row_count >= 0),
  created_by text,
  created_at timestamptz not null default now()
);

create function public.money_created_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(public.app_staff_name(), current_user);
  new.created_at := now();
  return new;
end $$;
revoke all on function public.money_created_stamp() from public, anon, authenticated;

create trigger money_tax_filings_stamp before insert or update on public.money_tax_filings for each row execute function public.money_created_stamp();
create trigger money_tax_filings_audit after insert or update or delete on public.money_tax_filings for each row execute function public.money_audit();
create trigger money_import_batches_stamp before insert on public.money_import_batches for each row execute function public.money_created_stamp();
create trigger money_import_batches_audit after insert on public.money_import_batches for each row execute function public.money_audit();
create trigger money_import_batches_no_change before update or delete on public.money_import_batches for each row execute function public.money_forbid_change();

alter table public.money_tax_filings enable row level security;
alter table public.money_import_batches enable row level security;
create policy "money admin read filings" on public.money_tax_filings for select to authenticated using (public.app_is_admin());
create policy "money admin mark filed" on public.money_tax_filings for insert to authenticated with check (public.app_is_admin());
create policy "money admin update filing" on public.money_tax_filings for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
create policy "money admin undo filed" on public.money_tax_filings for delete to authenticated using (public.app_is_admin());
create policy "money admin read imports" on public.money_import_batches for select to authenticated using (public.app_is_admin());
create policy "money admin add import" on public.money_import_batches for insert to authenticated with check (public.app_is_admin());
revoke all on public.money_tax_filings, public.money_import_batches from anon, authenticated;
grant select, insert, update, delete on public.money_tax_filings to authenticated;
grant select, insert on public.money_import_batches to authenticated;

notify pgrst, 'reload schema';
