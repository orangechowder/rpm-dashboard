-- ROLLBACK for Money / Argent · Phase 4. Removes only what 20261122000300_money_phase4.sql created.
-- Imported entries stay (they're ordinary entries). "Sent" marks on tax periods are lost.
drop table if exists public.money_tax_filings;
drop table if exists public.money_import_batches;
drop function if exists public.money_created_stamp();
notify pgrst, 'reload schema';
