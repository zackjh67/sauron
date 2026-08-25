-- A registered "project" doesn't necessarily deploy to Vercel — e.g. a repo
-- that's purely Supabase Edge Functions/migrations, reporting to its own
-- Sentry project, with no Vercel deployment at all. vercel_project_id (and
-- the log-drain plumbing it points at) is now optional per project.
alter table projects alter column vercel_project_id drop not null;
