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
                              Claude (Sonnet 5/medium effort by default, agentic tool use), investigates:
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

Slack gets pinged on three occasions: an investigation finishes (with its report), an
investigation fails (with the error — flagged as a likely credential problem when it looks
like one), or a tracked credential is approaching/past its expiry date.

## Errors without Sentry

Sentry isn't the only way in. `/api/ingest/errors` accepts errors directly
from the [`sauron-errors`](../error-reporter) npm library (Node/browser apps)
or from a Supabase Postgres function/trigger via `pg_net` — see that
package's README for both. Either way, the error lands in the exact same
`investigations` queue as a Sentry webhook would, gets the same immediate
Slack ping, and is eligible for the same daily-cron/dashboard investigation.
This is meant to let you drop Sentry's subscription entirely once every
project has switched over; the Sentry webhook path stays as-is in the
meantime, so both can feed the queue side by side.

## Log sweep — catches what nothing ever reports

Sentry (and `sauron-errors`) can only surface what your own code explicitly reports. A
failure entirely inside a platform's managed internals — the incident that prompted this:
Supabase Auth's SMTP sending broke, silently, with no exception anywhere in app code — never
reaches either path, because nothing ever told them about it.

`/api/cron/log-sweep` runs twice a day (06:00/18:00 UTC) and doesn't wait to be told. For
every enabled project it pulls the last ~13 hours of raw Supabase logs (`postgres_logs`,
`edge_logs`, `function_edge_logs`, `auth_logs`) and this project's own ingested Vercel logs
(`level = 'error'`), then keyword-matches (`error`/`exception`/`fatal`/`panic`/`uncaught`)
client-side — one query per source per project, not per keyword. A clean sweep costs nothing:
no Slack post, no database write. Anything matched gets queued into the exact same
`investigations` table as a Sentry webhook or `sauron-errors` call would (`src/lib/log-sweep.ts`
+ `src/app/api/cron/log-sweep/route.ts`) — same dashboard, same pause/discard/"Run now" with
its model/effort picker. **The sweep never spends Claude tokens itself** — it only queues;
running the investigation is still your call.

Deliberately dumb on purpose: no NLP, no LLM call, just a substring match over whatever the
Supabase Management API and your own `vercel_logs` table return, so it stays close to free
to run regardless of how many projects or how much log volume you have. Expect some false
positives (discard them) — the risk being guarded against is a false *negative*, i.e. missing
a real platform-level failure entirely, which is what happened before this existed.

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
    errors/                            browse *all* captured errors (any status), full stack detail
    projects/                          registry GUI (list/add/edit/enable/disable/delete)
    api/webhooks/sentry/route.ts       Sentry webhook receiver -> enqueues
    api/ingest/errors/route.ts         non-Sentry error intake (sauron-errors lib, pg_net) -> enqueues
    api/ingest/vercel-logs/route.ts    Vercel Log Drain receiver
    api/cron/daily-investigation/      once/day queue pop (Vercel Cron, CRON_SECRET-gated)
    api/cron/check-credentials/        once/day expiry check -> Slack (same gating)
    api/cron/log-sweep/                twice/day raw Supabase+Vercel log scan -> queue (same gating)
    api/investigations/[id]/run/       dashboard "run now" (accepts {model, effort})
    api/investigations/[id]/rerun/     dashboard "re-run" — clones then runs (accepts {model, effort})
    api/investigations/[id]/discard/   dashboard "discard"
    api/settings/pause/                dashboard pause/resume toggle
  lib/
    sentry.ts, sentry-api.ts           webhook verification + Sentry API
    ingest-auth.ts                     shared ERROR_INGEST_SECRET bearer check
    error-signature.ts                 project+type+message grouping, shared by both dashboards
    github.ts                          GitHub App auth, file reads, draft PRs
    vercel-logs.ts, supabase-logs.ts   log query helpers
    slack.ts                          report/failure/credential-expiry/new-error notifications
    secrets.ts                         per-account credential resolution
    credential-expirations.ts          reads credential_expirations, flags what's due
    cron-auth.ts                       shared CRON_SECRET check across cron routes
    log-sweep.ts                       raw Supabase/Vercel log scan, keyword-filtered client-side
    investigate/
      queue.ts                        claim/run/discard/clone queue items, pause flag
      model-options.ts                 selectable models/effort levels + defaults (Sonnet 5/medium)
      tools.ts                        the tools Claude gets during investigation
      run.ts                          the agentic Tool Runner loop
      pr.ts                           turns a report into a draft PR
      orchestrate.ts                  wires investigate -> PR -> Slack -> DB
