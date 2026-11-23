-- Money / Argent · Wave → Money sync (one-way, read-only on Wave's side).
-- ADDITIVE: new tables/columns/functions; two existing check rules are widened, three trigger functions
-- gain the "Wave sync" actor. Rollback: supabase/rollback/20261123000100_money_wave_sync_rollback.sql

-- ---------- Who did it: a person, or "Wave sync" ----------
create function public.money_actor() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_staff_name(), nullif(current_setting('money.actor', true), ''), current_user)
$$;
revoke all on function public.money_actor() from public, anon, authenticated;

create or replace function public.money_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := public.money_actor();
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

create or replace function public.money_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare key text;
begin
  key := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'month', to_jsonb(old) ->> 'month',
                  to_jsonb(new) ->> 'wave_ref', to_jsonb(old) ->> 'wave_ref', to_jsonb(new) ->> 'match_key', to_jsonb(old) ->> 'match_key', '');
  insert into public.money_audit_log (actor, actor_auth_id, table_name, row_id, action, old_data, new_data)
  values (public.money_actor(), auth.uid(), tg_table_name, key, lower(tg_op),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create or replace function public.money_created_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := public.money_actor();
  new.created_at := now();
  return new;
end $$;

-- Closed months stay closed, except for quietly attaching a Wave ID to an entry (nothing about the money changes).
create or replace function public.money_check_month_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['wave_key', 'wave_payment_id', 'net_cents']) = (to_jsonb(old) - array['wave_key', 'wave_payment_id', 'net_cents']) then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and exists (select 1 from public.money_month_locks where month = date_trunc('month', old.entry_date)::date) then
    raise exception 'money_month_locked: % is closed', to_char(old.entry_date, 'YYYY-MM') using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and exists (select 1 from public.money_month_locks where month = date_trunc('month', new.entry_date)::date) then
    raise exception 'money_month_locked: % is closed', to_char(new.entry_date, 'YYYY-MM') using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- ---------- Entries: the Wave payment each one came from ----------
alter table public.money_entries add column wave_key text, add column wave_payment_id text;
alter table public.money_entries add constraint money_entries_wave_once unique (wave_key);
create index money_entries_wave_payment_idx on public.money_entries (wave_payment_id);
alter table public.money_entries drop constraint money_entries_source_check;
alter table public.money_entries add constraint money_entries_source_check check (source in ('manual', 'recurring', 'import', 'wave'));

-- ---------- The connection (one row). Tokens are AES-256-GCM encrypted by the server; no browser access at all. ----------
create table public.money_wave_connection (
  id integer primary key default 1 check (id = 1),
  business_id text not null,
  business_name text not null default '',
  access_token_enc text not null,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scope text not null default '',
  connected_by text,
  connected_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  sync_from date,
  csv_until date,
  fee_account_id text,
  fee_baseline_cents bigint,
  status text not null default 'connected' check (status in ('connected', 'expired', 'error')),
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  alert_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.money_wave_connection enable row level security;
revoke all on public.money_wave_connection from anon, authenticated;

-- ---------- Each sync / dry run / nightly check ----------
create table public.money_wave_runs (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('dry-run', 'sync')),
  trigger text not null check (trigger in ('manual', 'cron', 'approve')),
  started_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  added integer not null default 0,
  updated integer not null default 0,
  linked integer not null default 0,
  trashed integer not null default 0,
  flagged integer not null default 0,
  error text,
  summary jsonb
);
alter table public.money_wave_runs enable row level security;
create policy "money admin read wave runs" on public.money_wave_runs for select to authenticated using (public.app_is_admin());
revoke all on public.money_wave_runs from anon, authenticated;
grant select on public.money_wave_runs to authenticated;

-- ---------- Wave product / account / tax → Money category (editable in Settings) ----------
create table public.money_wave_map (
  wave_ref text primary key,
  kind text not null check (kind in ('item', 'tax')),
  label text not null default '',
  suggested_category_id text references public.money_categories(id),
  category_id text references public.money_categories(id),
  updated_at timestamptz not null default now()
);
create trigger money_wave_map_audit after insert or update or delete on public.money_wave_map for each row execute function public.money_audit();
alter table public.money_wave_map enable row level security;
create policy "money admin read wave map" on public.money_wave_map for select to authenticated using (public.app_is_admin());
create policy "money admin edit wave map" on public.money_wave_map for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
revoke all on public.money_wave_map from anon, authenticated;
grant select, update (category_id) on public.money_wave_map to authenticated;

