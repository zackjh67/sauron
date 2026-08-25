import { after } from "next/server";
import { claimQueuedInvestigation, cloneAsQueued, isPaused } from "@/lib/investigate/queue";
import { runInvestigation } from "@/lib/investigate/orchestrate";
import { parseModel, parseEffort } from "@/lib/investigate/model-options";

export const maxDuration = 300;

/**
 * Re-runs a previously completed/failed/discarded investigation. Clones it
 * into a fresh queued row rather than resetting the original in place, so
 * the original's report/PR/error history isn't overwritten.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (await isPaused()) {
    return new Response("paused — resume from the dashboard before running jobs", { status: 423 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const options = { model: parseModel(body.model), effort: parseEffort(body.effort) };

  const newId = await cloneAsQueued(id);
  if (!newId) {
    return new Response("original investigation not found", { status: 404 });
  }

  const claimed = await claimQueuedInvestigation(newId, options);
  if (!claimed) {
    // Shouldn't happen — nothing else could have claimed a row we just created.
    return new Response("internal error: clone was not queued", { status: 500 });
  }

  after(async () => {
    try {
      await runInvestigation(claimed.project, claimed.error, claimed.id, options);
    } catch (err) {
      console.error(`investigation ${claimed.id} failed`, err);
    }
  });

  return new Response(JSON.stringify({ id: newId }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
}
