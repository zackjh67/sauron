import { isPaused, runNextAutoInvestigation } from "@/lib/investigate/queue";

// Investigations involve several rounds of tool calls (GitHub + logs + a
// reasoning model) — the default route timeout is nowhere near enough.
// Requires a Vercel plan whose function duration limit covers this.
export const maxDuration = 300;

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is
// set — this is Vercel's documented way to keep a cron route from being
// callable by anyone who finds the URL.
function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

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
