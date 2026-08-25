"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { opsClient } from "@/lib/supabase-ops";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function fieldsFromForm(formData: FormData) {
  return {
    name: str(formData, "name"),
    sentry_project_slug: str(formData, "sentry_project_slug"),
    github_repo: str(formData, "github_repo"),
    github_repo_subdir: str(formData, "github_repo_subdir"),
    vercel_project_id: str(formData, "vercel_project_id"),
    vercel_team_id: str(formData, "vercel_team_id"),
    vercel_token_ref: str(formData, "vercel_token_ref") ?? "VC_TOKEN_DEFAULT",
    supabase_project_ref: str(formData, "supabase_project_ref"),
    supabase_management_token_ref: str(formData, "supabase_management_token_ref") ?? "SUPABASE_MANAGEMENT_TOKEN_DEFAULT",
    slack_channel: str(formData, "slack_channel"),
  };
}

export async function createProject(formData: FormData) {
  const fields = fieldsFromForm(formData);
  const db = opsClient();
  const { error } = await db.from("projects").insert(fields);
  if (error) redirect(`/projects/new?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/projects");
  redirect("/projects");
}

export async function updateProject(id: string, formData: FormData) {
  const fields = fieldsFromForm(formData);
  const db = opsClient();
  const { error } = await db.from("projects").update(fields).eq("id", id);
  if (error) redirect(`/projects/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/projects");
  redirect("/projects");
}

export async function toggleProjectEnabled(id: string, enabled: boolean) {
  const db = opsClient();
  await db.from("projects").update({ enabled }).eq("id", id);
  revalidatePath("/projects");
}

/** Fails with an FK error if the project has any investigation history — disabling it is the safer everyday option. */
export async function deleteProject(id: string) {
  const db = opsClient();
  const { error } = await db.from("projects").delete().eq("id", id);
  if (error) redirect(`/projects/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/projects");
  redirect("/projects");
}
