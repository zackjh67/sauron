import { createHmac, timingSafeEqual } from "node:crypto";
import { opsClient } from "@/lib/supabase-ops";

/**
 * Vercel Log Drains sign delivery with HMAC-SHA1 over the raw body via the
 * `x-vercel-signature` header, using the drain's configured secret. Verify
 * this against Vercel's current Log Drains docs when you actually configure
 * the drain — this wasn't checked against a live payload while building.
 */
function verifyVercelSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.VERCEL_LOG_DRAIN_SECRET;
  if (!secret) throw new Error("VERCEL_LOG_DRAIN_SECRET not set");
  if (!signatureHeader) return false;

  const expected = createHmac("sha1", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const gotBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectedBuf, gotBuf);
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
  const rawBody = await req.text();

  if (!verifyVercelSignature(rawBody, req.headers.get("x-vercel-signature"))) {
    return new Response("invalid signature", { status: 401 });
  }

  const entries = JSON.parse(rawBody) as VercelLogEntry[];
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
