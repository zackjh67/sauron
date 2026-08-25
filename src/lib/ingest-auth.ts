import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret bearer auth for /api/ingest/errors — this app's apps are
 * all your own, so a single static secret (like CRON_SECRET) is enough;
 * no per-project HMAC signing needed.
 */
export function isAuthorizedIngestRequest(req: Request): boolean {
  const secret = process.env.ERROR_INGEST_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const got = header.slice("Bearer ".length);

  const expectedBuf = Buffer.from(secret, "utf8");
  const gotBuf = Buffer.from(got, "utf8");
  if (expectedBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectedBuf, gotBuf);
}
