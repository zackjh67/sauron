import Link from "next/link";
import { opsClient, type ProjectRow } from "@/lib/supabase-ops";
import type { ParsedSentryError } from "@/lib/sentry";
import { errorSignature } from "@/lib/error-signature";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Quote the operand so commas/periods in a user search string can't be parsed as PostgREST filter delimiters. */
function escapeForOrFilter(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface ErrorRow {
  id: string;
  status: string;
  created_at: string;
  sentry_error: ParsedSentryError;
  projects: { id: string; name: string } | null;
}

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; q?: string; page?: string }>;
}) {
  const { project: projectId, q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = opsClient();

  const [{ data: projects }, { data: rows, count }] = await Promise.all([
    db.from("projects").select("id, name").order("name").returns<Pick<ProjectRow, "id" | "name">[]>(),
    (() => {
      let query = db
        .from("investigations")
        .select("id, status, created_at, sentry_error, projects(id, name)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (projectId) query = query.eq("project_id", projectId);
      if (q) {
        const escaped = escapeForOrFilter(q);
        query = query.or(`sentry_error->>message.ilike."%${escaped}%",sentry_error->>culprit.ilike."%${escaped}%"`);
      }
      return query.returns<ErrorRow[]>();
    })(),
  ]);

  const duplicateCounts = new Map<string, number>();
  for (const r of rows ?? []) {
    const key = errorSignature(r.projects?.name, r.sentry_error);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  function pageHref(next: number, overrides: Record<string, string | undefined> = {}) {
    const params = new URLSearchParams();
    const proj = overrides.project ?? projectId;
    const query = overrides.q ?? q;
    if (proj) params.set("project", proj);
    if (query) params.set("q", query);
    if (next > 1) params.set("page", String(next));
    const qs = params.toString();
    return qs ? `/errors?${qs}` : "/errors";
  }

  return (
    <main>
      <p>
        <Link href="/">&larr; Back to queue</Link>
      </p>
      <h1>All errors</h1>
      <p className="muted">Every error ever captured, any status — Sentry webhook or the sauron-errors ingest endpoint.</p>

      <section>
        <form method="get" action="/errors" style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ marginBottom: 0, minWidth: 200 }}>
            Project
            <select name="project" defaultValue={projectId ?? ""}>
              <option value="">All projects</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
            Search message / culprit
            <input type="text" name="q" defaultValue={q ?? ""} placeholder="e.g. TypeError, checkout" />
          </label>
          <button type="submit" className="primary">
            Filter
          </button>
        </form>
      </section>

      <section>
        <h2>
          {count ?? 0} error{count === 1 ? "" : "s"}
        </h2>
        {!rows || rows.length === 0 ? (
          <p>Nothing found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Error</th>
                <th>Culprit</th>
                <th>Status</th>
                <th>First seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dupCount = duplicateCounts.get(errorSignature(r.projects?.name, r.sentry_error)) ?? 1;
                return (
                  <tr key={r.id}>
                    <td>{r.projects?.name ?? "?"}</td>
                    <td>
                      <Link href={`/errors/${r.id}`}>
                        {r.sentry_error.exceptionType ? `${r.sentry_error.exceptionType}: ` : ""}
                        {r.sentry_error.message}
                      </Link>
                      {dupCount > 1 && (
                        <>
                          {" "}
                          <span className="badge">×{dupCount} similar</span>
                        </>
                      )}
                    </td>
                    <td>{r.sentry_error.culprit ?? "—"}</td>
                    <td>{r.status}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <p className="muted">
            Page {page} of {totalPages} —{" "}
            {page > 1 && <Link href={pageHref(page - 1)}>&larr; Newer</Link>}
            {page > 1 && page < totalPages && " · "}
            {page < totalPages && <Link href={pageHref(page + 1)}>Older &rarr;</Link>}
          </p>
        )}
      </section>
    </main>
  );
}
