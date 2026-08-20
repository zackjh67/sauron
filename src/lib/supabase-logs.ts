import { resolveSecret } from "./secrets";

export interface SupabaseLogQuery {
  projectRef: string;
  managementTokenRef: string;
  /** Which Logflare-backed source to read: postgres_logs, edge_logs, function_edge_logs, etc. */
  source: "postgres_logs" | "edge_logs" | "function_edge_logs" | "auth_logs";
  fromIso: string;
  toIso: string;
  textFilter?: string;
  limit?: number;
}

/**
 * Queries a product project's logs via the Supabase Management API
 * (Logflare-backed `analytics/endpoints/logs.all`). Read-only: only SELECT
 * against the requested source is constructed here — the query shape is
 * fixed, not assembled from free-form Claude-provided SQL.
 */
export async function querySupabaseLogs(q: SupabaseLogQuery) {
  const token = resolveSecret(q.managementTokenRef);
  const limit = q.limit ?? 200;

  const whereClause = q.textFilter
    ? `and event_message ilike '%${q.textFilter.replace(/'/g, "''")}%'`
    : "";

  const sql = `
    select timestamp, event_message, metadata
    from ${q.source}
    where timestamp >= timestamp '${q.fromIso}'
      and timestamp <= timestamp '${q.toIso}'
      ${whereClause}
    order by timestamp asc
    limit ${limit}
  `.trim();

  const url = new URL(`https://api.supabase.com/v1/projects/${q.projectRef}/analytics/endpoints/logs.all`);
  url.searchParams.set("sql", sql);

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Supabase logs query failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
