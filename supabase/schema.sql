create extension if not exists pgcrypto;

create table if not exists public.fleet_units (
  unit text primary key,
  vin text not null,
  client text not null,
  type text not null default 'Fleet unit',
  service text not null default 'Not serviced yet',
  due text not null default 'Schedule PM',
  overdue boolean not null default false,
  usage text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.work_orders (
  id text primary key,
  unit text not null references public.fleet_units(unit) on update cascade on delete restrict,
  client text not null,
  tech text not null default 'Unassigned',
  priority text not null default 'Normal' check (priority in ('High', 'Normal', 'Low')),
  status text not null default 'In Progress' check (status in ('In Progress', 'Waiting on Parts', 'Waiting on Estimates', 'Completed')),
  issue text not null,
  updated text not null default 'Just now',
  usage text not null,
  notes jsonb not null default '[]'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null check (entity_type in ('unit', 'work_order')),
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_accounts (
  id text primary key,
  name text not null unique,
  role text not null default 'Technician' check (role in ('Admin', 'Technician')),
  password text not null,
  active boolean not null default true,
  is_technician boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_name text not null,
  work_order_id text references public.work_orders(id) on update cascade on delete set null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  total_hours numeric(8,2),
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fleet_units_touch_updated_at on public.fleet_units;
create trigger fleet_units_touch_updated_at before update on public.fleet_units for each row execute function public.touch_updated_at();
drop trigger if exists work_orders_touch_updated_at on public.work_orders;
create trigger work_orders_touch_updated_at before update on public.work_orders for each row execute function public.touch_updated_at();
drop trigger if exists user_accounts_touch_updated_at on public.user_accounts;
create trigger user_accounts_touch_updated_at before update on public.user_accounts for each row execute function public.touch_updated_at();

alter table public.fleet_units enable row level security;
alter table public.work_orders enable row level security;
alter table public.activity_logs enable row level security;
alter table public.user_accounts enable row level security;
alter table public.time_entries enable row level security;
alter table public.fleet_units replica identity full;
alter table public.work_orders replica identity full;
alter table public.activity_logs replica identity full;
alter table public.user_accounts replica identity full;
alter table public.time_entries replica identity full;
drop policy if exists "dashboard users can read units" on public.fleet_units;
drop policy if exists "dashboard users can write units" on public.fleet_units;
drop policy if exists "dashboard users can read work orders" on public.work_orders;
drop policy if exists "dashboard users can write work orders" on public.work_orders;
drop policy if exists "dashboard users can read logs" on public.activity_logs;
drop policy if exists "dashboard users can write logs" on public.activity_logs;
drop policy if exists "dashboard users can read accounts" on public.user_accounts;
drop policy if exists "dashboard users can write accounts" on public.user_accounts;
drop policy if exists "dashboard users can read time entries" on public.time_entries;
drop policy if exists "dashboard users can write time entries" on public.time_entries;
create policy "dashboard users can read units" on public.fleet_units for select to anon, authenticated using (true);
create policy "dashboard users can write units" on public.fleet_units for all to anon, authenticated using (true) with check (true);
create policy "dashboard users can read work orders" on public.work_orders for select to anon, authenticated using (true);
create policy "dashboard users can write work orders" on public.work_orders for all to anon, authenticated using (true) with check (true);
create policy "dashboard users can read logs" on public.activity_logs for select to anon, authenticated using (true);
create policy "dashboard users can write logs" on public.activity_logs for insert to anon, authenticated with check (true);
create policy "dashboard users can read accounts" on public.user_accounts for select to anon, authenticated using (true);
create policy "dashboard users can write accounts" on public.user_accounts for all to anon, authenticated using (true) with check (true);
create policy "dashboard users can read time entries" on public.time_entries for select to anon, authenticated using (true);
create policy "dashboard users can write time entries" on public.time_entries for all to anon, authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid = pr.prrelid join pg_namespace n on n.oid = c.relnamespace where pr.prpubid = (select oid from pg_publication where pubname = 'supabase_realtime') and n.nspname = 'public' and c.relname = 'fleet_units') then
    alter publication supabase_realtime add table public.fleet_units;
  end if;
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid = pr.prrelid join pg_namespace n on n.oid = c.relnamespace where pr.prpubid = (select oid from pg_publication where pubname = 'supabase_realtime') and n.nspname = 'public' and c.relname = 'work_orders') then
    alter publication supabase_realtime add table public.work_orders;
  end if;
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid = pr.prrelid join pg_namespace n on n.oid = c.relnamespace where pr.prpubid = (select oid from pg_publication where pubname = 'supabase_realtime') and n.nspname = 'public' and c.relname = 'activity_logs') then
    alter publication supabase_realtime add table public.activity_logs;
  end if;
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid = pr.prrelid join pg_namespace n on n.oid = c.relnamespace where pr.prpubid = (select oid from pg_publication where pubname = 'supabase_realtime') and n.nspname = 'public' and c.relname = 'user_accounts') then
    alter publication supabase_realtime add table public.user_accounts;
  end if;
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid = pr.prrelid join pg_namespace n on n.oid = c.relnamespace where pr.prpubid = (select oid from pg_publication where pubname = 'supabase_realtime') and n.nspname = 'public' and c.relname = 'time_entries') then
    alter publication supabase_realtime add table public.time_entries;
  end if;
end $$;
