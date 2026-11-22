-- ROLLBACK for Money / Argent · Phase 3 (bills that repeat). Removes only what 20261122000200_money_phase3.sql created.
-- Entries already logged by bills stay (they're ordinary entries); they just lose the link to the bill.
-- Refuses if bills exist unless: set money.rollback_confirm = 'delete-all-money-data';
do $$
begin
  if exists (select 1 from public.money_recurring) and coalesce(current_setting('money.rollback_confirm', true), '') <> 'delete-all-money-data' then
    raise exception 'money_recurring has data. Set money.rollback_confirm = ''delete-all-money-data'' to remove it.';
  end if;
end $$;
drop table if exists public.money_recurring;
drop function if exists public.money_recurring_stamp();
notify pgrst, 'reload schema';
