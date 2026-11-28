-- Shared client list (was saved separately in each browser) + Wave customers → client list (add only).
-- ADDITIVE: three new tables and one function; nothing existing changes. Units, work orders and Money
-- entries keep storing the client's name as text.
-- Rollback: supabase/rollback/20261128000100_clients_rollback.sql

-- ---------- The list. Removing a client hides it (removed_at) so the Wave sync never brings it back. ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  name_key text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored unique,
  wave_customer_id text unique,
  source text not null default 'dashboard' check (source in ('dashboard', 'wave')),
  -- Added by a technician from the unit form: waits in "Check these" until an Admin approves it.
  pending boolean not null default false,
  removed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.clients_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := public.money_actor(); new.created_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.clients_stamp() from public, anon, authenticated;
create trigger clients_stamp before insert or update on public.clients for each row execute function public.clients_stamp();
-- Every add / rename / remove goes to the existing append-only audit log (money_audit_log, Admins can read it).
create trigger clients_audit after insert or update or delete on public.clients for each row execute function public.money_audit();

alter table public.clients enable row level security;
-- Everyone signed in sees the list (technicians pick a client on a unit); only Admins change it.
-- Technicians may only PROPOSE a new name (pending, no Wave ID); an Admin approves it in "Check these".
create policy "clients staff read" on public.clients for select to authenticated using (public.app_is_staff());
create policy "clients admin insert" on public.clients for insert to authenticated with check (public.app_is_admin());
create policy "clients staff propose" on public.clients for insert to authenticated
  with check (public.app_is_staff() and pending and source = 'dashboard' and wave_customer_id is null);
create policy "clients admin update" on public.clients for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
revoke all on public.clients from anon, authenticated;
grant select on public.clients to authenticated;
grant insert (name, source, wave_customer_id, pending), update (name, removed_at, wave_customer_id, pending) on public.clients to authenticated;

-- ---------- "Check these": Wave customers an Admin said are the same as an existing client (never added) ----------
create table public.client_wave_skip (
  wave_customer_id text primary key,
  wave_name text not null default '',
  same_as text not null default '',
  decided_by text,
  decided_at timestamptz not null default now()
);
create function public.client_wave_skip_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.decided_by := public.money_actor(); new.decided_at := now(); return new; end $$;
revoke all on function public.client_wave_skip_stamp() from public, anon, authenticated;
create trigger client_wave_skip_stamp before insert on public.client_wave_skip for each row execute function public.client_wave_skip_stamp();
create trigger client_wave_skip_audit after insert or delete on public.client_wave_skip for each row execute function public.money_audit();
alter table public.client_wave_skip enable row level security;
create policy "client skip admin read" on public.client_wave_skip for select to authenticated using (public.app_is_admin());
create policy "client skip admin insert" on public.client_wave_skip for insert to authenticated with check (public.app_is_admin());
revoke all on public.client_wave_skip from anon, authenticated;
grant select, insert (wave_customer_id, wave_name, same_as) on public.client_wave_skip to authenticated;

-- ---------- The customer sync's state (one row): approved after the first preview; last result. Server only. ----------
create table public.client_wave_state (
  id integer primary key default 1 check (id = 1),
  approved_at timestamptz,
  approved_by text,
  last_run_at timestamptz,
  last_mode text,
  last_summary jsonb,
  last_error text
);
alter table public.client_wave_state enable row level security;
revoke all on public.client_wave_state from anon, authenticated;

-- ---------- Applying: only adds names and attaches Wave IDs to rows that have none. Recorded as "Wave sync". ----------
create function public.clients_wave_apply(adds jsonb, links jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a jsonb;
  added integer := 0;
  linked integer := 0;
  n integer;
begin
  perform set_config('money.actor', 'Wave sync', true);
  for a in select * from jsonb_array_elements(coalesce(adds, '[]'::jsonb)) loop
    insert into public.clients (name, wave_customer_id, source) values (trim(a ->> 'name'), a ->> 'wave_id', 'wave')
    on conflict do nothing;
    get diagnostics n = row_count; added := added + n;
  end loop;
  for a in select * from jsonb_array_elements(coalesce(links, '[]'::jsonb)) loop
    update public.clients set wave_customer_id = a ->> 'wave_id'
    where id = (a ->> 'client_id')::uuid and wave_customer_id is null
      and not exists (select 1 from public.clients c where c.wave_customer_id = a ->> 'wave_id');
    get diagnostics n = row_count; linked := linked + n;
  end loop;
  return jsonb_build_object('added', added, 'linked', linked);
end $$;
revoke all on function public.clients_wave_apply(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.clients_wave_apply(jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
