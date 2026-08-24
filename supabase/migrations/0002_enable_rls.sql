-- Every table in `public` is exposed via Supabase's Data API by default, and
-- Supabase grants the anon/authenticated roles table-level access unless RLS
-- says otherwise. This app only ever talks to Postgres via the service_role
-- key (see opsClient()), which bypasses RLS entirely — so enabling RLS with
-- zero policies is a pure lockdown of the anon/authenticated path, with no
-- effect on the app itself.

alter table projects enable row level security;
alter table investigations enable row level security;
alter table vercel_logs enable row level security;
alter table app_settings enable row level security;
