import { timingSafeEqual } from "node:crypto";
import { opsClient } from "@/lib/supabase-ops";

// Vercel's self-serve custom Log Drains don't sign deliveries — there's no
// built-in secret/HMAC mechanism. What the UI does offer is Custom Headers,
// so the shared secret travels as one of those instead: add a header named
// x-log-drain-secret with this value when configuring the drain.
const SECRET_HEADER = "x-log-drain-secret";

function isAuthorizedDrainRequest(req: Request): boolean {
  const secret = process.env.LOG_DRAIN_SECRET;
  if (!secret) throw new Error("LOG_DRAIN_SECRET not set");

  const provided = req.headers.get(SECRET_HEADER);
  if (!provided) return false;

  const secretBuf = Buffer.from(secret, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (secretBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(secretBuf, providedBuf);
}

interface VercelLogEntry {
  timestamp?: number;
  level?: string;
  message?: string;
  requestId?: string;
  projectId?: string;
  [key: string]: unknown;
}

export async function POST(req: Request) {
  if (!isAuthorizedDrainRequest(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const entries = (await req.json()) as VercelLogEntry[];
  if (!Array.isArray(entries) || entries.length === 0) {
    return new Response("ok", { status: 200 });
  }

  const rows = entries
    .filter((e) => e.projectId)
    .map((e) => ({
      vercel_project_id: e.projectId as string,
      ts: new Date(e.timestamp ?? Date.now()).toISOString(),
      level: e.level ?? null,
      message: e.message ?? null,
      request_id: e.requestId ?? null,
      payload: e,
    }));

  if (rows.length > 0) {
    const db = opsClient();
    const { error } = await db.from("vercel_logs").insert(rows);
    if (error) {
      console.error("failed to insert vercel_logs rows", error);
      return new Response("insert failed", { status: 500 });
    }
  }

  return new Response("ok", { status: 200 });
}