-- ---------- "To review": unmapped items, closed-month changes, nightly gaps, unmatched payments ----------
create table public.money_wave_review (
  ref text primary key,
  kind text not null check (kind in ('unmapped', 'closed-month', 'gap', 'unmatched', 'refund', 'fees')),
  title text not null default '',
  details jsonb not null default '{}'::jsonb,
  amount_cents bigint,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution in ('added', 'ignored', 'fixed'))
);
create function public.money_wave_review_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.resolution is distinct from old.resolution or new.resolved_at is distinct from old.resolved_at then
    new.resolved_by := case when new.resolved_at is null then null else public.money_actor() end;
  end if;
  return new;
end $$;
revoke all on function public.money_wave_review_stamp() from public, anon, authenticated;
create trigger money_wave_review_stamp before update on public.money_wave_review for each row execute function public.money_wave_review_stamp();
create trigger money_wave_review_audit after update on public.money_wave_review for each row execute function public.money_audit();
alter table public.money_wave_review enable row level security;
create policy "money admin read wave review" on public.money_wave_review for select to authenticated using (public.app_is_admin());
create policy "money admin resolve wave review" on public.money_wave_review for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
revoke all on public.money_wave_review from anon, authenticated;
grant select, update (resolved_at, resolved_by, resolution) on public.money_wave_review to authenticated;

-- ---------- Applying a sync: one call, recorded as "Wave sync"; a refused line never stops the others ----------
create function public.money_wave_apply(ops jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  op jsonb;
  r jsonb;
  done integer := 0;
  failed jsonb := '[]'::jsonb;
  n integer;
begin
  perform set_config('money.actor', 'Wave sync', true);
  for op in select * from jsonb_array_elements(ops) loop
    begin
      r := op -> 'row';
      if op ->> 'op' = 'insert' then
        insert into public.money_entries (kind, entry_date, category_id, party_name, description, total_cents, gst_cents, qst_cents,
                                          taxes_included, payment_method, paid, paid_on, source, wave_key, wave_payment_id)
        values (r ->> 'kind', (r ->> 'date')::date, r ->> 'category_id', coalesce(r ->> 'party', ''), coalesce(r ->> 'description', ''),
                (r ->> 'total_cents')::bigint, (r ->> 'gst_cents')::bigint, (r ->> 'qst_cents')::bigint,
                ((r ->> 'gst_cents')::bigint + (r ->> 'qst_cents')::bigint) > 0, r ->> 'payment_method', true, (r ->> 'date')::date,
                'wave', r ->> 'wave_key', r ->> 'wave_payment_id')
        on conflict (wave_key) do nothing;
      elsif op ->> 'op' = 'update' then
        update public.money_entries set
          entry_date = (r ->> 'date')::date, paid_on = (r ->> 'date')::date, category_id = r ->> 'category_id',
          party_name = coalesce(r ->> 'party', ''), description = coalesce(r ->> 'description', ''),
          total_cents = (r ->> 'total_cents')::bigint, gst_cents = (r ->> 'gst_cents')::bigint, qst_cents = (r ->> 'qst_cents')::bigint,
          taxes_included = ((r ->> 'gst_cents')::bigint + (r ->> 'qst_cents')::bigint) > 0
        where id = (op ->> 'id')::uuid and wave_key = r ->> 'wave_key' and deleted_at is null;
      elsif op ->> 'op' = 'link' then
        update public.money_entries set wave_key = op ->> 'wave_key', wave_payment_id = op ->> 'wave_payment_id'
        where id = (op ->> 'id')::uuid and wave_key is null;
      elsif op ->> 'op' = 'trash' then
        update public.money_entries set deleted_at = now() where id = (op ->> 'id')::uuid and wave_key is not null and deleted_at is null;
      else
        raise exception 'unknown op %', op ->> 'op';
      end if;
      get diagnostics n = row_count;
      done := done + n;
    exception when others then
      failed := failed || jsonb_build_object('op', op, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('done', done, 'failed', failed);
end $$;
revoke all on function public.money_wave_apply(jsonb) from public, anon, authenticated;
grant execute on function public.money_wave_apply(jsonb) to service_role;

notify pgrst, 'reload schema';
