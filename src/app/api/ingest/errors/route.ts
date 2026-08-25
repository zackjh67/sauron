import { z } from "zod";
import { isAuthorizedIngestRequest } from "@/lib/ingest-auth";
import { opsClient, type ProjectRow } from "@/lib/supabase-ops";
import { postNewErrorAlert } from "@/lib/slack";
import type { ParsedSentryError } from "@/lib/sentry";

const FrameSchema = z.object({
  filename: z.string().optional(),
  function: z.string().optional(),
  lineno: z.number().optional(),
  in_app: z.boolean().optional(),
});

const IngestErrorSchema = z.object({
  eventId: z.string().min(1),
  projectSlug: z.string().min(1),
  message: z.string().min(1),
  exceptionType: z.string().optional(),
  culprit: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  frames: z.array(FrameSchema).default([]),
});

/**
 * Non-Sentry error intake: apps using the `sauron-errors` npm library, or a
 * Supabase function/trigger via pg_net, POST here directly. Feeds the exact
 * same `investigations` queue/dashboard/investigate pipeline the Sentry
 * webhook does — this is just a second way in.
 */
export async function POST(req: Request) {
  if (!isAuthorizedIngestRequest(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = IngestErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(`invalid payload: ${parsed.error.message}`, { status: 400 });
  }
  const input = parsed.data;

  const db = opsClient();
  const { data: project, error: lookupError } = await db
    .from("projects")
    .select("*")
    .eq("sentry_project_slug", input.projectSlug)
    .eq("enabled", true)
    .maybeSingle<ProjectRow>();

  if (lookupError) {
    console.error("projects lookup failed", lookupError);
    return new Response("internal error", { status: 500 });
  }
  if (!project) {
    console.warn(`No enabled project registered for slug="${input.projectSlug}"`);
    return new Response("unknown project", { status: 404 });
  }

  const parsedError: ParsedSentryError = {
    eventId: input.eventId,
    projectSlug: input.projectSlug,
    message: input.message,
    exceptionType: input.exceptionType,
    culprit: input.culprit,
    environment: input.environment,
    release: input.release,
    frames: input.frames,
    raw: input,
  };

  const { data: inserted, error: insertError } = await db
    .from("investigations")
    .insert({
      sentry_event_id: input.eventId,
      project_id: project.id,
      sentry_error: parsedError,
      status: "queued",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !inserted) {
    console.error("failed to insert investigation row", insertError);
    return new Response("internal error", { status: 500 });
  }

  const appUrl = process.env.APP_URL;
  try {
    await postNewErrorAlert({
      projectName: project.name,
      message: input.message,
      exceptionType: input.exceptionType,
      culprit: input.culprit,
      dashboardUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/errors/${inserted.id}` : undefined,
    });
  } catch (err) {
    // Never fail the ingest because Slack is down — the error is already stored.
    console.error("failed to post new-error Slack alert", err);
  }

  return new Response(JSON.stringify({ id: inserted.id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
