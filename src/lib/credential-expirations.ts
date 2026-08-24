import { opsClient } from "./supabase-ops";

export interface ExpiringCredential {
  name: string;
  expiresAt: string;
  daysLeft: number;
}

/** Credentials expiring within `warnDays`, or already expired (negative daysLeft). */
export async function findExpiringCredentials(warnDays = 14): Promise<ExpiringCredential[]> {
  const db = opsClient();
  const { data, error } = await db
    .from("credential_expirations")
    .select("name, expires_at")
    .order("expires_at", { ascending: true });

  if (error) throw new Error(`failed to read credential_expirations: ${error.message}`);

  const now = Date.now();
  return (data ?? [])
    .map((row) => ({
      name: row.name as string,
      expiresAt: row.expires_at as string,
      daysLeft: Math.floor((new Date(row.expires_at as string).getTime() - now) / (24 * 60 * 60 * 1000)),
    }))
    .filter((c) => c.daysLeft <= warnDays);
}
