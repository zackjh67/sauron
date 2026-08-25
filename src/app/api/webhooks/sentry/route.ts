import {
  verifySentrySignature,
  SIGNATURE_HEADER,
  parseSentryErrorPayload,
  isActionableSentryPayload,
} from "@/lib/sentry";
import { opsClient, type ProjectRow } from "@/lib/supabase-ops";

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!verifySentrySignature(rawBody, req.headers.get(SIGNATURE_HEADER))) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  // The "Issue" webhook resource fires on resolved/ignored/assigned too, not
  // just new issues — only "created" should ever start an investigation.
  if (!isActionableSentryPayload(payload)) {
    return new Response("ok", { status: 200 });
  }

  const error = parseSentryErrorPayload(payload);

  if (!error.projectSlug) {
    console.error("Sentry webhook: could not determine project slug", payload);
    return new Response("ok", { status: 200 });
  }

  const db = opsClient();
  const { data: project, error: lookupError } = await db
    .from("projects")
    .select("*")
    .eq("sentry_project_slug", error.projectSlug)
    .eq("enabled", true)
    .maybeSingle<ProjectRow>();

  if (lookupError) {
    console.error("projects lookup failed", lookupError);
    return new Response("ok", { status: 200 });
  }
  if (!project) {
    console.warn(`No enabled project registered for sentry_project_slug="${error.projectSlug}"`);
    return new Response("ok", { status: 200 });
  }

  // Just enqueue — nothing runs from here. The daily cron picks the oldest
  // queued item automatically; anything else runs from the dashboard.
  const { error: insertError } = await db
    .from("investigations")
    .insert({
      sentry_event_id: error.eventId,
      project_id: project.id,
      sentry_error: error,
      status: "queued",
    });

  if (insertError) {
    console.error("failed to insert investigation row", insertError);
  }

  return new Response("ok", { status: 200 });
}
