import { getDefaultBranch, openDraftFixPr } from "../github";
import type { ProjectRow } from "../supabase-ops";
import type { ParsedSentryError } from "../sentry";
import type { Report } from "./tools";

/** Opens a draft PR for a report's proposed_fix. Returns null if there's no fix to apply. */
export async function openPrForReport(
  project: ProjectRow,
  error: ParsedSentryError,
  report: Report,
): Promise<string | null> {
  if (!report.proposed_fix) return null;

  const baseBranch = await getDefaultBranch(project.github_repo);
  const shortEventId = error.eventId.slice(0, 12) || Date.now().toString(36);

  const body = [
    `Auto-generated from Sentry event [\`${error.eventId}\`](${error.issueUrl ?? ""}).`,
    "",
    `**Summary:** ${report.summary}`,
    "",
    `**Root cause:** ${report.root_cause}`,
    "",
    `**Confidence:** ${report.confidence}`,
    "",
    `**Risk notes:** ${report.risk_notes}`,
    "",
    "_Review carefully before merging — this diff was proposed by an automated investigation, not written by a person._",
  ].join("\n");

  return openDraftFixPr({
    ownerRepo: project.github_repo,
    baseBranch,
    headBranch: `fix/sentry-${shortEventId}`,
    filePath: report.proposed_fix.file,
    newContent: report.proposed_fix.new_content,
    title: `Fix: ${report.summary.slice(0, 72)}`,
    body,
  });
}
