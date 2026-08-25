import Link from "next/link";
import { notFound } from "next/navigation";
import { opsClient, type ProjectRow } from "@/lib/supabase-ops";
import { updateProject, deleteProject } from "../actions";
import { ProjectForm } from "../project-form";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const db = opsClient();
  const { data: project } = await db.from("projects").select("*").eq("id", id).maybeSingle<ProjectRow>();
  if (!project) notFound();

  return (
    <main>
      <p>
        <Link href="/projects">&larr; Back to projects</Link>
      </p>
      <h1>Edit {project.name}</h1>
      <section>
        {error && <p role="alert">{error}</p>}
        <ProjectForm action={updateProject.bind(null, id)} initial={project} />

        <hr />
        <form action={deleteProject.bind(null, id)}>
          <button type="submit" className="danger">
            Delete project
          </button>
        </form>
        <p>
          <small>
            Deleting fails if this project has any investigation history — disable it above
            instead if you just want to stop new investigations without losing that history.
          </small>
        </p>
      </section>
    </main>
  );
}
