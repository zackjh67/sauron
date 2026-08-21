# Sauron

The all-seeing eye for your Sentry errors: catches an issue, reads the code, digs through
logs, and hands you a draft fix instead of a stack trace.

Sauron receives verified Sentry error webhooks across all your projects, has Claude
investigate autonomously (source on GitHub, function logs on Vercel, database/edge/auth logs
on Supabase), and reports back with a root cause and — when it's confident — a draft GitHub
PR. Nothing merges itself; you review everything.

## How it works

```
Sentry (error) --webhook (HMAC signed)--> /api/webhooks/sentry
                                                 |
                                   look up the project in the registry, insert
                                   an investigation row with status "queued"
                                                 |
                                                 v
                                          [ the queue ]
                                                 |
              +----------------------------------+----------------------------------+
              |                                                                      |
   daily cron, once/day (unless paused):                          dashboard, any time:
   picks the newest queued item                                   "Run now" or "Discard"
   across all enabled projects                                    on any queued item
              |                                                                      |
              +----------------------------------+----------------------------------+
                                                 |
                              Claude (Opus 5, agentic tool use), investigates:
                                - read_github_file / list_github_dir
                                - query_vercel_logs / query_supabase_logs
                                - get_sentry_issue_events
                                                 |
                        structured report: summary, root cause, confidence,
                        risk notes, proposed fix (if confident enough)
                        -------------------------------------------
                        |                                          |
                        v                                          v
                open draft PR on GitHub                    post report to Slack
```

Claude decides what to look at — it isn't handed a fixed bundle of context. It reads stack
frames, pulls the actual source at the commit that was running, and queries both log sources
in a window around the event before deciding what happened.

Every incoming error lands in the queue rather than running immediately: a cron job runs it
down to one automatic investigation per day, and the dashboard (`/`, Basic Auth protected)
lets you run or discard anything else in the queue on your own schedule. A single pause
toggle on that dashboard stops both the cron and any "Run now" clicks — the queue keeps
filling while paused, nothing just gets silently investigated in the background.

## Why it exists

Manually triaging a Sentry alert usually means three tabs: GitHub for the code, Vercel for
function logs, Supabase for database/auth logs. Sauron does that legwork automatically and
leaves you a PR to review instead of a cold start every time.

## Project layout

```
src/
  middleware.ts                        Basic Auth in front of the dashboard + investigation/settings APIs
  app/
    page.tsx, dashboard-actions.tsx    the queue dashboard (run/discard/pause)
    api/webhooks/sentry/route.ts       Sentry webhook receiver -> enqueues
    api/ingest/vercel-logs/route.ts    Vercel Log Drain receiver
    api/cron/daily-investigation/      once/day queue pop (Vercel Cron, CRON_SECRET-gated)
    api/investigations/[id]/run/       dashboard "run now"
    api/investigations/[id]/discard/   dashboard "discard"
    api/settings/pause/                dashboard pause/resume toggle
  lib/
    sentry.ts, sentry-api.ts           webhook verification + Sentry API
    github.ts                          GitHub App auth, file reads, draft PRs
    vercel-logs.ts, supabase-logs.ts   log query helpers
    slack.ts                          report notifications
    secrets.ts                         per-account credential resolution
    investigate/
      queue.ts                        claim/run/discard queue items, pause flag
      tools.ts                        the tools Claude gets during investigation
      run.ts                          the agentic Tool Runner loop
      pr.ts                           turns a report into a draft PR
      orchestrate.ts                  wires investigate -> PR -> Slack -> DB
supabase/migrations/0001_init.sql      registry + investigation queue + settings + ingested logs schema
```

## Multiple accounts and orgs

Projects can live under different Vercel accounts and different Supabase orgs (GitHub is
assumed to be one account/org for everything). Nothing is hardcoded to a single account: each
row in the `projects` table names *which* env var holds the right token
(`vercel_token_ref`, `supabase_management_token_ref`, default `..._DEFAULT`). Onboarding a
project under a new account means adding a new env var (e.g. `VERCEL_TOKEN_CLIENTX`) and
pointing that project's row at it — no code change.

## One-time manual setup

