import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { findExpiringCredentials } from "@/lib/credential-expirations";
import { postCredentialExpiryAlert } from "@/lib/slack";

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const expiring = await findExpiringCredentials(14);
  if (expiring.length === 0) {
    return new Response("nothing expiring", { status: 200 });
  }

  await postCredentialExpiryAlert(expiring);
  return new Response(`alerted on ${expiring.length}`, { status: 200 });
}
