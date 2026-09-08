-- Read-only diagnostics for work orders that reference missing fleet units.
-- Run this in Supabase SQL Editor before making any relink or restore change.

-- 1. List every orphaned work-order link, including status and client context.
select
  wo.id as work_order_id,
  wo.unit as missing_unit_id,
  wo.client,
  wo.status,
  wo.issue,
  wo.updated,
  wo.updated_at
from public.work_orders wo
left join public.fleet_units fu on fu.unit = wo.unit
where fu.unit is null
order by wo.updated_at desc nulls last;

-- 2. Summarize orphaned links by unit and show whether any are still open.
select
  wo.unit as missing_unit_id,
  count(*) as work_order_count,
  count(*) filter (where wo.status <> 'Completed') as open_work_order_count,
  array_agg(wo.id order by wo.updated_at desc nulls last) as work_order_ids
from public.work_orders wo
left join public.fleet_units fu on fu.unit = wo.unit
where fu.unit is null
group by wo.unit
order by open_work_order_count desc, wo.unit;

-- 3. Find candidate fleet units for a manual relink by VIN/client.
-- Replace the values before running.
select unit, vin, client, type, service, current_meter, meter_unit
from public.fleet_units
where vin = '<VIN>' or client = '<CLIENT>';

-- 4. Safe relink template. Review the diagnostic output and candidate first.
-- This changes only the work-order foreign-key value and is intentionally commented out.
-- begin;
-- update public.work_orders
-- set unit = '<RESTORED_OR_CORRECT_UNIT_ID>', updated_at = now()
-- where id = '<WORK_ORDER_ID>'
--   and unit = '<MISSING_UNIT_ID>';
-- commit;

-- 5. If the unit was deleted accidentally and its original identity is known,
-- restore it first with a complete trusted record, then rerun the relink only if needed.
-- Do not invent VIN, client, or meter values in production.
