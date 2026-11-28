-- ROLLBACK for 20261128000100_clients.sql. Removes only what it created. Units, work orders and Money entries
-- are untouched (they never pointed at this table). Export the list first if you want to keep it:
--   npm run backup   (or: select name from public.clients where removed_at is null order by name)
drop function if exists public.clients_wave_apply(jsonb, jsonb);
drop table if exists public.client_wave_state;
drop table if exists public.client_wave_skip;
drop function if exists public.client_wave_skip_stamp();
drop table if exists public.clients;
drop function if exists public.clients_stamp();
notify pgrst, 'reload schema';
