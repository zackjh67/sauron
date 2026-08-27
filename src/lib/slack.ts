import type { ExpiringCredential } from "./credential-expirations";

async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("SLACK_WEBHOOK_URL not set");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}

export async function postSlackReport(input: {
  projectName: string;
  summary: string;
  rootCause: string;
  confidence: string;
  prUrl: string | null;
  investigationId: string;
}): Promise<void> {
  const lines = [
    `*[${input.projectName}]* investigation finished (confidence: ${input.confidence})`,
    `*Summary:* ${input.summary}`,
    `*Root cause:* ${input.rootCause}`,
    input.prUrl ? `<${input.prUrl}|Review draft PR>` : `_No confident fix produced — see investigation ${input.investigationId}_`,
  ];
  await postToSlack(lines.join("\n"));
}

export async function postInvestigationFailure(input: {
  projectName: string;
  investigationId: string;
  errorMessage: string;
}): Promise<void> {
  const looksLikeAuthFailure = /\b401\b|unauthorized|invalid.{0,20}token|expired/i.test(input.errorMessage);

  const lines = [
    `:warning: *[${input.projectName}]* investigation failed`,
    looksLikeAuthFailure
      ? "_Looks like an authentication/credential problem — check whether a token needs renewing._"
      : undefined,
    `*Error:* ${input.errorMessage}`,
    `Investigation: ${input.investigationId}`,
  ].filter((line): line is string => line !== undefined);

  await postToSlack(lines.join("\n"));
}

export async function postNewErrorAlert(input: {
  projectName: string;
  message: string;
  exceptionType?: string;
  culprit?: string;
  dashboardUrl?: string;
}): Promise<void> {
  const title = input.exceptionType ? `${input.exceptionType}: ${input.message}` : input.message;
  const lines = [
    `:rotating_light: *[${input.projectName}]* new error`,
    `*${title}*`,
    input.culprit ? `_${input.culprit}_` : undefined,
    input.dashboardUrl ? `<${input.dashboardUrl}|View in dashboard>` : undefined,
  ].filter((line): line is string => line !== undefined);

  await postToSlack(lines.join("\n"));
}

export async function postLogSweepAlert(input: { count: number; dashboardUrl?: string }): Promise<void> {
  const lines = [
    `:mag: *Log sweep*: ${input.count} project(s) had error-like log entries — queued for manual review, won't run automatically`,
    input.dashboardUrl ? `<${input.dashboardUrl}|View in dashboard>` : undefined,
  ].filter((line): line is string => line !== undefined);
  await postToSlack(lines.join("\n"));
}

export async function postCredentialExpiryAlert(items: ExpiringCredential[]): Promise<void> {
  const lines = [
    ":hourglass_flowing_sand: *Credential expiry check*",
    ...items.map((c) => {
      const date = new Date(c.expiresAt).toLocaleDateString();
      return c.daysLeft < 0
        ? `:x: *${c.name}* expired ${Math.abs(c.daysLeft)} day(s) ago (${date})`
        : `:warning: *${c.name}* expires in ${c.daysLeft} day(s) (${date})`;
    }),
  ];
  await postToSlack(lines.join("\n"));
}
