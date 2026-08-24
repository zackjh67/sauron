-- Manually-recorded expiry dates for credentials that don't expose their own
-- remaining lifetime via API (e.g. Supabase personal access tokens). The
-- daily /api/cron/check-credentials job reads this and posts a Slack alert
-- as each one approaches (or passes) its expiry.
create table if not exists credential_expirations (
  name text primary key,
  expires_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table credential_expirations enable row level security;

-- Example — run this yourself with the real date shown on the token when
-- you created it (Supabase Dashboard -> Account -> Access Tokens):
-- insert into credential_expirations (name, expires_at, notes) values
--   ('SUPABASE_MANAGEMENT_TOKEN_DEFAULT', '2027-08-24T00:00:00Z', 'Supabase personal access token');
