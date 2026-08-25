import Anthropic from "@anthropic-ai/sdk";
import type { ParsedSentryError } from "../sentry";
import type { ProjectRow } from "../supabase-ops";
import { buildInvestigationTools, type Report } from "./tools";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are investigating a production error reported by Sentry, for a codebase
hosted on GitHub. Depending on the project, it may run as Next.js functions on Vercel, as
Supabase (Postgres/Edge Functions/Auth), or both — the tools you've been given for this
investigation reflect what's actually relevant to this specific project, so don't assume a
piece of infrastructure exists just because it would for a typical project; only reason about
what you can actually see.

You have tools to read the actual source at the commit that was running, and to query whichever
log sources apply here, around the time of the error. Use them as needed — start from the stack
trace, read the relevant files, and pull logs in a window around the event timestamp to see what
request/state led here. Don't guess at code you haven't read.

When you have enough to explain what happened, call submit_report exactly once. If you can't
identify a safe, well-scoped fix, still submit a report — set proposed_fix to null and explain
why in risk_notes rather than proposing something you're not confident in. Keep any proposed fix
minimal and scoped to the actual bug; don't refactor unrelated code.`;

export async function investigate(project: ProjectRow, error: ParsedSentryError): Promise<Report> {
  let capturedReport: Report | null = null;
  const tools = buildInvestigationTools(project, (r) => {
    capturedReport = r;
  });

  const userPrompt = [
    `Sentry event: ${error.eventId}`,
    ...(error.issueId ? [`Sentry issue ID: ${error.issueId}`] : []),
    `Project: ${project.name} (repo ${project.github_repo})`,
    ...(project.github_repo_subdir
      ? [
          `This project's code lives under "${project.github_repo_subdir}/" within that repo — ` +
            `other paths may exist for unrelated apps sharing the same monorepo, don't assume they're relevant.`,
        ]
      : []),
    `Environment: ${error.environment ?? "unknown"}`,
    `Release / commit: ${error.release ?? "unknown"}`,
    `Exception type: ${error.exceptionType ?? "unknown"}`,
    `Message: ${error.message}`,
    `Culprit: ${error.culprit ?? "unknown"}`,
    `Sentry issue URL: ${error.issueUrl ?? "n/a"}`,
    "",
    error.frames.length > 0
      ? "Stack frames (most relevant last, per Sentry convention):\n" + JSON.stringify(error.frames, null, 2)
      : "No stack trace came with this webhook (this project's Sentry plan only delivers issue-level " +
          "fields, not full events, over the webhook). Your first step should be calling " +
          "get_sentry_issue_events with the Sentry issue ID above to pull a real event — that's where " +
          "the actual exception, stack trace, and release/environment for this issue live.",
  ].join("\n");

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const message of runner) {
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  if (!capturedReport) {
    throw new Error("Investigation ended without calling submit_report");
  }
  return capturedReport;
}
