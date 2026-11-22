-- Money / Argent · Phase 1: entries, categories, suppliers/clients memory, settings, month locks,
-- bank-balance check, audit log and the private receipts bucket.
-- ADDITIVE ONLY: creates new objects; nothing that existed before is altered or dropped.
-- ADMINS ONLY: every table is under RLS with public.app_is_admin() (from Phase 0); the public key
-- (anon) has no grants at all. Rollback: supabase/rollback/20261122000100_money_phase1_rollback.sql

-- ---------- Categories (the spreadsheet's 4 income + 17 expense lines) ----------
create table public.money_categories (
  id text primary key,
  kind text not null check (kind in ('in', 'out')),
  name_en text not null,
  name_fr text not null,
  icon text not null default 'receipt',
  sort_order integer not null,
  needs_receipt boolean not null default true,
  taxable_default boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.money_categories (id, kind, name_en, name_fr, icon, sort_order, needs_receipt, taxable_default) values
  ('labour_revenue', 'in', 'Labour revenue', 'Revenus de main-d''œuvre', 'wrench', 1, false, true),
  ('parts_sales', 'in', 'Parts sales', 'Vente de pièces', 'package', 2, false, true),
  ('service_call_fees', 'in', 'Service call / travel fees', 'Frais de déplacement / appel de service', 'truck', 3, false, true),
  ('other_income', 'in', 'Other income', 'Autres revenus', 'coins', 4, false, false),
  ('parts_purchases', 'out', 'Parts purchases', 'Achats de pièces', 'package', 5, true, true),
  ('technician_wages', 'out', 'Technician wages & benefits', 'Salaires et avantages des techniciens', 'hard-hat', 6, false, false),
  ('owner_salary', 'out', 'Owner salary', 'Salaire du propriétaire', 'user', 7, false, false),
  ('fuel', 'out', 'Fuel – service trucks', 'Carburant – camions de service', 'fuel', 8, true, true),
  ('shop_rent', 'out', 'Shop rent / mortgage', 'Loyer / hypothèque de l''atelier', 'building', 9, false, true),
  ('truck_payments', 'out', 'Truck payments / leases', 'Paiements / location de camions', 'car', 10, false, true),
  ('insurance', 'out', 'Insurance', 'Assurances', 'shield', 11, false, false),
  ('tools_equipment', 'out', 'Tools & equipment', 'Outils et équipement', 'hammer', 12, true, true),
  ('vehicle_maintenance', 'out', 'Vehicle & equipment maintenance', 'Entretien des véhicules et de l''équipement', 'settings', 13, true, true),
  ('shop_supplies', 'out', 'Shop supplies & consumables', 'Fournitures et consommables d''atelier', 'spray-can', 14, true, true),
  ('phone_software', 'out', 'Phone, internet & software', 'Téléphone, internet et logiciels', 'smartphone', 15, true, true),
  ('marketing', 'out', 'Marketing & advertising', 'Marketing et publicité', 'megaphone', 16, true, true),
  ('accounting_legal', 'out', 'Accounting & legal', 'Comptabilité et frais juridiques', 'scale', 17, true, true),
  ('utilities', 'out', 'Utilities (hydro, heating)', 'Services publics (hydro, chauffage)', 'zap', 18, true, true),
  ('bank_fees', 'out', 'Bank fees & interest', 'Frais bancaires et intérêts', 'landmark', 19, false, false),
  ('subcontracting', 'out', 'Subcontracting', 'Sous-traitance', 'handshake', 20, true, true),
  ('other_expenses', 'out', 'Other expenses', 'Autres dépenses', 'receipt', 21, true, true);

-- ---------- Clients & suppliers remembered by the Money section (supplier → category memory) ----------
create table public.money_parties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  name_key text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored unique,
  kind text not null default 'supplier' check (kind in ('client', 'supplier', 'both')),
  default_category_id text references public.money_categories(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Entries: every dollar in and out. Amounts are integer CENTS. ----------
create table public.money_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('in', 'out')),
  entry_date date not null,
  category_id text not null references public.money_categories(id),
  party_name text not null default '' check (length(party_name) <= 120),
  description text not null default '' check (length(description) <= 500),
  total_cents bigint not null check (total_cents >= 0),
  gst_cents bigint not null default 0 check (gst_cents >= 0),
  qst_cents bigint not null default 0 check (qst_cents >= 0),
  net_cents bigint generated always as (total_cents - gst_cents - qst_cents) stored,
  taxes_included boolean not null default false,
  payment_method text check (payment_method in ('debit', 'credit', 'transfer', 'cheque', 'cash', 'preauthorized', 'other')),
  paid boolean not null default true,
  paid_on date,
  receipt_path text,
  recurring_id uuid,
  occurrence_date date,
  source text not null default 'manual' check (source in ('manual', 'recurring', 'import')),
  import_batch_id uuid,
  import_key text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint money_entries_taxes_fit check (gst_cents + qst_cents <= total_cents),
  constraint money_entries_one_per_occurrence unique (recurring_id, occurrence_date),
  constraint money_entries_import_once unique (import_key)
);
create index money_entries_date_idx on public.money_entries (entry_date);
create index money_entries_deleted_idx on public.money_entries (deleted_at);

-- ---------- Settings (one row) ----------
create table public.money_settings (
  id integer primary key default 1 check (id = 1),
  fiscal_year_start_month integer not null default 1 check (fiscal_year_start_month between 1 and 12),
  tax_frequency text not null default 'quarterly' check (tax_frequency in ('monthly', 'quarterly', 'yearly')),
  gst_number text not null default '',
  qst_number text not null default '',
  setup_completed_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.money_settings (id) values (1);

-- ---------- Closed months (after the accountant reviews them) ----------
create table public.money_month_locks (
  month date primary key check (extract(day from month) = 1),
  locked_by text,
  locked_at timestamptz not null default now(),
  note text not null default ''
);

-- ---------- Bank balance typed at month end (bank check) ----------
create table public.money_bank_balances (
  month date primary key check (extract(day from month) = 1),
  balance_cents bigint not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ---------- Audit log: who, when, old value, new value. Append-only, kept forever. ----------
create table public.money_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  actor_auth_id uuid,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb
);
create index money_audit_log_row_idx on public.money_audit_log (table_name, row_id);
create index money_audit_log_at_idx on public.money_audit_log (at desc);

-- ---------- Triggers ----------
-- Stamps who/when on every write (can't be spoofed from the browser).
create function public.money_stamp() returns trigger
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

-- Writes the audit row (old + new values) for every change.
create function public.money_audit() returns trigger
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

-- Entries in a closed month can't be added, changed or moved until the month is reopened.
create function public.money_check_month_lock() returns trigger
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

-- Entries are never hard-deleted (soft delete with deleted_at → 30-day trash); the audit log is never changed.
create function public.money_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'money_forbidden: % on % is not allowed', lower(tg_op), tg_table_name using errcode = 'P0001';
end $$;

create trigger money_entries_lock before insert or update or delete on public.money_entries for each row execute function public.money_check_month_lock();
create trigger money_entries_stamp before insert or update on public.money_entries for each row execute function public.money_stamp();
create trigger money_entries_audit after insert or update on public.money_entries for each row execute function public.money_audit();
create trigger money_entries_no_delete before delete on public.money_entries for each row execute function public.money_forbid_change();

create trigger money_categories_stamp before insert or update on public.money_categories for each row execute function public.money_stamp();
create trigger money_categories_audit after insert or update or delete on public.money_categories for each row execute function public.money_audit();
create trigger money_parties_stamp before insert or update on public.money_parties for each row execute function public.money_stamp();
create trigger money_parties_audit after insert or update or delete on public.money_parties for each row execute function public.money_audit();
create trigger money_settings_stamp before insert or update on public.money_settings for each row execute function public.money_stamp();
create trigger money_settings_audit after insert or update on public.money_settings for each row execute function public.money_audit();
create trigger money_month_locks_stamp before insert or update on public.money_month_locks for each row execute function public.money_stamp();
create trigger money_month_locks_audit after insert or update or delete on public.money_month_locks for each row execute function public.money_audit();
create trigger money_bank_balances_stamp before insert or update on public.money_bank_balances for each row execute function public.money_stamp();
create trigger money_bank_balances_audit after insert or update or delete on public.money_bank_balances for each row execute function public.money_audit();
create trigger money_audit_log_append_only before update or delete on public.money_audit_log for each row execute function public.money_forbid_change();
create trigger money_audit_log_no_truncate before truncate on public.money_audit_log for each statement execute function public.money_forbid_change();

-- ---------- Row-level security: Admins only ----------
alter table public.money_categories enable row level security;
alter table public.money_parties enable row level security;
alter table public.money_entries enable row level security;
alter table public.money_settings enable row level security;
alter table public.money_month_locks enable row level security;
alter table public.money_bank_balances enable row level security;
alter table public.money_audit_log enable row level security;

create policy "money admin read categories" on public.money_categories for select to authenticated using (public.app_is_admin());
create policy "money admin update categories" on public.money_categories for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
create policy "money admin read parties" on public.money_parties for select to authenticated using (public.app_is_admin());
create policy "money admin insert parties" on public.money_parties for insert to authenticated with check (public.app_is_admin());
create policy "money admin update parties" on public.money_parties for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
create policy "money admin read entries" on public.money_entries for select to authenticated using (public.app_is_admin());
create policy "money admin insert entries" on public.money_entries for insert to authenticated with check (public.app_is_admin());
create policy "money admin update entries" on public.money_entries for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
create policy "money admin read settings" on public.money_settings for select to authenticated using (public.app_is_admin());
create policy "money admin update settings" on public.money_settings for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
create policy "money admin read locks" on public.money_month_locks for select to authenticated using (public.app_is_admin());
create policy "money admin close month" on public.money_month_locks for insert to authenticated with check (public.app_is_admin());
create policy "money admin reopen month" on public.money_month_locks for delete to authenticated using (public.app_is_admin());
create policy "money admin read balances" on public.money_bank_balances for select to authenticated using (public.app_is_admin());
create policy "money admin insert balances" on public.money_bank_balances for insert to authenticated with check (public.app_is_admin());
create policy "money admin update balances" on public.money_bank_balances for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
create policy "money admin read audit" on public.money_audit_log for select to authenticated using (public.app_is_admin());

revoke all on public.money_categories, public.money_parties, public.money_entries, public.money_settings,
  public.money_month_locks, public.money_bank_balances, public.money_audit_log from anon, authenticated;
grant select, update on public.money_categories to authenticated;
grant select, insert, update on public.money_parties to authenticated;
grant select, insert, update on public.money_entries to authenticated;
grant select, update on public.money_settings to authenticated;
grant select, insert, delete on public.money_month_locks to authenticated;
grant select, insert, update on public.money_bank_balances to authenticated;
grant select on public.money_audit_log to authenticated;
revoke update, delete, truncate on public.money_audit_log from service_role;

revoke all on function public.money_stamp(), public.money_audit(), public.money_check_month_lock(), public.money_forbid_change() from public, anon, authenticated;

-- ---------- Receipts: private bucket, Admins only, files are never deleted from the app ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('money-receipts', 'money-receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy "money receipts admin read" on storage.objects for select to authenticated using (bucket_id = 'money-receipts' and public.app_is_admin());
create policy "money receipts admin upload" on storage.objects for insert to authenticated with check (bucket_id = 'money-receipts' and public.app_is_admin());

notify pgrst, 'reload schema';
