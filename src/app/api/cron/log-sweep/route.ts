import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { opsClient, type ProjectRow } from "@/lib/supabase-ops";
import { sweepProjectLogs } from "@/lib/log-sweep";
import { postLogSweepAlert } from "@/lib/slack";
import type { ParsedSentryError } from "@/lib/sentry";

// Several projects x up to 5 log queries each (4 Supabase sources + Vercel).
export const maxDuration = 300;

/**
 * Twice-daily sweep of raw Supabase + Vercel logs, independent of Sentry or
 * any app code explicitly reporting anything — catches platform-level
 * failures (e.g. a Supabase Auth/SMTP misconfiguration) that never produce
 * an exception in code Sentry instruments. A clean sweep costs nothing: no
 * Slack post, no DB write. A dirty one just queues a normal investigations
 * row — this never spends Claude tokens on its own, a human decides whether
 * to "Run now" on what it found.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const db = opsClient();
  const { data: projects, error } = await db.from("projects").select("*").eq("enabled", true).returns<ProjectRow[]>();
  if (error) {
    console.error("log sweep: projects lookup failed", error);
    return new Response("internal error", { status: 500 });
  }

  const toIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(); // > 12h cron interval, covers drift

  let queuedCount = 0;

  for (const project of projects ?? []) {
    const matches = await sweepProjectLogs(project, fromIso, toIso);
    if (matches.length === 0) continue;

    const sampleLines = matches
      .slice(0, 5)
      .map((m) => `[${m.source}] ${m.timestamp} ${m.eventMessage}`)
      .join("\n");
    const message = `Log sweep found ${matches.length} error-like log line(s):\n${sampleLines}`.slice(0, 2000);

    const parsedError: ParsedSentryError = {
      eventId: `log-sweep-${project.id}-${Date.now()}`,
      projectSlug: project.sentry_project_slug,
      message,
      culprit: "log sweep — Supabase/Vercel logs",
      frames: [],
      raw: { matches },
    };

    const { error: insertError } = await db.from("investigations").insert({
      sentry_event_id: parsedError.eventId,
      project_id: project.id,
      sentry_error: parsedError,
      status: "queued",
    });

    if (insertError) {
      console.error(`log sweep: failed to insert investigation for ${project.name}`, insertError);
      continue;
    }
    queuedCount++;
  }

  if (queuedCount === 0) {
    return new Response("clean sweep", { status: 200 });
  }

  const appUrl = process.env.APP_URL;
  try {
    await postLogSweepAlert({
      count: queuedCount,
      dashboardUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/` : undefined,
    });
  } catch (err) {
    console.error("log sweep: failed to post Slack alert", err);
  }

  return new Response(`queued ${queuedCount}`, { status: 200 });
}
