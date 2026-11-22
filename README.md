# RPM Diesel Fleet Dashboard

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor. It creates `fleet_units`, `work_orders`, and `activity_logs`, enables row-level security policies, and adds all three tables to `supabase_realtime`.
3. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (sb_publishable_…) and the server-only `SUPABASE_SECRET_KEY` (sb_secret_…) from Project Settings > API Keys. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` names still work as a fallback.
4. Start the app with `npm run dev`.

When Supabase is configured, the dashboard hydrates fleet data from the cloud, upserts every unit/work-order change, records activity logs, and subscribes to realtime changes from other users or devices. The login screen remains the existing RPM Diesel account gate; Supabase credentials should be configured before deploying.
