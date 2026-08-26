import type { ProjectRow } from "./supabase-ops";
import { querySupabaseLogs, type SupabaseLogQuery } from "./supabase-logs";
import { queryVercelLogs } from "./vercel-logs";

const SUPABASE_SOURCES: SupabaseLogQuery["source"][] = [
  "postgres_logs",
  "edge_logs",
  "function_edge_logs",
  "auth_logs",
];

// Deliberately simple substring match, not a real log parser — this is meant
// to be a cheap first-pass net, not a precise classifier. False positives
// just mean a queued item you can discard after a glance; false negatives
// are the real risk, so keep this list broad rather than clever.
const KEYWORDS = ["error", "exception", "fatal", "panic", "uncaught"];

export interface LogSweepMatch {
  source: SupabaseLogQuery["source"] | "vercel_logs";
  timestamp: string;
  eventMessage: string;
}

function matchesKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Supabase's Management API wraps log rows as { result: [...], error }
 * (confirmed against https://supabase.com/docs/reference/api/v1-get-project-logs-all).
 * Defensive here because this is Node code that has to actually parse the
 * shape, not just forward it to Claude the way the investigation tool does.
 */
function extractSupabaseRows(json: unknown): Array<{ timestamp?: unknown; event_message?: unknown }> {
  const result = (json as { result?: unknown } | null)?.result;
  return Array.isArray(result) ? (result as Array<{ timestamp?: unknown; event_message?: unknown }>) : [];
}

/**
 * One query per source per project (never per keyword) — fetches the full
 * window, then keyword-matches client-side. Each source is isolated in its
 * own try/catch so one project's stale credential, or one Supabase source
 * being briefly unavailable, doesn't blank out the rest of the sweep.
 */
export async function sweepProjectLogs(project: ProjectRow, fromIso: string, toIso: string): Promise<LogSweepMatch[]> {
  const matches: LogSweepMatch[] = [];

  await Promise.all(
    SUPABASE_SOURCES.map(async (source) => {
      try {
        const json = await querySupabaseLogs({
          projectRef: project.supabase_project_ref,
          managementTokenRef: project.supabase_management_token_ref,
          source,
          fromIso,
          toIso,
          limit: 500,
        });
        for (const row of extractSupabaseRows(json)) {
          const eventMessage = String(row.event_message ?? "");
          if (matchesKeyword(eventMessage)) {
            matches.push({ source, timestamp: String(row.timestamp ?? ""), eventMessage });
          }
        }
      } catch (err) {
        console.error(`log sweep: ${source} query failed for project ${project.name}`, err);
      }
    }),
  );

  if (project.vercel_project_id) {
    try {
      const rows = await queryVercelLogs({
        vercelProjectId: project.vercel_project_id,
        fromIso,
        toIso,
        level: "error",
        limit: 500,
      });
      for (const row of rows ?? []) {
        matches.push({ source: "vercel_logs", timestamp: row.ts, eventMessage: row.message ?? "(no message)" });
      }
    } catch (err) {
      console.error(`log sweep: vercel_logs query failed for project ${project.name}`, err);
    }
  }

  return matches;
}
