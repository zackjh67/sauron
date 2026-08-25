import Link from "next/link";
import { notFound } from "next/navigation";
import { opsClient } from "@/lib/supabase-ops";
import type { ParsedSentryError, SentryStackFrame } from "@/lib/sentry";
import type { Report } from "@/lib/investigate/tools";

export const dynamic = "force-dynamic";

interface ErrorDetailRow {
  id: string;
  status: string;
  run_trigger: string | null;
  sentry_event_id: string;
  sentry_error: ParsedSentryError;
  report: Report | null;
  pr_url: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  projects: { name: string } | null;
}

function Frame({ frame }: { frame: SentryStackFrame }) {
  return (
    <li className={frame.in_app ? "" : "muted"}>
      <code>
        {frame.filename ?? "?"}:{frame.lineno ?? "?"}
      </code>
      {frame.function && <> — {frame.function}</>}
      {frame.in_app && <span className="badge"> app</span>}
    </li>
  );
}

export default async function ErrorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = opsClient();

  const { data: row } = await db
    .from("investigations")
    .select(
      "id, status, run_trigger, sentry_event_id, sentry_error, report, pr_url, error, created_at, started_at, completed_at, projects(name)",
    )
    .eq("id", id)
    .maybeSingle<ErrorDetailRow>();

  if (!row) notFound();

  const err = row.sentry_error;

  return (
    <main>
      <p>
        <Link href="/errors">&larr; Back to all errors</Link>
      </p>
      <h1>
        {err.exceptionType ? `${err.exceptionType}: ` : ""}
        {err.message}
      </h1>
      <p className="muted">
        {row.projects?.name ?? "?"} · {row.status}
        {row.run_trigger ? ` (${row.run_trigger})` : ""} · first seen {new Date(row.created_at).toLocaleString()}
      </p>

      <section>
        <h2>Details</h2>
        <table>
          <tbody>
            <tr>
              <th>Culprit</th>
              <td>{err.culprit ?? "—"}</td>
            </tr>
            <tr>
              <th>Environment</th>
              <td>{err.environment ?? "—"}</td>
            </tr>
            <tr>
              <th>Release</th>
              <td>{err.release ?? "—"}</td>
            </tr>
            <tr>
              <th>Event id</th>
              <td>{row.sentry_event_id}</td>
            </tr>
            {err.issueUrl && (
              <tr>
                <th>Source</th>
                <td>
                  <a href={err.issueUrl}>View in Sentry</a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Stack trace</h2>
        {err.frames.length === 0 ? (
          <p className="muted">No stack frames captured.</p>
        ) : (
          <ol>
            {err.frames.map((frame, i) => (
              <Frame key={i} frame={frame} />
            ))}
          </ol>
        )}
      </section>

      {(row.status === "done" || row.status === "failed") && (
        <section>
          <h2>Investigation</h2>
          {row.status === "failed" ? (
            <p>
              <strong>Failed:</strong> {row.error ?? "unknown error"}
            </p>
          ) : (
            row.report && (
              <>
                <p>
                  <strong>Summary:</strong> {row.report.summary}
                </p>
                <p>
                  <strong>Root cause:</strong> {row.report.root_cause}
                </p>
                <p>
                  <strong>Confidence:</strong> {row.report.confidence}
                </p>
                {row.pr_url && (
                  <p>
                    <a href={row.pr_url}>Review draft PR</a>
                  </p>
                )}
              </>
            )
          )}
          {row.completed_at && <p className="muted">Completed {new Date(row.completed_at).toLocaleString()}</p>}
        </section>
      )}

      <section>
        <h2>Raw payload</h2>
        <details>
          <summary>Show JSON</summary>
          <pre style={{ overflowX: "auto", fontSize: "0.8rem" }}>{JSON.stringify(err.raw, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}
