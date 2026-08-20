import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER = "sentry-hook-signature";

export function verifySentrySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.SENTRY_WEBHOOK_SECRET;
  if (!secret) throw new Error("SENTRY_WEBHOOK_SECRET not set");
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const gotBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectedBuf, gotBuf);
}

export { SIGNATURE_HEADER };

export interface SentryStackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  in_app?: boolean;
}

export interface ParsedSentryError {
  eventId: string;
  projectSlug: string;
  message: string;
  exceptionType?: string;
  culprit?: string;
  environment?: string;
  release?: string;
  frames: SentryStackFrame[];
  issueUrl?: string;
  raw: unknown;
}

/**
 * Sentry's "error" resource webhook payload shape. Field paths here follow
 * Sentry's documented internal-integration format as of writing — confirm
 * against a real captured payload during build-order step 2 (log `raw` on
 * the first test event) before relying on any single field.
 */
export function parseSentryErrorPayload(body: unknown): ParsedSentryError {
  const b = body as Record<string, unknown>;
  const data = (b.data ?? {}) as Record<string, unknown>;
  const error = (data.error ?? data.event ?? {}) as Record<string, unknown>;
  const exceptionValues =
    ((error.exception as Record<string, unknown> | undefined)?.values as
      | Array<Record<string, unknown>>
      | undefined) ?? [];
  const firstException = exceptionValues[0] ?? {};
  const frames =
    ((firstException.stacktrace as Record<string, unknown> | undefined)?.frames as
      | SentryStackFrame[]
      | undefined) ?? [];
  const project = (error.project as Record<string, unknown> | undefined) ?? {};

  return {
    eventId: String(error.event_id ?? error.id ?? ""),
    projectSlug: String(project.slug ?? error.project_slug ?? ""),
    message: String(error.message ?? firstException.value ?? "unknown error"),
    exceptionType: firstException.type as string | undefined,
    culprit: error.culprit as string | undefined,
    environment: error.environment as string | undefined,
    release: error.release as string | undefined,
    frames,
    issueUrl: error.web_url as string | undefined,
    raw: body,
  };
}
