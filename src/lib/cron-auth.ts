// Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is
// set — this is Vercel's documented way to keep a cron route from being
// callable by anyone who finds the URL.
export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
