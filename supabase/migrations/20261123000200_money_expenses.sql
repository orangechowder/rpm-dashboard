-- Money / Argent · Expenses from bank / credit-card CSVs.
-- ADDITIVE ONLY. Admins only (RLS). Rollback: supabase/rollback/20261123000200_money_expenses_rollback.sql
--   • per-category tax setting (GST+QST included / GST only / no tax)
--   • a short "receipt reference" on entries (receipt photos are turned off; the storage bucket stays untouched)
--   • remembered bank lines: "PETRO-CAN #…" → Petro-Canada → Fuel, or "this is a transfer, not an expense"

alter table public.money_categories add column tax_mode text not null default 'gst_qst' check (tax_mode in ('gst_qst', 'gst_only', 'none'));
update public.money_categories set tax_mode = 'none' where not taxable_default;

alter table public.money_entries add column receipt_ref text not null default '' check (length(receipt_ref) <= 120);

create table public.money_bank_rules (
  match_key text primary key check (length(match_key) between 2 and 120),
  kind text not null check (kind in ('in', 'out')),
  action text not null check (action in ('category', 'transfer')),
  category_id text references public.money_categories(id),
  party_name text not null default '' check (length(party_name) <= 120),
  tax_mode text check (tax_mode in ('gst_qst', 'gst_only', 'none')),
  example text not null default '' check (length(example) <= 200),
  created_by text,
  created_at timestamptz not null default now(),
  constraint money_bank_rules_category check (action = 'transfer' or category_id is not null)
);
create trigger money_bank_rules_stamp before insert or update on public.money_bank_rules for each row execute function public.money_created_stamp();
create trigger money_bank_rules_audit after insert or update or delete on public.money_bank_rules for each row execute function public.money_audit();
alter table public.money_bank_rules enable row level security;
create policy "money admin read bank rules" on public.money_bank_rules for select to authenticated using (public.app_is_admin());
create policy "money admin add bank rules" on public.money_bank_rules for insert to authenticated with check (public.app_is_admin());
create policy "money admin change bank rules" on public.money_bank_rules for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
create policy "money admin forget bank rules" on public.money_bank_rules for delete to authenticated using (public.app_is_admin());
revoke all on public.money_bank_rules from anon, authenticated;
grant select, insert, update, delete on public.money_bank_rules to authenticated;

notify pgrst, 'reload schema';