These happen in dashboards, not in this repo:

| # | What | Where it lands |
|---|------|-----------------|
| 1 | Create a **dedicated ops Supabase project** (not one of the products it monitors), run `supabase/migrations/0001_init.sql` against it | `SUPABASE_OPS_URL`, `SUPABASE_OPS_SERVICE_ROLE_KEY` |
| 2 | Seed the `projects` table — one row per product app (Sentry slug, GitHub repo, Vercel project id, Supabase project ref, token refs) | — |
| 3 | Register a **GitHub App** (Contents: read, Pull requests: write, Metadata: read), install it on every repo in the registry | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` |
| 4 | Create one **Sentry internal integration** (org-wide), webhook → `/api/webhooks/sentry`, "Issue" resource enabled; also grab an API token | `SENTRY_WEBHOOK_SECRET`, `SENTRY_API_TOKEN`, `SENTRY_ORG_SLUG` |
| 5 | Add a **Vercel Log Drain** per product project → `/api/ingest/vercel-logs` (needs a plan that supports Log Drains) | `VERCEL_LOG_DRAIN_SECRET` |
| 6 | Add a **Slack incoming webhook** for the channel reports post to | `SLACK_WEBHOOK_URL` |
| 7 | Anthropic API key | `ANTHROPIC_API_KEY` |
| 8 | Pick a dashboard password. `vercel.json` already schedules the daily cron (08:00 UTC — edit the cron expression to taste) | `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `CRON_SECRET` |

Copy `.env.example` to `.env.local` for local dev; set the same vars on the Vercel project
this app deploys to.

## The dashboard

`/` (Basic Auth protected — see step 8 above) shows the queue and lets you act on it:

- **Queue** — everything waiting to be investigated, newest first, with the error
  message/exception type/culprit shown per row and a `▶` marking whichever one the daily
  cron would pick right now. Rows that share the same project + exception type + message
  get an "×N similar" badge so repeat errors are obvious instead of scrolling through
  near-identical rows. **Run now** kicks one off in the background; **Discard** drops it
  without ever investigating it.
- **Pause / Resume** — one button. While paused, the daily cron no-ops and "Run now" is
  refused (423). Sentry errors still queue up as normal; they just don't get investigated
  until you resume.
- **Recent** — the last 20 completed/failed/discarded investigations, with a link to the
  draft PR when one was opened.

## Local dev

```
npm install
npm run dev
```

`npm run typecheck` / `npm run build` to check without running the server.

## Known limitations

- **Proposed fix is a full replacement file, not a diff.** `submit_report`'s `proposed_fix`
  is `{ file, new_content }` — Claude returns the complete new contents of one file, committed
  directly. A full-file replacement is more robust than trying to apply an LLM-authored patch,
  but it means one file per fix for now; a report that needs multi-file changes still gets
  filed (report + Slack post), just without a PR.
- **Sentry webhook and Vercel Log Drain payload shapes are written from documented formats,
  not verified against a live payload yet.** Log the raw body on the first real event and
  confirm field paths (`src/lib/sentry.ts`, `src/app/api/ingest/vercel-logs/route.ts`) before
  trusting them fully.
- **`vercel_logs` grows unbounded** from the drain. The migration has a commented-out prune
  query — schedule it (pg_cron, or an external cron hitting a small maintenance route) once
  the drain is live.
- **Pause blocks all runs, not just the automatic one.** A paused dashboard refuses "Run now"
  too (423), not only the daily cron — treated as one global stop rather than two separate
  switches. If you'd rather pause only the automatic side and keep manual runs available,
  that's a small change in `src/app/api/investigations/[id]/run/route.ts` (drop the
  `isPaused()` check there).
- **The cron does exactly one item per day**, newest queued first (a fresh error beats ones
  that have been sitting around), no other priority/project weighting. Reordering the queue
  isn't supported beyond that — discard-and-let-it-reappear-via-Sentry
  is the only way to "skip" one for now.
- **Dashboard auth is HTTP Basic, not a real login.** Fine for a small team hitting it
  directly; if you want SSO/audit logs instead, Vercel's built-in Deployment Protection is
  the lower-effort upgrade over building auth into the app.
