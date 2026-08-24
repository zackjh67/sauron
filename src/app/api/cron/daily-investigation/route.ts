import { isPaused, runNextAutoInvestigation } from "@/lib/investigate/queue";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

// Investigations involve several rounds of tool calls (GitHub + logs + a
// reasoning model) — the default route timeout is nowhere near enough.
// Requires a Vercel plan whose function duration limit covers this.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  if (await isPaused()) {
    return new Response("paused, skipping", { status: 200 });
  }

  const ranId = await runNextAutoInvestigation();
  return new Response(ranId ? `ran ${ranId}` : "queue empty", { status: 200 });
}
