export async function getSentryIssueEvents(issueId: string, limit = 20) {
  const token = process.env.SENTRY_API_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG;
  if (!token || !org) throw new Error("SENTRY_API_TOKEN / SENTRY_ORG_SLUG not set");

  const url = `https://sentry.io/api/0/organizations/${org}/issues/${issueId}/events/?limit=${limit}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Sentry API failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
