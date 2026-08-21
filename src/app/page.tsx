import { opsClient, type AppSettingsRow } from "@/lib/supabase-ops";
import type { Report } from "@/lib/investigate/tools";
import { RunButton, DiscardButton, PauseToggle } from "./dashboard-actions";

export const dynamic = "force-dynamic";

interface QueuedRow {
  id: string;
  sentry_event_id: string;
  created_at: string;
  projects: { name: string } | null;
}

interface RecentRow {
  id: string;
  status: string;
  run_trigger: string | null;
  report: Report | null;
  pr_url: string | null;
  error: string | null;
  completed_at: string | null;
  projects: { name: string } | null;
}

export default async function Home() {
  const db = opsClient();

  const [{ data: settings }, { data: queued }, { data: recent }] = await Promise.all([
    db.from("app_settings").select("paused").eq("id", 1).single<AppSettingsRow>(),
    db
      .from("investigations")
      .select("id, sentry_event_id, created_at, projects(name)")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .returns<QueuedRow[]>(),
    db
      .from("investigations")
      .select("id, status, run_trigger, report, pr_url, error, completed_at, projects(name)")
      .neq("status", "queued")
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<RecentRow[]>(),
  ]);

  const paused = settings?.paused ?? false;

  return (
    <main>
      <h1>Sauron</h1>

      <section>
        <p>
          Status: <strong>{paused ? "Paused" : "Running"}</strong> — one automatic investigation/day, plus
          whatever you run below. <PauseToggle paused={paused} />
        </p>
      </section>

      <section>
        <h2>Queue ({queued?.length ?? 0})</h2>
        {!queued || queued.length === 0 ? (
          <p>Nothing queued.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Sentry event</th>
                <th>Queued</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {queued.map((q) => (
                <tr key={q.id}>
                  <td>{q.projects?.name ?? "?"}</td>
                  <td>{q.sentry_event_id}</td>
                  <td>{new Date(q.created_at).toLocaleString()}</td>
                  <td>
                    <RunButton id={q.id} /> <DiscardButton id={q.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Recent</h2>
        {!recent || recent.length === 0 ? (
          <p>No investigations yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Summary / error</th>
                <th>PR</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.projects?.name ?? "?"}</td>
                  <td>{r.status}</td>
                  <td>{r.run_trigger ?? "—"}</td>
                  <td>{r.status === "failed" ? r.error : (r.report?.summary ?? "—")}</td>
                  <td>{r.pr_url ? <a href={r.pr_url}>PR</a> : "—"}</td>
                  <td>{r.completed_at ? new Date(r.completed_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Endpoints</h2>
        <p>Sentry webhook: /api/webhooks/sentry</p>
        <p>Vercel log drain: /api/ingest/vercel-logs</p>
        <p>Daily cron: /api/cron/daily-investigation</p>
      </section>
    </main>
  );
}
