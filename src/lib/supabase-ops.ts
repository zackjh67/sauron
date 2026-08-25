import { createClient } from "@supabase/supabase-js";

// Client for the dedicated ops Supabase project (registry, investigations,
// ingested vercel logs) — never one of the product projects being monitored.
export function opsClient() {
  const url = process.env.SUPABASE_OPS_URL;
  const key = process.env.SUPABASE_OPS_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_OPS_URL / SUPABASE_OPS_SERVICE_ROLE_KEY not set");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface ProjectRow {
  id: string;
  name: string;
  sentry_project_slug: string;
  github_repo: string;
  github_repo_subdir: string | null;
  vercel_project_id: string | null;
  vercel_team_id: string | null;
  vercel_token_ref: string;
  supabase_project_ref: string;
  supabase_management_token_ref: string;
  slack_channel: string | null;
  enabled: boolean;
}

export type InvestigationStatus = "queued" | "running" | "done" | "failed" | "discarded";

export interface InvestigationRow {
  id: string;
  sentry_event_id: string;
  project_id: string;
  sentry_error: unknown;
  status: InvestigationStatus;
  run_trigger: "auto" | "manual" | null;
  report: unknown;
  pr_url: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AppSettingsRow {
  id: 1;
  paused: boolean;
  updated_at: string;
}
