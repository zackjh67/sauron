import { after } from "next/server";
import { verifySentrySignature, SIGNATURE_HEADER, parseSentryErrorPayload } from "@/lib/sentry";
import { opsClient, type ProjectRow } from "@/lib/supabase-ops";
import { runInvestigation } from "@/lib/investigate/orchestrate";

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!verifySentrySignature(rawBody, req.headers.get(SIGNATURE_HEADER))) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
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

  const { data: investigation, error: insertError } = await db
    .from("investigations")
    .insert({ sentry_event_id: error.eventId, project_id: project.id, status: "running" })
    .select("id")
    .single();

  if (insertError || !investigation) {
    console.error("failed to insert investigation row", insertError);
    return new Response("ok", { status: 200 });
  }

  // Respond to Sentry immediately; keep working after the response so Sentry
  // doesn't time out and retry the webhook mid-investigation.
  after(async () => {
    try {
      await runInvestigation(project, error, investigation.id);
    } catch (err) {
      console.error(`investigation ${investigation.id} failed`, err);
    }
  });

  return new Response("ok", { status: 200 });
}
