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
  /** Set when this came from the "Issue" webhook resource — pass to get_sentry_issue_events to pull a real event. */
  issueId?: string;
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
 * Only react to a genuinely new issue/event, not lifecycle noise (resolved,
 * ignored, assigned, etc — the "Issue" resource fires webhooks for those too).
 */
export function isActionableSentryPayload(body: unknown): boolean {
  const action = (body as Record<string, unknown> | null)?.action;
  return action === undefined || action === "created";
}

/**
 * Handles both Sentry webhook resources:
 * - "Issue" (data.issue) — available on Team plan and above. Issue-level
 *   fields only: title/culprit/metadata, no stack trace or per-event
 *   environment/release. Pair with the get_sentry_issue_events tool to pull
 *   an actual event during investigation.
 * - "Error" (data.error) — per-event with full exception/stacktrace, but
 *   gated behind a higher plan than Team as of writing.
 * Confirmed against https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/
 * for the Issue shape; the Error shape was not re-verified against a live payload.
 */
export function parseSentryErrorPayload(body: unknown): ParsedSentryError {
  const b = body as Record<string, unknown>;
  const data = (b.data ?? {}) as Record<string, unknown>;

  if (data.issue) {
    const issue = data.issue as Record<string, unknown>;
    const metadata = (issue.metadata as Record<string, unknown> | undefined) ?? {};
    const project = (issue.project as Record<string, unknown> | undefined) ?? {};
    const issueId = String(issue.id ?? "");

    return {
      eventId: issueId,
      issueId,
      projectSlug: String(project.slug ?? ""),
      message: String(metadata.value ?? issue.title ?? "unknown error"),
      exceptionType: metadata.type as string | undefined,
      culprit: issue.culprit as string | undefined,
      frames: [],
      issueUrl: (issue.permalink ?? issue.web_url) as string | undefined,
      raw: body,
    };
  }

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
