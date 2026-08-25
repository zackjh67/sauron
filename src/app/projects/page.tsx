import Link from "next/link";
import { opsClient, type ProjectRow } from "@/lib/supabase-ops";
import { toggleProjectEnabled } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const db = opsClient();
  const { data: projects } = await db.from("projects").select("*").order("name").returns<ProjectRow[]>();

  return (
    <main>
      <p>
        <Link href="/">&larr; Back to queue</Link>
      </p>
      <h1>Projects</h1>

      <section>
        <p>
          <Link href="/projects/new">+ New project</Link>
        </p>
        {!projects || projects.length === 0 ? (
          <p>No projects registered yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Sentry slug</th>
                <th>GitHub repo</th>
                <th>Vercel project</th>
                <th>Supabase ref</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.name}</Link>
                  </td>
                  <td>{p.sentry_project_slug}</td>
                  <td>
                    {p.github_repo}
                    {p.github_repo_subdir ? ` (${p.github_repo_subdir})` : ""}
                  </td>
                  <td>{p.vercel_project_id ?? "— none —"}</td>
                  <td>{p.supabase_project_ref}</td>
                  <td>{p.enabled ? "Enabled" : "Disabled"}</td>
                  <td>
                    <form action={toggleProjectEnabled.bind(null, p.id, !p.enabled)}>
                      <button type="submit" className={p.enabled ? "danger" : "primary"}>
                        {p.enabled ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