supabase/migrations/                   registry + investigation queue + settings + ingested logs schema, RLS lockdown
```

## Multiple accounts and orgs

Projects can live under different Vercel accounts and different Supabase orgs (GitHub is
assumed to be one account/org for everything). Nothing is hardcoded to a single account: each
row in the `projects` table names *which* env var holds the right token
(`vercel_token_ref`, `supabase_management_token_ref`, default `..._DEFAULT`). Onboarding a
project under a new account means adding a new env var (e.g. `VC_TOKEN_CLIENTX` — not
`VERCEL_TOKEN_CLIENTX`; Vercel rejects custom env vars starting with `VERCEL_`) and
pointing that project's row at it — no code change.

## One codebase, multiple repos

`projects` is keyed by `sentry_project_slug`, not by "the app" as a whole — if your frontend
and your Supabase code live in separate repos and report to **separate Sentry projects**,
that's already two rows in `/projects` (see below), each pointing at its own `github_repo`.
They can even share the same `supabase_project_ref` if it's genuinely one backend.

If a repo has no Vercel deployment at all (e.g. a repo that's purely Supabase migrations/Edge
Functions), leave **Vercel project id** blank on that row — the investigation simply won't be
offered the `query_vercel_logs` tool for that project, rather than erroring on an id that
doesn't exist.

The one case this *doesn't* handle: a single Sentry project whose errors could originate from
either repo. There's no way to tell which repo to read from with that setup — you'd want
either separate Sentry projects (recommended, and probably how you already have it if your
frontend and backend are meaningfully separate deploys), or a code change to let one project
row reference multiple repos.

## One-time manual setup

These happen in dashboards, not in this repo:

| # | What | Where it lands |
|---|------|-----------------|
| 1 | Create a **dedicated ops Supabase project** (not one of the products it monitors), run every file in `supabase/migrations/` against it, in order, via the SQL editor | `SUPABASE_OPS_URL`, `SUPABASE_OPS_SERVICE_ROLE_KEY` |
| 2 | Add a project in the `/projects` GUI (once deployed) — one row per product app (Sentry slug, GitHub repo, Vercel project id, Supabase project ref, token refs) | — |
| 3 | Register a **GitHub App** (Contents: read, Pull requests: write, Metadata: read), install it on every repo in the registry | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` |
| 4 | Create one **Sentry internal integration** (org-wide), webhook → `/api/webhooks/sentry`, "Issue" resource enabled (see below for why, and for both tokens it produces) | `SENTRY_WEBHOOK_SECRET`, `SENTRY_API_TOKEN`, `SENTRY_ORG_SLUG` |
| 5 | Add a **Vercel Log Drain** per product project — endpoint URL must be the full path, `https://<your-app>/api/ingest/vercel-logs`, not just the domain — and copy its "Signature Verification Secret" into the env var (needs a plan that supports Drains) | `LOG_DRAIN_SECRET` |
| 6 | Add a **Slack incoming webhook** for the channel reports post to | `SLACK_WEBHOOK_URL` |
| 7 | Anthropic API key | `ANTHROPIC_API_KEY` |
| 8 | Pick a dashboard password. `vercel.json` already schedules all three crons (06:00/18:00/08:00/09:00 UTC — edit the expressions to taste). Needs Vercel Pro or above: Log Drains already required that, and 3 crons exceeds Hobby's 2-per-project cap anyway | `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `CRON_SECRET` |
| 9 | For any credential with a known expiry (e.g. the Supabase management token, ~1 year) insert a row so you get a Slack warning as it approaches — see below | — |
| 10 | *(Optional, only if you're moving off Sentry)* Generate a random string for the error-intake secret, then install [`sauron-errors`](../error-reporter) in each product app (or add the `pg_net` snippet from its README to a product Supabase project) pointed at this same value | `ERROR_INGEST_SECRET` |

Copy `.env.example` to `.env.local` for local dev; set the same vars on the Vercel project
this app deploys to.

### Setting up the Sentry integration

One **internal integration** (org-wide, not a per-project one) so it can cover every project
in your Sentry org:

1. Sentry → **Settings → Developer Settings → New Internal Integration**.
2. Under **Permissions**, set **Issue & Event** to **Read**. This is what lets the integration's
   token (step 5) call the API to fetch a real event later.
3. Under **Webhooks**, check **Issue** — not "Error". Sentry's "Error" resource (per-event, full
   exception/stack trace) needs a plan above Team, confirmed the hard way: Team grants "Issue"
   but returns "org does not have access to the error subscription resource" for "Error". Issue
   webhooks fire on lifecycle changes (created/resolved/assigned/etc, `data.issue` payload) —
   `src/lib/sentry.ts` only reacts to `created`, and only gets issue-level fields, no stack
   trace. `run.ts` handles that by telling Claude to call `get_sentry_issue_events` first when
   no frames came with the webhook, using the Sentry API token from step 5.
