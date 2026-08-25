import { opsClient, type AppSettingsRow, type InvestigationRow, type ProjectRow } from "../supabase-ops";
import type { ParsedSentryError } from "../sentry";
import { runInvestigation } from "./orchestrate";
import type { InvestigateOptions } from "./run";
import { DEFAULT_MODEL, DEFAULT_EFFORT } from "./model-options";

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
 * Atomically claims one queued investigation (queued -> running), recording
 * which model/effort it's about to run with. The conditional
 * `.eq("status", "queued")` on the update is what makes this safe under
 * concurrent callers (cron + a dashboard click racing) — only one caller's
 * update actually matches a row, everyone else gets null back.
 */
async function claim(
  investigationId: string,
  trigger: "auto" | "manual",
  options: InvestigateOptions = {},
): Promise<ClaimedInvestigation | null> {
  const db = opsClient();
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;

  const { data: claimed, error: claimError } = await db
    .from("investigations")
    .update({ status: "running", run_trigger: trigger, model, effort, started_at: new Date().toISOString() })
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

/** For the dashboard's "run now"/"re-run" — caller decides whether to check `isPaused()` first, and how to run it (foreground/background). */
export async function claimQueuedInvestigation(
  investigationId: string,
  options: InvestigateOptions = {},
): Promise<ClaimedInvestigation | null> {
  return claim(investigationId, "manual", options);
}

/** Called by the daily cron: picks the most recently queued item across enabled projects (not FIFO — a fresh error outranks ones that have been sitting around), runs it to completion with the default model/effort. Returns the id run, or null if the queue was empty. */
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

/**
 * Re-run support: rather than resetting the original row (which would erase
 * its report/PR history), clone it into a fresh queued row with the same
 * project + Sentry error, leaving the original untouched. Caller then claims
 * the returned id like any other queued item.
 */
export async function cloneAsQueued(sourceId: string): Promise<string | null> {
  const db = opsClient();

  const { data: source, error } = await db
    .from("investigations")
    .select("project_id, sentry_event_id, sentry_error")
    .eq("id", sourceId)
    .maybeSingle<Pick<InvestigationRow, "project_id" | "sentry_event_id" | "sentry_error">>();
  if (error) throw new Error(`failed to load investigation ${sourceId}: ${error.message}`);
  if (!source) return null;

  const { data: inserted, error: insertError } = await db
    .from("investigations")
    .insert({
      project_id: source.project_id,
      sentry_event_id: source.sentry_event_id,
      sentry_error: source.sentry_error,
      status: "queued",
    })
    .select("id")
    .single<{ id: string }>();
  if (insertError || !inserted) {
    throw new Error(`failed to clone investigation ${sourceId}: ${insertError?.message}`);
  }
  return inserted.id;
}
