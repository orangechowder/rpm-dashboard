-- Wave sync: a separate connection state for "Wave Pro expired" (the nightly sync pauses until Wave is connected again).
-- ADDITIVE: only widens one check rule. Rollback: supabase/rollback/20261128000200_wave_pro_expired_rollback.sql
alter table public.money_wave_connection drop constraint money_wave_connection_status_check;
alter table public.money_wave_connection add constraint money_wave_connection_status_check check (status in ('connected', 'expired', 'error', 'pro_expired'));
notify pgrst, 'reload schema';
