import { opsClient, type ProjectRow } from "../supabase-ops";
import type { ParsedSentryError } from "../sentry";
import { investigate } from "./run";
import { openPrForReport } from "./pr";
import { postSlackReport, postInvestigationFailure } from "../slack";

/**
 * Runs one full investigation: agentic Claude loop -> draft PR (if a fix was
 * proposed) -> Slack notification -> investigation row updated throughout so
 * a crash mid-flight leaves a visible "running"/"failed" row, not silence.
 */
export async function runInvestigation(project: ProjectRow, error: ParsedSentryError, investigationId: string) {
  const db = opsClient();

  try {
    const report = await investigate(project, error);
    const prUrl = await openPrForReport(project, error, report);

    await db
      .from("investigations")
      .update({ status: "done", report, pr_url: prUrl, completed_at: new Date().toISOString() })
      .eq("id", investigationId);

    await postSlackReport({
      projectName: project.name,
      summary: report.summary,
      rootCause: report.root_cause,
      confidence: report.confidence,
      prUrl,
      investigationId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("investigations")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", investigationId);

    // Best-effort — a broken Slack webhook shouldn't hide the original failure.
    try {
      await postInvestigationFailure({ projectName: project.name, investigationId, errorMessage: message });
    } catch (slackErr) {
      console.error(`failed to post failure alert for investigation ${investigationId}`, slackErr);
    }

    throw err;
  }
}
