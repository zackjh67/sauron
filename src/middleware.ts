import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// These already verify themselves (Sentry HMAC signature, Vercel Log Drain
// signature, Vercel's CRON_SECRET bearer token) — Basic Auth would just be
// a second, incompatible gate on requests that aren't a browser.
const SELF_AUTHENTICATED_PATHS = [
  "/api/webhooks/sentry",
  "/api/ingest/vercel-logs",
  "/api/ingest/errors",
  "/api/cron/",
];

export function middleware(req: NextRequest) {
  if (SELF_AUTHENTICATED_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const user = process.env.DASHBOARD_USERNAME ?? "admin";
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) {
    // Fail closed: an internal ops dashboard with PR-creation buttons and
    // full error/log detail should never be reachable with zero config.
    return new NextResponse("DASHBOARD_PASSWORD not set", { status: 500 });
  }

  const expected = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  if (req.headers.get("authorization") !== expected) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Sauron"' },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
