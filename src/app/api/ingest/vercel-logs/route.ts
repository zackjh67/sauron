import { createHmac, timingSafeEqual } from "node:crypto";
import { opsClient } from "@/lib/supabase-ops";

/**
 * Vercel signs every Drain delivery with an `x-vercel-signature` header:
 * hex(HMAC-SHA1(raw body, drain's Signature Verification Secret)). Confirmed
 * against https://vercel.com/docs/drains/security — set LOG_DRAIN_SECRET to
 * the exact "Signature Verification Secret" value shown when creating the
 * drain (or paste your own chosen value into that field instead).
 */
function verifyVercelSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.LOG_DRAIN_SECRET;
  if (!secret) throw new Error("LOG_DRAIN_SECRET not set");
  if (!signatureHeader) return false;

  const expected = createHmac("sha1", secret).update(Buffer.from(rawBody, "utf-8")).digest("hex");
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
