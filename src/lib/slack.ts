export async function postSlackReport(input: {
  projectName: string;
  summary: string;
  rootCause: string;
  confidence: string;
  prUrl: string | null;
  investigationId: string;
}): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("SLACK_WEBHOOK_URL not set");

  const lines = [
    `*[${input.projectName}]* investigation finished (confidence: ${input.confidence})`,
    `*Summary:* ${input.summary}`,
    `*Root cause:* ${input.rootCause}`,
    input.prUrl ? `<${input.prUrl}|Review draft PR>` : `_No confident fix produced — see investigation ${input.investigationId}_`,
  ];

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}
