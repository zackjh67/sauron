import { discardInvestigation } from "@/lib/investigate/queue";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const discarded = await discardInvestigation(id);
  if (!discarded) {
    return new Response("not currently queued (already run or discarded)", { status: 409 });
  }
  return new Response("discarded", { status: 200 });
}
