-- Ops project schema. Run against the dedicated ops Supabase project
-- (not any product project) via `supabase db push` or the SQL editor.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sentry_project_slug text not null unique,
  github_repo text not null,          -- "owner/name" (single GitHub org/account)
  github_repo_subdir text,            -- nullable, for monorepos

  vercel_project_id text not null,
  vercel_team_id text,                -- nullable: only needed if the project lives under a Vercel team scope
  vercel_token_ref text not null default 'VERCEL_TOKEN_DEFAULT',
    -- name of the env var holding the Vercel API token that can see this project.
    -- Projects may span multiple Vercel accounts, so this is a *reference*,
    -- not the token itself. Add more env vars (VERCEL_TOKEN_<ACCOUNT>) as needed.

  supabase_project_ref text not null,
  supabase_management_token_ref text not null default 'SUPABASE_MANAGEMENT_TOKEN_DEFAULT',
    -- same idea: Supabase projects may span multiple orgs/accounts, so each
    -- project row points at which management token can query its logs.

  slack_channel text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per Sentry error, doubling as the investigation queue: a webhook
-- delivery inserts it as 'queued'; it moves to 'running' either via the
-- daily cron (run_trigger='auto') or a dashboard click (run_trigger='manual'),
-- then to 'done'/'failed'. 'discarded' means someone cleared it from the
-- queue without running it.
create table if not exists investigations (
  id uuid primary key default gen_random_uuid(),
  sentry_event_id text not null,
  project_id uuid not null references projects (id),
  sentry_error jsonb not null,
    -- the full parsed Sentry error (see ParsedSentryError) captured at
    -- webhook time, so a queued item can be run later without Sentry
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'discarded')),
  run_trigger text
    check (run_trigger in ('auto', 'manual')),
  report jsonb,
  pr_url text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists investigations_project_id_idx
  on investigations (project_id);
create index if not exists investigations_status_idx
  on investigations (status);
-- Queue pop order: oldest queued item first.
create index if not exists investigations_queued_order_idx
  on investigations (created_at) where status = 'queued';

-- Singleton row — global on/off switch. Checking `id = 1` on every insert is
-- what keeps this to exactly one row.
create table if not exists app_settings (
  id int primary key default 1 check (id = 1),
  paused boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into app_settings (id, paused) values (1, false)
  on conflict (id) do nothing;

-- Populated by the Vercel Log Drain via /api/ingest/vercel-logs.
create table if not exists vercel_logs (
  id bigint generated always as identity primary key,
  vercel_project_id text not null,
  ts timestamptz not null,
  level text,
  message text,
  request_id text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists vercel_logs_project_ts_idx
  on vercel_logs (vercel_project_id, ts desc);
create index if not exists vercel_logs_request_id_idx
  on vercel_logs (request_id);

-- Log drain ingestion is high-volume; prune anything older than the window
-- the investigator actually needs. Run this on a schedule (pg_cron or an
-- external cron hitting a small /api/maintenance/prune-logs route).
-- delete from vercel_logs where ts < now() - interval '14 days';
