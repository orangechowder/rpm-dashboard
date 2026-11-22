-- Phase 0 · Step C: delete the old passwords for good.
-- Run ONLY when every active account shows "Secure sign-in ✓" in User Management and the new login has
-- been stable for a few days. After this, rolling back to the old site is no longer possible.

do $$
begin
  if exists (select 1 from public.user_accounts where active and auth_user_id is null) then
    raise exception 'Some active accounts have not switched to the new sign-in yet: %',
      (select string_agg(name, ', ') from public.user_accounts where active and auth_user_id is null);
  end if;
end $$;

drop trigger if exists user_accounts_sync_legacy_password on public.user_accounts;
drop function if exists public.sync_legacy_password();
drop table if exists public.legacy_passwords;
alter table public.user_accounts drop column if exists password;
alter table public.user_accounts drop column if exists legacy_failed_attempts;

notify pgrst, 'reload schema';
