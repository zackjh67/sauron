import Link from "next/link";
import { createProject } from "../actions";
import { ProjectForm } from "../project-form";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main>
      <p>
        <Link href="/projects">&larr; Back to projects</Link>
      </p>
      <h1>New project</h1>
      {error && <p role="alert">{error}</p>}
      <ProjectForm action={createProject} />
    </main>
  );
}