4. Set the **Webhook URL** to `https://<your-app>/api/webhooks/sentry`.
5. Save. The integration's page now shows two separate credentials, don't confuse them:
   - **Client Secret** → `SENTRY_WEBHOOK_SECRET`, verifies the `sentry-hook-signature` header on
     incoming webhook deliveries.
   - Under **Tokens** on that same page, the integration's own auto-generated API token →
     `SENTRY_API_TOKEN`. This is what `get_sentry_issue_events` uses — it's the internal
     integration's token (scoped by the Issue & Event: Read permission from step 2), not a
     separate personal token from Settings → Auth Tokens.
6. `SENTRY_ORG_SLUG` is the slug in your Sentry org's URL (`sentry.io/organizations/<this>/`).

If you ever move to a plan with "Error" resource access, flip the webhook checkbox and
`parseSentryErrorPayload` already handles both shapes — no other change needed.

### Tracking credential expiry

Supabase (and possibly others) don't expose a token's remaining lifetime through their API, so
this can't be auto-detected — instead, record the expiry date yourself once and a daily cron
(`/api/cron/check-credentials`) Slack-alerts starting 14 days out, and daily past expiry until
you update it:

```sql
insert into credential_expirations (name, expires_at, notes) values
  ('SUPABASE_MANAGEMENT_TOKEN_DEFAULT', '2027-08-24T00:00:00Z', 'Supabase personal access token');
```

Use whatever expiry date Supabase showed you when you created the token. Add one row per
credential worth tracking this way — nothing else about the table is Supabase-specific.

## The dashboard

`/` (Basic Auth protected — see step 8 above) shows the queue and lets you act on it:

- **Queue** — everything waiting to be investigated, newest first, with the error
  message/exception type/culprit shown per row and a `▶` marking whichever one the daily
  cron would pick right now. Rows that share the same project + exception type + message
  get an "×N similar" badge so repeat errors are obvious instead of scrolling through
  near-identical rows. **Run now** picks a model (Sonnet 5 or Opus 5) and effort
  (low/medium/high/xhigh/max) right there before kicking it off in the background —
  defaults to Sonnet 5/medium, the cheaper combination; **Discard** drops it without ever
  investigating it.
- **Pause / Resume** — one button. While paused, the daily cron no-ops and both "Run now"
  and "Re-run" are refused (423). Sentry errors still queue up as normal; they just don't
  get investigated until you resume.
