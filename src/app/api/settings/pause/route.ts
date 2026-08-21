import { setPaused } from "@/lib/investigate/queue";

export async function POST(req: Request) {
  const body = (await req.json()) as { paused?: boolean };
  if (typeof body.paused !== "boolean") {
    return new Response('body must be {"paused": boolean}', { status: 400 });
  }
  await setPaused(body.paused);
  return new Response("ok", { status: 200 });
}
