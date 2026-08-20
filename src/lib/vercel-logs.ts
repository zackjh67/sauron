import { opsClient } from "./supabase-ops";

export interface VercelLogQuery {
  vercelProjectId: string;
  fromIso: string;
  toIso: string;
  textFilter?: string;
  limit?: number;
}

/**
 * Queries the ops project's `vercel_logs` table, populated by the Vercel
 * Log Drain (see /api/ingest/vercel-logs). This is a lookup against our own
 * ingested store, not a live call to Vercel — Vercel doesn't offer cheap
 * ad-hoc historical query across all plans, which is why the drain exists.
 */
export async function queryVercelLogs(q: VercelLogQuery) {
  const supabase = opsClient();
  let query = supabase
    .from("vercel_logs")
    .select("ts, level, message, request_id")
    .eq("vercel_project_id", q.vercelProjectId)
    .gte("ts", q.fromIso)
    .lte("ts", q.toIso)
    .order("ts", { ascending: true })
    .limit(q.limit ?? 200);

  if (q.textFilter) {
    query = query.ilike("message", `%${q.textFilter}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`vercel_logs query failed: ${error.message}`);
  return data;
}