- **Recent** — the last 20 completed/failed/discarded investigations, showing which
  model/effort each one actually ran with, with a link to the draft PR when one was opened.
  **Re-run** (same model/effort picker) clones it into a fresh queued row and runs that —
  the original's report/PR/error stays untouched, so re-running never overwrites history.

`/errors` is the full history, any status, not just the queue/last-20 — filterable by
project and searchable by message/culprit, paginated 50 at a time. Click through to
`/errors/[id]` for the full stack trace, environment/release, and (once it's run) the
investigation's report/PR — this is the "simple error dashboard" half of dropping Sentry.

`/projects` manages the registry itself: list, add, edit, enable/disable, delete. The edit
form separates the fields the app actually reads today from a "Reserved — not read by the app
yet" section (`vercel_team_id`, `vercel_token_ref`, `slack_channel`) — filling those in doesn't
do anything until something wires them up, and the form says so rather than pretending
otherwise. Deleting a project fails if it has any investigation history (a foreign key stops
it) — disable it instead if you just want to stop new investigations without losing that
history.

## Model and cost

Default is Sonnet 5 at `effort: "medium"` — meaningfully cheaper than Opus 5/high without
losing much for most bugs. Applies everywhere a model isn't explicitly chosen: the daily
cron always uses this default (no override UI there, it's unattended), and it's what "Run
now"/"Re-run" pre-select if you don't change the dropdowns.

Only Sonnet 5 and Opus 5 are selectable — not Haiku 4.5. That's not just a quality call:
Haiku 4.5 doesn't accept the `output_config.effort` parameter at all (a different request
shape), and this is exactly the kind of task — root-causing a bug and proposing a code
change you might merge — where a weaker model confidently wrong is worse than not running
it. `src/lib/investigate/model-options.ts` is where the selectable list lives if you want to
change that trade-off.

Every investigation's `investigations` row records which model/effort it actually ran with
(migration `0005_investigation_run_options.sql`), visible in the Recent table — useful for
correlating a given run against what it cost in the Anthropic Console.

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
- **Sentry webhook payload shape, and the Vercel Log Drain's log entry JSON shape
  (`timestamp`/`level`/`message`/`requestId`/`projectId`), are written from documented formats,
  not verified against a live payload yet.** The signature verification mechanism itself
  (`x-vercel-signature`, HMAC-SHA1 over the raw body) *is* confirmed against
  [Vercel's docs](https://vercel.com/docs/drains/security) — but the JSON body's exact field
  names for a log entry aren't. Log the raw body on the first real delivery and confirm field
  paths (`src/lib/sentry.ts`, `src/app/api/ingest/vercel-logs/route.ts`) before trusting them
  fully.
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
- **RLS is enabled with zero policies** (`0002_enable_rls.sql`) rather than written per-table
  policies — this app only ever talks to the ops project via `SUPABASE_OPS_SERVICE_ROLE_KEY`,
  which bypasses RLS entirely, so a default-deny for `anon`/`authenticated` is all that's
  needed. If you ever add a client-side/browser consumer of this data, it'll need real
  policies, not this.
- **The log sweep only catches what gets logged somewhere.** It doesn't actively exercise
  anything (no test signups, no synthetic emails) — it's a passive scan of whatever Supabase
  and Vercel already recorded. If a platform-level failure produces zero log output anywhere
  (which may be true of some Auth/SMTP failure modes specifically — never fully confirmed),
  this won't see it either; only an active canary that verifies a real outcome (e.g. checking
  a test inbox for actual delivery) would close that gap, and that's deliberately not what
  this is.
- **Log sweep keyword matching is a plain substring check**, not per-source-aware (e.g. it
  doesn't parse `edge_logs`' structured HTTP status codes to catch 5xx responses that don't
  literally contain the word "error"). Cheap and broad by design; tighten it once you've seen
  what a few real sweeps actually turn up.
