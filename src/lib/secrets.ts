/**
 * Resolves a named credential reference (e.g. "VC_TOKEN_DEFAULT", stored
 * on a `projects` row) to its actual value. Indirection exists because
 * projects can span multiple Vercel accounts / Supabase orgs — each row
 * says *which* env var holds the right token instead of assuming one
 * global token works for everything.
 */
export function resolveSecret(ref: string): string {
  const value = process.env[ref];
  if (!value) {
    throw new Error(`Missing env var "${ref}" referenced by a projects row`);
  }
  return value;
}
