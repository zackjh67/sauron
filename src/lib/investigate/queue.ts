import { opsClient, type AppSettingsRow, type InvestigationRow, type ProjectRow } from "../supabase-ops";
import type { ParsedSentryError } from "../sentry";
import { runInvestigation } from "./orchestrate";

export async function isPaused(): Promise<boolean> {
  const db = opsClient();
  const { data, error } = await db.from("app_settings").select("paused").eq("id", 1).single<AppSettingsRow>();
  if (error) throw new Error(`failed to read app_settings: ${error.message}`);
  return data.paused;
}

export async function setPaused(paused: boolean): Promise<void> {
  const db = opsClient();
  const { error } = await db
    .from("app_settings")
    .update({ paused, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(`failed to update app_settings: ${error.message}`);
}

export interface ClaimedInvestigation {
  id: string;
  project: ProjectRow;
  error: ParsedSentryError;
}

/**
 * Atomically claims one queued investigation (queued -> running). The
 * conditional `.eq("status", "queued")` on the update is what makes this
 * safe under concurrent callers (cron + a dashboard click racing) — only
 * one caller's update actually matches a row, everyone else gets null back.
 */
async function claim(investigationId: string, trigger: "auto" | "manual"): Promise<ClaimedInvestigation | null> {
  const db = opsClient();

  const { data: claimed, error: claimError } = await db
    .from("investigations")
    .update({ status: "running", run_trigger: trigger, started_at: new Date().toISOString() })
    .eq("id", investigationId)
    .eq("status", "queued")
    .select("id, project_id, sentry_error")
    .maybeSingle<Pick<InvestigationRow, "id" | "project_id" | "sentry_error">>();

  if (claimError) throw new Error(`failed to claim investigation ${investigationId}: ${claimError.message}`);
  if (!claimed) return null;

  const { data: project, error: projectError } = await db
    .from("projects")
    .select("*")
    .eq("id", claimed.project_id)
    .single<ProjectRow>();
  if (projectError || !project) throw new Error(`project ${claimed.project_id} not found`);

  return { id: claimed.id, project, error: claimed.sentry_error as ParsedSentryError };
}

/** For the dashboard's "run now" — caller decides whether to check `isPaused()` first, and how to run it (foreground/background). */
export async function claimQueuedInvestigation(investigationId: string): Promise<ClaimedInvestigation | null> {
  return claim(investigationId, "manual");
}

/** Called by the daily cron: picks the most recently queued item across enabled projects (not FIFO — a fresh error outranks ones that have been sitting around), runs it to completion. Returns the id run, or null if the queue was empty. */
export async function runNextAutoInvestigation(): Promise<string | null> {
  const db = opsClient();

  const { data: next, error } = await db
    .from("investigations")
    .select("id, projects!inner(enabled)")
    .eq("status", "queued")
    .eq("projects.enabled", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`failed to look up next queued investigation: ${error.message}`);
  if (!next) return null;

  const claimed = await claim(next.id, "auto");
  if (!claimed) return null; // lost a race with something else claiming it

  await runInvestigation(claimed.project, claimed.error, claimed.id);
  return claimed.id;
}

export async function discardInvestigation(investigationId: string): Promise<boolean> {
  const db = opsClient();
  const { data, error } = await db
    .from("investigations")
    .update({ status: "discarded", completed_at: new Date().toISOString() })
    .eq("id", investigationId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`failed to discard investigation ${investigationId}: ${error.message}`);
  return data !== null;
}
