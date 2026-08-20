# fixer

Sentry error auto-investigator. Receives a verified Sentry error webhook, has Claude
investigate it (GitHub code + Vercel logs + Supabase logs), and opens a draft GitHub PR with
a proposed fix + a Slack notification. See `../../.claude/plans/i-have-multiple-projects-mighty-corbato.md`
(or ask for it) for the full architecture writeup.

Deploy this as its own Vercel project — it's not part of any of the product apps it monitors.

## Multi-account note

Projects can live under different Vercel accounts and different Supabase orgs (GitHub is
assumed to be one account/org for everything). Nothing is hardcoded to one account: each row
in the `projects` table names *which* env var holds the right token
(`vercel_token_ref`, `supabase_management_token_ref`, default `..._DEFAULT`). To onboard a
project under a new Vercel/Supabase account, add a new env var (e.g. `VERCEL_TOKEN_CLIENTX`)
and point that project's row at it — no code change.

## One-time manual setup (outside this repo)

These need your accounts/dashboards — not something to script from here.

1. **Ops Supabase project** — create a new, dedicated Supabase project (not one of your
   product projects). Run `supabase/migrations/0001_init.sql` against it. Put its URL +
   service role key in `SUPABASE_OPS_URL` / `SUPABASE_OPS_SERVICE_ROLE_KEY`.
2. **Seed the registry** — insert one row per product app into `projects` (sentry slug,
   github repo, vercel project id, supabase project ref, which token refs to use).
3. **GitHub App** — register one (Contents: read, Pull requests: write, Metadata: read),
   install it on every repo in the registry. Put its ID/key in `GITHUB_APP_ID` /
   `GITHUB_APP_PRIVATE_KEY`.
4. **Sentry internal integration** (org-wide, so it covers every project) — webhook URL
   `https://<this-app>/api/webhooks/sentry`, "Issue" resource enabled. Put the signing
   secret in `SENTRY_WEBHOOK_SECRET`. Also grab a Sentry API token + org slug for
   `SENTRY_API_TOKEN` / `SENTRY_ORG_SLUG` (used to pull extra sample events).
5. **Vercel Log Drain** per product project, pointed at
   `https://<this-app>/api/ingest/vercel-logs`, secret in `VERCEL_LOG_DRAIN_SECRET`.
   Requires a Vercel plan that supports Log Drains — confirm before wiring this up.
6. **Slack incoming webhook** for the channel you want reports posted to →
   `SLACK_WEBHOOK_URL`.
7. **Anthropic API key** → `ANTHROPIC_API_KEY`.

Copy `.env.example` to `.env.local` for local dev; set the same vars on the Vercel project
for deployed use.

## Local dev

```
npm install
npm run dev
```

`npm run typecheck` / `npm run build` to check without running.

## Notes / deviations from the original plan worth knowing

- **Proposed fix is a full replacement file, not a unified diff.** `submit_report`'s
  `proposed_fix` is `{ file, new_content }` — Claude returns the complete new contents of
  one file, which `openDraftFixPr` commits directly. Applying a Claude-authored unified diff
  reliably needs a real patch/apply step; a full-file replacement is more robust for a v1 and
  still reviews fine as a PR diff. Multi-file fixes aren't supported yet — a report proposing
  changes across files still gets filed (no PR), so nothing is silently dropped.
- **Payload shapes for Sentry's webhook and Vercel's Log Drain (`src/lib/sentry.ts`,
  `src/app/api/ingest/vercel-logs/route.ts`) are written from documented shapes, not verified
  against a live payload.** First real test (build-order step 2) should log the raw body and
  confirm field paths before trusting the parsed output.
- Log retention: `vercel_logs` will grow unbounded from the drain. The migration has a
  commented-out prune query — put it on a schedule (pg_cron, or a small
  `/api/maintenance/prune-logs` route on an external cron) once the drain is live.
