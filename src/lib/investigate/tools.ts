import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ProjectRow } from "../supabase-ops";
import { readFile, listDir } from "../github";
import { queryVercelLogs } from "../vercel-logs";
import { querySupabaseLogs } from "../supabase-logs";
import { getSentryIssueEvents } from "../sentry-api";

export const ReportSchema = z.object({
  summary: z.string().describe("One paragraph: what happened, in plain terms"),
  root_cause: z.string().describe("The specific code/config reason this error occurred"),
  confidence: z.enum(["low", "medium", "high"]),
  risk_notes: z.string().describe("What could go wrong with the proposed fix, or why there isn't one"),
  proposed_fix: z
    .object({
      file: z.string().describe("Repo-relative path of the file to change"),
      new_content: z.string().describe("Complete new contents of the file after the fix"),
    })
    .nullable()
    .describe("Null if no confident fix could be produced — investigation still gets reported"),
});

export type Report = z.infer<typeof ReportSchema>;

/** Builds the tool set for one investigation, scoped to one project + a place to capture the final report. */
export function buildInvestigationTools(project: ProjectRow, onReport: (report: Report) => void) {
  const readGithubFile = betaZodTool({
    name: "read_github_file",
    description: "Read a file's contents from the project's GitHub repo at a given ref (commit sha, branch, or tag).",
    inputSchema: z.object({
      path: z.string().describe("Repo-relative file path"),
      ref: z.string().describe("Commit sha, branch, or tag"),
    }),
    run: async (input) => readFile(project.github_repo, input.path, input.ref),
  });

  const listGithubDir = betaZodTool({
    name: "list_github_dir",
    description: "List files/directories at a path in the project's GitHub repo at a given ref.",
    inputSchema: z.object({
      path: z.string().describe("Repo-relative directory path, use \"\" for repo root"),
      ref: z.string().describe("Commit sha, branch, or tag"),
    }),
    run: async (input) => JSON.stringify(await listDir(project.github_repo, input.path, input.ref)),
  });

  const queryVercelLogsTool = betaZodTool({
    name: "query_vercel_logs",
    description:
      "Query this project's Vercel function logs (ingested via log drain) in a time window, optionally filtered by substring.",
    inputSchema: z.object({
      from_iso: z.string().describe("ISO 8601 start timestamp"),
      to_iso: z.string().describe("ISO 8601 end timestamp"),
      text_filter: z.string().optional().describe("Substring to match against the log message"),
    }),
    run: async (input) =>
      JSON.stringify(
        await queryVercelLogs({
          vercelProjectId: project.vercel_project_id,
          fromIso: input.from_iso,
          toIso: input.to_iso,
          textFilter: input.text_filter,
        }),
      ),
  });

  const querySupabaseLogsTool = betaZodTool({
    name: "query_supabase_logs",
    description:
      "Query this project's Supabase logs (Postgres, Edge Functions, or Auth) in a time window, optionally filtered by substring.",
    inputSchema: z.object({
      source: z.enum(["postgres_logs", "edge_logs", "function_edge_logs", "auth_logs"]),
      from_iso: z.string().describe("ISO 8601 start timestamp"),
      to_iso: z.string().describe("ISO 8601 end timestamp"),
      text_filter: z.string().optional().describe("Substring to match against the log event message"),
    }),
    run: async (input) =>
      JSON.stringify(
        await querySupabaseLogs({
          projectRef: project.supabase_project_ref,
          managementTokenRef: project.supabase_management_token_ref,
          source: input.source,
          fromIso: input.from_iso,
          toIso: input.to_iso,
          textFilter: input.text_filter,
        }),
      ),
  });

  const getSentryIssueEventsTool = betaZodTool({
    name: "get_sentry_issue_events",
    description: "Pull more sample events for this Sentry issue, to see frequency and whether the stack trace/context varies.",
    inputSchema: z.object({
      issue_id: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: async (input) => JSON.stringify(await getSentryIssueEvents(input.issue_id, input.limit)),
  });

  const submitReport = betaZodTool({
    name: "submit_report",
    description:
      "Call this exactly once, as the last step, once you have enough information to explain what happened and either propose a fix or explain why you can't.",
    inputSchema: ReportSchema,
    run: async (input) => {
      onReport(input);
      return "Report received.";
    },
  });

  return [
    readGithubFile,
    listGithubDir,
    queryVercelLogsTool,
    querySupabaseLogsTool,
    getSentryIssueEventsTool,
    submitReport,
  ];
}
