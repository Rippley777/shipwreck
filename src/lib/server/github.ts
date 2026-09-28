import { query } from "./db";
import { decrypt } from "./auth";
export async function githubToken(userId: string) {
  const rows = await query<{ encrypted_token: string }>(
    "SELECT encrypted_token FROM repository_connections WHERE user_id=$1",
    [userId],
  );
  return rows[0] ? decrypt(rows[0].encrypted_token) : undefined;
}
export async function github<T>(
  route: string,
  token?: string,
  options?: { method: "POST" | "DELETE"; body?: unknown },
): Promise<T> {
  if (!route.startsWith("/") || route.startsWith("//"))
    throw new Error("Invalid GitHub API route.");
  const response = await fetch("https://api.github.com" + route, {
    method: options?.method ?? "GET",
    body: options?.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Accept: "application/vnd.github+json",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "Repository or branch not found. For private repositories, connect the GitHub App and select an accessible repository."
        : response.status === 401
          ? "GitHub authorization expired or was revoked. Reconnect GitHub in workspace settings."
          : response.status === 403
            ? "GitHub API limit reached or access denied."
            : "GitHub could not complete the request.",
    );
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const allowedFile = (path: string) =>
  !/(?:^|\/)(?:node_modules|vendor|\.git|dist|build|\.next|coverage)(?:\/|$)/.test(
    path,
  ) &&
  (/\.(?:[cm]?[jt]sx?|json|ya?ml|toml|sql|prisma|py|go|rs|rb|php|tf|lock|ini|conf)$/.test(
    path,
  ) ||
    /(?:^|\/)(?:Dockerfile|\.env(?:\.[\w.-]+)?|\.gitignore)$/.test(path));
export async function ingest(
  repository: string,
  branch: string,
  token?: string,
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Use a GitHub repository in owner/repository format.");
  const commit = await github<{ sha: string }>(
    `/repos/${repository}/commits/${encodeURIComponent(branch)}`,
    token,
  );
  const tree = await github<{
    truncated: boolean;
    tree: {
      path: string;
      type: string;
      mode: string;
      size?: number;
      sha: string;
    }[];
  }>(`/repos/${repository}/git/trees/${commit.sha}?recursive=1`, token);
  if (tree.truncated)
    throw new Error(
      "This repository exceeds the MVP tree limit. Use the local CLI for this repository.",
    );
  const entries = tree.tree.filter(
    (f) => f.type === "blob" && f.mode !== "120000" && allowedFile(f.path),
  );
  if (
    entries.length > 350 ||
    entries.reduce((n, f) => n + (f.size ?? 0), 0) > 8_000_000 ||
    entries.some((f) => (f.size ?? 0) > 2_000_000)
  )
    throw new Error(
      "Repository exceeds the scan limit (350 eligible files / 8 MB / 2 MB per file). Use the local CLI.",
    );
  const files: Record<string, string> = {};
  const deadline = Date.now() + 120_000;
  for (let i = 0; i < entries.length; i += 8)
    await Promise.all(
      entries.slice(i, i + 8).map(async (entry) => {
        if (Date.now() > deadline)
          throw new Error(
            "Repository ingestion time limit reached. Try the local CLI.",
          );
        const blob = await github<{ content: string; encoding: string }>(
          `/repos/${repository}/git/blobs/${entry.sha}`,
          token,
        );
        if (blob.encoding !== "base64")
          throw new Error("Unsupported GitHub blob encoding.");
        files[entry.path] = Buffer.from(
          blob.content.replace(/\n/g, ""),
          "base64",
        ).toString("utf8");
      }),
    );
  return { files, sha: commit.sha };
}
