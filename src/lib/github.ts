import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

// One GitHub App, installed on every repo this tool touches (all repos live
// under the same GitHub account/org, per the user).
function appAuth() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set");
  }
  return createAppAuth({ appId, privateKey: privateKey.replace(/\\n/g, "\n") });
}

function splitRepo(ownerRepo: string): { owner: string; repo: string } {
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo) throw new Error(`Invalid github_repo "${ownerRepo}", expected "owner/repo"`);
  return { owner, repo };
}

const installationOctokitCache = new Map<string, Octokit>();

/** owner/repo -> an Octokit authenticated as this App's installation on that repo. */
export async function octokitForRepo(ownerRepo: string): Promise<Octokit> {
  const cached = installationOctokitCache.get(ownerRepo);
  if (cached) return cached;

  const { owner, repo } = splitRepo(ownerRepo);

  const appOctokit = new Octokit({ authStrategy: createAppAuth, auth: appAuth() });
  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });

  const installationOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { ...appAuth(), installationId: installation.id },
  });
  installationOctokitCache.set(ownerRepo, installationOctokit);
  return installationOctokit;
}

export async function getDefaultBranch(ownerRepo: string): Promise<string> {
  const octokit = await octokitForRepo(ownerRepo);
  const { owner, repo } = splitRepo(ownerRepo);
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return data.default_branch;
}

export async function readFile(ownerRepo: string, path: string, ref: string): Promise<string> {
  const octokit = await octokitForRepo(ownerRepo);
  const { owner, repo } = splitRepo(ownerRepo);
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
  if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
    throw new Error(`"${path}" at ${ref} is not a file`);
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}

export async function listDir(
  ownerRepo: string,
  path: string,
  ref: string,
): Promise<Array<{ name: string; type: string }>> {
  const octokit = await octokitForRepo(ownerRepo);
  const { owner, repo } = splitRepo(ownerRepo);
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
  if (!Array.isArray(data)) throw new Error(`"${path}" at ${ref} is not a directory`);
  return data.map((entry) => ({ name: entry.name, type: entry.type }));
}

export interface DraftPrInput {
  ownerRepo: string;
  baseBranch: string;
  headBranch: string;
  filePath: string;
  newContent: string;
  title: string;
  body: string;
}

/** Creates a branch off `baseBranch`, commits one file change, opens a draft PR. Never merges. */
export async function openDraftFixPr(input: DraftPrInput): Promise<string> {
  const octokit = await octokitForRepo(input.ownerRepo);
  const { owner, repo } = splitRepo(input.ownerRepo);

  const { data: baseRef } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${input.baseBranch}`,
  });
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${input.headBranch}`,
    sha: baseRef.object.sha,
  });

  let existingSha: string | undefined;
  try {
    const { data: existing } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: input.filePath,
      ref: input.headBranch,
    });
    if (!Array.isArray(existing) && existing.type === "file") existingSha = existing.sha;
  } catch {
    // file doesn't exist yet on this ref — fine, this is a new-file commit
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: input.filePath,
    branch: input.headBranch,
    message: input.title,
    content: Buffer.from(input.newContent, "utf8").toString("base64"),
    sha: existingSha,
  });

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    base: input.baseBranch,
    head: input.headBranch,
    title: input.title,
    body: input.body,
    draft: true,
  });

  return pr.html_url;
}
