import type { ProjectRow } from "@/lib/supabase-ops";

export function ProjectForm({
  action,
  initial,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: ProjectRow;
}) {
  return (
    <form action={action}>
      <p>
        <label>
          Name
          <br />
          <input name="name" defaultValue={initial?.name} required />
        </label>
      </p>
      <p>
        <label>
          Sentry project slug
          <br />
          <input name="sentry_project_slug" defaultValue={initial?.sentry_project_slug} required />
        </label>
      </p>
      <p>
        <label>
          GitHub repo (owner/repo)
          <br />
          <input name="github_repo" defaultValue={initial?.github_repo} required />
        </label>
      </p>
      <p>
        <label>
          GitHub repo subdir — only for a monorepo where this Sentry project is one of several
          apps in the same repo. Leave blank otherwise.
          <br />
          <input name="github_repo_subdir" defaultValue={initial?.github_repo_subdir ?? ""} />
        </label>
      </p>
      <p>
        <label>
          Vercel project id — leave blank if this repo has no Vercel deployment (e.g. a
          Supabase-only repo)
          <br />
          <input name="vercel_project_id" defaultValue={initial?.vercel_project_id ?? ""} />
        </label>
      </p>
      <p>
        <label>
          Supabase project ref
          <br />
          <input name="supabase_project_ref" defaultValue={initial?.supabase_project_ref} required />
        </label>
      </p>
      <p>
        <label>
          Supabase management token — env var name holding the token (see the multi-account
          note in the README if this project&apos;s Supabase org needs a different one)
          <br />
          <input
            name="supabase_management_token_ref"
            defaultValue={initial?.supabase_management_token_ref ?? "SUPABASE_MANAGEMENT_TOKEN_DEFAULT"}
          />
        </label>
      </p>

      <fieldset>
        <legend>Reserved — not read by the app yet</legend>
        <p>
          <label>
            Vercel token env var name
            <br />
            <input name="vercel_token_ref" defaultValue={initial?.vercel_token_ref ?? "VC_TOKEN_DEFAULT"} />
          </label>
        </p>
        <p>
          <label>
            Vercel team id
            <br />
            <input name="vercel_team_id" defaultValue={initial?.vercel_team_id ?? ""} />
          </label>
        </p>
        <p>
          <label>
            Slack channel
            <br />
            <input name="slack_channel" defaultValue={initial?.slack_channel ?? ""} />
          </label>
        </p>
      </fieldset>

      <p>
        <button type="submit">{initial ? "Save changes" : "Create project"}</button>
      </p>
    </form>
  );
}
