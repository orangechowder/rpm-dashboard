-- ROLLBACK for 20261123000200_money_expenses.sql. Removes only what it added.
-- Receipt references typed on entries and remembered bank lines are lost; categories keep "taxable yes/no".
drop table if exists public.money_bank_rules;
alter table public.money_entries drop column if exists receipt_ref;
alter table public.money_categories drop column if exists tax_mode;
notify pgrst, 'reload schema';
