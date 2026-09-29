import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createUser,
  currentUser,
  logout,
  passwordValid,
  rateLimit,
  session,
} from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import {
  ownedProject,
  saveScan,
  seedDemo,
  workspace,
} from "@/lib/server/workspace";
import { github, githubToken, ingest } from "@/lib/server/github";
import {
  appConnection,
  appUserToken,
  withAppRepository,
} from "@/lib/server/github-app-connection";
import { githubAppClient } from "@/lib/server/github-app-client";
import { githubAppConfigured } from "@/lib/server/github-app-config";
import { inspectURL } from "@/lib/server/production";
import { scan } from "@/lib/scanner";
import { projectFixture } from "@/lib/demo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const projectSchema = z.object({
  name: z.string().trim().min(2).max(60),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  branch: z.string().min(1).max(150).default("main"),
  github_installation_id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .nullable()
    .optional(),
  production_url: z.union([z.literal(""), z.url().max(2000)]).optional(),
});
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function allowedOrigins(requestUrl: string) {
  const configured = [process.env.APP_URL || new URL(requestUrl).origin];
  configured.push(
    ...(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  return new Set(
    configured.map((origin) => {
      const url = new URL(origin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error(
          "Allowed origins must be HTTP(S) origins without a path.",
        );
      return url.origin;
    }),
  );
}
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.pathname === "/api/health") {
      await query("SELECT 1");
      return reply({ status: "ok" });
    }
    const user = await currentUser();
    if (!user)
      return reply({
        user: null,
        demoEnabled:
          process.env.NODE_ENV !== "production" ||
          process.env.ENABLE_DEMO === "true",
      });
    const route = req.nextUrl.pathname;
    if (route === "/api/workspace") {
      const connection = await query<{ login: string }>(
        "SELECT login FROM repository_connections WHERE user_id=$1",
        [user.id],
      );
      return reply({
        user,
        projects: await workspace(user.id),
        github: connection[0]?.login ?? null,
        oauthConfigured: !!(
          process.env.GITHUB_CLIENT_ID &&
          process.env.GITHUB_CLIENT_SECRET &&
          process.env.TOKEN_ENCRYPTION_KEY
        ),
        githubApp: await (async () => {
          const connection = await appConnection(user.id);
          return connection ? { login: connection.login } : null;
        })(),
        githubAppConfigured: githubAppConfigured(),
      });
    }
    if (route === "/api/repositories") {
      await rateLimit("github-browse:" + user.id, 60, 900);
      if (await appConnection(user.id))
        return reply(
          await githubAppClient.repositories(await appUserToken(user.id)),
        );
      const token = await githubToken(user.id);
      if (!token)
        return reply({ error: "Connect GitHub or the GitHub App first." }, 400);
      const repos = await github<
        {
          id: number;
          full_name: string;
          default_branch: string;
          private: boolean;
        }[]
      >("/user/repos?sort=updated&per_page=100", token);
      return reply(
        repos
          .filter((r) => !r.private)
          .map((r) => ({
            id: r.id,
            full_name: r.full_name,
            default_branch: r.default_branch,
            private: false,
            installation_id: null,
          })),
      );
    }
    if (route === "/api/github/app/installations") {
      return reply(
        await githubAppClient.installations(await appUserToken(user.id)),
      );
    }
    if (route === "/api/branches") {
      const repo = req.nextUrl.searchParams.get("repository") ?? "";
      const installationId = req.nextUrl.searchParams.get("installation_id");
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
        return reply({ error: "Invalid repository" }, 400);
      await rateLimit("github-browse:" + user.id, 60, 900);
      const branches = (token?: string) =>
        github(`/repos/${repo}/branches?per_page=100`, token);
      return reply(
        installationId
          ? await withAppRepository(user.id, repo, installationId, branches)
          : await branches(await githubToken(user.id)),
      );
    }
    return reply({ error: "Not found" }, 404);
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Request failed." },
      400,
    );
  }
}
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (!origin || !allowedOrigins(req.url).has(origin))
      return reply({ error: "Request origin is not allowed." }, 403);
    if (Number(req.headers.get("content-length") || 0) > 16000)
      return reply({ error: "Request too large" }, 413);
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16000) {
          await reader.cancel();
          return reply({ error: "Request too large" }, 413);
        }
        chunks.push(value);
      }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(raw || "{}");
    const route = req.nextUrl.pathname;
    if (route === "/api/auth/demo") {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ENABLE_DEMO !== "true"
      )
        return reply({ error: "Demo is disabled." }, 403);
      const existing = await currentUser();
      if (existing) return reply({ ok: true });
      await rateLimit("demo:global", 200, 3600);
      const id = await createUser(
        randomUUID() + "@demo.shipwreck.local",
        "Alex Morgan",
        undefined,
        true,
      );
      await seedDemo(id);
      await session(id);
      return reply({ ok: true });
    }
    if (route === "/api/auth/signup" || route === "/api/auth/login") {
      const input = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z.string().min(12).max(200),
          name: z.string().trim().min(1).max(60).optional(),
        })
        .parse(body);
      await rateLimit("auth:" + input.email, 12, 900);
      await rateLimit("auth:global", 300, 900);
      if (route.endsWith("signup")) {
        const exists = await query("SELECT id FROM users WHERE email=$1", [
          input.email,
        ]);
        if (exists.length)
          return reply(
            { error: "Unable to create this account. Try signing in." },
            400,
          );
        const id = await createUser(
          input.email,
          input.name || input.email.split("@")[0],
          input.password,
        );
        await session(id);
      } else {
        const rows = await query<{ id: string; password_hash: string | null }>(
          "SELECT id,password_hash FROM users WHERE email=$1",
          [input.email],
        );
        if (
          !rows[0]?.password_hash ||
          !(await passwordValid(input.password, rows[0].password_hash))
        )
          return reply({ error: "Email or password is incorrect." }, 401);
        await session(rows[0].id);
      }
      return reply({ ok: true });
    }
    const user = await currentUser();
    if (!user) return reply({ error: "Sign in to continue." }, 401);
    if (route === "/api/auth/logout") {
      await logout();
      return reply({ ok: true });
    }
    if (route === "/api/github/app/disconnect") {
      await query("DELETE FROM github_app_connections WHERE user_id=$1", [
        user.id,
      ]);
      return reply({ ok: true });
    }
    if (route === "/api/projects") {
      const input = projectSchema.parse(body);
      await rateLimit("projects:" + user.id, 20, 3600);
      if (input.github_installation_id)
        await githubAppClient.validateRepository(
          await appUserToken(user.id),
          input.repository,
          input.github_installation_id,
        );
      const count = await query<{ count: string }>(
        "SELECT count(*) FROM projects WHERE user_id=$1",
        [user.id],
      );
      if (Number(count[0].count) >= 20)
        return reply(
          { error: "This MVP workspace supports up to 20 projects." },
          400,
        );
      const id = randomUUID();
      await query(
        "INSERT INTO projects (id,user_id,name,repository,branch,production_url,source,github_installation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          user.id,
          input.name,
          input.repository,
          input.branch,
          input.production_url || null,
          "github",
          input.github_installation_id ?? null,
        ],
      );
      return reply({ id });
    }
    if (route === "/api/scans") {
      const { projectId } = z.object({ projectId: z.uuid() }).parse(body);
      const project = await ownedProject(user.id, projectId);
      if (!project) return reply({ error: "Project not found." }, 404);
      await rateLimit("scans:" + user.id, 20, 3600);
      const repo =
        project.source === "demo"
          ? { files: projectFixture(project.name), sha: "demo-current" }
          : project.github_installation_id
            ? await withAppRepository(
                user.id,
                project.repository,
                project.github_installation_id,
                (token) => ingest(project.repository, project.branch, token),
              )
            : await ingest(
                project.repository,
                project.branch,
                await githubToken(user.id),
              );
      const observation = project.production_url
        ? await inspectURL(project.production_url)
        : undefined;
      const report = scan({ ...repo, observation });
      const id = await saveScan(project.id, report, repo.sha);
      return reply({ id, report });
    }
    if (route === "/api/projects/update") {
      const input = projectSchema.extend({ id: z.uuid() }).parse(body);
      const p = await ownedProject(user.id, input.id);
      if (!p) return reply({ error: "Project not found." }, 404);
      const installationId =
        input.github_installation_id === undefined
          ? p.github_installation_id
          : input.github_installation_id;
      if (
        installationId &&
        (input.repository !== p.repository ||
          installationId !== p.github_installation_id)
      )
        await githubAppClient.validateRepository(
          await appUserToken(user.id),
          input.repository,
          installationId,
        );
      await query(
        "UPDATE projects SET name=$1,repository=$2,branch=$3,production_url=$4,github_installation_id=$7 WHERE id=$5 AND user_id=$6",
        [
          input.name,
          input.repository,
          input.branch,
          input.production_url || null,
          input.id,
          user.id,
          installationId ?? null,
        ],
      );
      return reply({ ok: true });
    }
    if (route === "/api/projects/delete") {
      const { id } = z.object({ id: z.uuid() }).parse(body);
      await query("DELETE FROM projects WHERE id=$1 AND user_id=$2", [
        id,
        user.id,
      ]);
      return reply({ ok: true });
    }
    return reply({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return reply(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    return reply(
      { error: e instanceof Error ? e.message : "Request failed." },
      400,
    );
  }
}
