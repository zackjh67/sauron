import { after } from "next/server";
import { claimQueuedInvestigation, isPaused } from "@/lib/investigate/queue";
import { runInvestigation } from "@/lib/investigate/orchestrate";

// The after() callback below still counts toward this function's execution
// time on Vercel, even though the HTTP response returns early.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (await isPaused()) {
    return new Response("paused — resume from the dashboard before running jobs", { status: 423 });
  }

  const claimed = await claimQueuedInvestigation(id);
  if (!claimed) {
    return new Response("not currently queued (already run or discarded)", { status: 409 });
  }

  // Respond immediately so the dashboard button doesn't hang for however
  // long the investigation takes; it finishes in the background and the
  // dashboard picks up the new status on its next refresh.
  after(async () => {
    try {
      await runInvestigation(claimed.project, claimed.error, claimed.id);
    } catch (err) {
      console.error(`investigation ${claimed.id} failed`, err);
    }
  });

  return new Response("started", { status: 202 });
}
