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
  current_meter numeric,
  last_pm_meter numeric,
  pm_interval numeric not null default 25000,
  meter_unit text not null default 'KM' check (meter_unit in ('KM', 'HRS')),
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
  meter_reading numeric,
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

alter table public.fleet_units add column if not exists current_meter numeric;
alter table public.fleet_units add column if not exists last_pm_meter numeric;
alter table public.fleet_units add column if not exists pm_interval numeric not null default 25000;
alter table public.fleet_units add column if not exists meter_unit text not null default 'KM';
alter table public.work_orders add column if not exists meter_reading numeric;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_work_order_meter()
returns trigger language plpgsql as $$
declare
  unit_interval numeric;
  unit_last_pm numeric;
begin
  if new.meter_reading is not null and (tg_op = 'INSERT' or old.meter_reading is distinct from new.meter_reading or old.status is distinct from new.status) then
    select pm_interval, coalesce(last_pm_meter, current_meter, new.meter_reading)
      into unit_interval, unit_last_pm
      from public.fleet_units where unit = new.unit for update;
    update public.fleet_units
      set current_meter = new.meter_reading,
          overdue = (new.meter_reading - coalesce(unit_last_pm, new.meter_reading)) >= coalesce(unit_interval, 25000),
          updated_at = now()
      where unit = new.unit;
    if new.status = 'Completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      update public.fleet_units set last_pm_meter = new.meter_reading, overdue = false, updated_at = now() where unit = new.unit;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists fleet_units_touch_updated_at on public.fleet_units;
create trigger fleet_units_touch_updated_at before update on public.fleet_units for each row execute function public.touch_updated_at();
drop trigger if exists work_orders_touch_updated_at on public.work_orders;
create trigger work_orders_touch_updated_at before update on public.work_orders for each row execute function public.touch_updated_at();
drop trigger if exists user_accounts_touch_updated_at on public.user_accounts;
create trigger user_accounts_touch_updated_at before update on public.user_accounts for each row execute function public.touch_updated_at();
drop trigger if exists work_orders_sync_meter on public.work_orders;
create trigger work_orders_sync_meter after insert or update of meter_reading, status on public.work_orders for each row execute function public.sync_work_order_meter();

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
