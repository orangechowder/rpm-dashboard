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
  status text not null default 'In Progress' check (status in ('Scheduled', 'In Progress', 'Waiting on Parts', 'Waiting on Estimates', 'Ready for Invoicing', 'Completed')),
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
  entity_type text not null check (entity_type in ('unit', 'work_order', 'time_entry')),
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
  break_minutes numeric not null default 0,
  break_started_at timestamptz,
  lost_time_minutes numeric not null default 0,
  lost_time_reason text,
  created_at timestamptz not null default now()
);

alter table public.fleet_units add column if not exists current_meter numeric;
alter table public.fleet_units add column if not exists last_pm_meter numeric;
alter table public.fleet_units add column if not exists pm_interval numeric not null default 25000;
alter table public.fleet_units add column if not exists meter_unit text not null default 'KM';
alter table public.work_orders add column if not exists meter_reading numeric;

-- Time-tracking: unpaid meal breaks and categorized lost time, plus the hourly rate used to compute pay.
alter table public.time_entries add column if not exists break_minutes numeric not null default 0;
alter table public.time_entries add column if not exists break_started_at timestamptz;
alter table public.time_entries add column if not exists lost_time_minutes numeric not null default 0;
alter table public.time_entries add column if not exists lost_time_reason text;
alter table public.user_accounts add column if not exists hourly_rate numeric;

-- Itemized payroll view: time_entries.user_id actually stores the technician's display name
-- (see app/page.tsx, where activeUser/account.name is passed as userId), so join on name, not id.
create or replace view public.timesheet_entries as
select
  te.id,
  te.user_id,
  te.user_name,
  te.work_order_id,
  te.clock_in,
  te.clock_out,
  te.total_hours,
  coalesce(te.break_minutes, 0) as break_minutes,
  coalesce(te.lost_time_minutes, 0) as lost_time_minutes,
  te.lost_time_reason,
  te.status,
  greatest(coalesce(te.total_hours, 0) - coalesce(te.break_minutes, 0) / 60.0, 0) as net_payable_hours,
  greatest(coalesce(te.total_hours, 0) - coalesce(te.break_minutes, 0) / 60.0 - coalesce(te.lost_time_minutes, 0) / 60.0, 0) as billable_hours,
  ua.hourly_rate,
  greatest(coalesce(te.total_hours, 0) - coalesce(te.break_minutes, 0) / 60.0, 0) * coalesce(ua.hourly_rate, 0) as gross_pay
from public.time_entries te
left join public.user_accounts ua on ua.name = te.user_id;

create or replace view public.daily_timesheet_summary as
select
  te.user_id,
  te.user_name,
  te.clock_in::date as work_date,
  min(te.clock_in) as day_start,
  max(coalesce(te.clock_out, te.clock_in)) as day_end,
  bool_or(te.status = 'active') as has_open_entry,
  coalesce(sum(te.total_hours), 0) as raw_hours,
  coalesce(sum(te.break_minutes), 0) as break_minutes,
  coalesce(sum(te.lost_time_minutes), 0) as lost_time_minutes,
  greatest(coalesce(sum(te.total_hours), 0) - coalesce(sum(te.break_minutes), 0) / 60.0, 0) as net_payable_hours,
  greatest(coalesce(sum(te.total_hours), 0) - coalesce(sum(te.break_minutes), 0) / 60.0 - coalesce(sum(te.lost_time_minutes), 0) / 60.0, 0) as billable_hours,
  max(ua.hourly_rate) as hourly_rate
from public.time_entries te
left join public.user_accounts ua on ua.name = te.user_id
group by te.user_id, te.user_name, te.clock_in::date
order by te.clock_in::date desc;

create or replace view public.weekly_timesheet_summary as
select
  te.user_id,
  te.user_name,
  date_trunc('week', te.clock_in::date)::date as week_start,
  (date_trunc('week', te.clock_in::date)::date + interval '6 days')::date as week_end,
  sum(greatest(coalesce(te.total_hours, 0) - coalesce(te.break_minutes, 0) / 60.0, 0)) as weekly_net_hours,
  sum(greatest(coalesce(te.total_hours, 0) - coalesce(te.break_minutes, 0) / 60.0 - coalesce(te.lost_time_minutes, 0) / 60.0, 0)) as weekly_billable_hours,
  max(ua.hourly_rate) as hourly_rate,
  sum(greatest(coalesce(te.total_hours, 0) - coalesce(te.break_minutes, 0) / 60.0, 0) * coalesce(ua.hourly_rate, 0)) as weekly_gross_pay
from public.time_entries te
left join public.user_accounts ua on ua.name = te.user_id
group by te.user_id, te.user_name, date_trunc('week', te.clock_in::date)::date
order by week_start desc;

create table if not exists public.payroll_period_locks (
  period_start date not null,
  period_end date not null,
  locked_by text not null,
  locked_at timestamptz not null default now(),
  primary key (period_start, period_end)
);

-- Unit numbers are only unique per client (the same "1" can exist for two different clients).
-- Drop the old FK that assumed `unit` alone was unique; it's no longer a valid reference target.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.work_orders'::regclass
      and conname = 'work_orders_unit_fkey'
  ) then
    alter table public.work_orders drop constraint work_orders_unit_fkey;
  end if;
end;
$$;

-- Give fleet_units a surrogate primary key so (unit, client) can become a composite unique constraint instead.
alter table public.fleet_units add column if not exists id uuid not null default gen_random_uuid();

do $$
declare
  old_pk text;
begin
  select conname into old_pk from pg_constraint where conrelid = 'public.fleet_units'::regclass and contype = 'p';
  if old_pk is not null and old_pk <> 'fleet_units_pkey_id' then
    execute format('alter table public.fleet_units drop constraint %I', old_pk);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.fleet_units'::regclass and contype = 'p') then
    alter table public.fleet_units add constraint fleet_units_pkey_id primary key (id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fleet_units'::regclass
      and conname = 'fleet_units_unit_client_key'
  ) then
    alter table public.fleet_units add constraint fleet_units_unit_client_key unique (unit, client);
  end if;
end;
$$;

-- Work orders keep a plain (unmanaged) unit/client snapshot; referential integrity against fleet_units
-- is enforced in the application layer (see deleteUnit's linked-work-order check in app/page.tsx),
-- since a composite FK would otherwise cascade-rewrite historical job.client snapshots on unit edits.

-- Widen the status check constraint to add "Scheduled" and "Ready for Invoicing" for existing installs.
do $$
declare
  status_check text;
begin
  select conname into status_check
    from pg_constraint
    where conrelid = 'public.work_orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%';
  if status_check is not null then
    execute format('alter table public.work_orders drop constraint %I', status_check);
  end if;
  alter table public.work_orders
    add constraint work_orders_status_check
    check (status in ('Scheduled', 'In Progress', 'Waiting on Parts', 'Waiting on Estimates', 'Ready for Invoicing', 'Completed'));
end;
$$;

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

alter table public.activity_logs drop constraint if exists activity_logs_entity_type_check;
alter table public.activity_logs add constraint activity_logs_entity_type_check
  check (entity_type in ('unit', 'work_order', 'time_entry', 'payroll_period'));

alter table public.payroll_period_locks enable row level security;
drop policy if exists "dashboard users can read payroll locks" on public.payroll_period_locks;
create policy "dashboard users can read payroll locks" on public.payroll_period_locks
  for select to anon, authenticated using (true);
drop policy if exists "dashboard users can write payroll locks" on public.payroll_period_locks;
create policy "dashboard users can write payroll locks" on public.payroll_period_locks
  for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
