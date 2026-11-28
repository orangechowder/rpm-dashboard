-- ROLLBACK for 20261128000200_wave_pro_expired.sql ("Wave Pro expired" becomes plain "expired").
update public.money_wave_connection set status = 'expired' where status = 'pro_expired';
alter table public.money_wave_connection drop constraint money_wave_connection_status_check;
alter table public.money_wave_connection add constraint money_wave_connection_status_check check (status in ('connected', 'expired', 'error'));
notify pgrst, 'reload schema';
