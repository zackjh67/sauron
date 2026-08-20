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

create table if not exists investigations (
  id uuid primary key default gen_random_uuid(),
  sentry_event_id text not null,
  project_id uuid not null references projects (id),
  status text not null default 'running'
    check (status in ('running', 'done', 'failed')),
  report jsonb,
  pr_url text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists investigations_project_id_idx
  on investigations (project_id);
create index if not exists investigations_status_idx
  on investigations (status);

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
