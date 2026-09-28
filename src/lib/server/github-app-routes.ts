import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { currentUser, encrypt, rateLimit } from "@/lib/server/auth";
import { github } from "@/lib/server/github";
import {
  githubAppConfig,
  githubAppConfigured,
  pkce,
  exchangeAppToken,
} from "@/lib/server/github-app-config";
import { githubAppClient } from "@/lib/server/github-app-client";
import { saveAppConnection } from "@/lib/server/github-app-connection";
import { validateAppFlow, type AppFlow } from "@/lib/server/github-app-flow";
const cookieName = "github_app_flow";
async function storeFlow(
  userId: string,
  purpose: AppFlow["purpose"],
  origin: string,
  extra: Partial<AppFlow> = {},
) {
  const flow: AppFlow = {
    state: randomBytes(32).toString("hex"),
    userId,
    purpose,
    expiresAt: Date.now() + 600000,
    ...extra,
  };
  (await cookies()).set(cookieName, encrypt(JSON.stringify(flow)), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https:"),
    maxAge: 600,
    path: "/api/github/app",
  });
  return flow;
}
async function authorize(
  userId: string,
  origin: string,
  installationId?: string,
) {
  const config = githubAppConfig();
  const proof = pkce();
  const flow = await storeFlow(userId, "authorize", origin, {
    verifier: proof.verifier,
    installationId,
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", origin + "/api/github/app/callback");
  url.searchParams.set("state", flow.state);
  url.searchParams.set("code_challenge", proof.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return NextResponse.redirect(url);
}
export async function GET(req: NextRequest) {
  const origin = new URL(process.env.APP_URL || req.nextUrl.origin).origin;
  const fail = (reason: string) =>
    NextResponse.redirect(new URL("/?error=" + reason, origin));
  if (!githubAppConfigured()) return fail("github-app-not-configured");
  const user = await currentUser();
  if (!user || user.demo) return fail("github-app-sign-in");
  try {
    await rateLimit("github-app-flow:" + user.id, 40, 900);
    const action = req.nextUrl.pathname.split("/").at(-1);
    if (action === "connect") return await authorize(user.id, origin);
    if (action === "install") {
      const flow = await storeFlow(user.id, "install", origin);
      const url = new URL(
        `https://github.com/apps/${githubAppConfig().slug}/installations/new`,
      );
      url.searchParams.set("state", flow.state);
      return NextResponse.redirect(url);
    }
    if (action !== "setup" && action !== "callback")
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const jar = await cookies();
    const cookie = jar.get(cookieName)?.value;
    jar.delete({ name: cookieName, path: "/api/github/app" });
    const flow = validateAppFlow(
      cookie,
      req.nextUrl.searchParams.get("state"),
      user.id,
      action === "setup" ? "install" : "authorize",
    );
    if (action === "setup") {
      if (req.nextUrl.searchParams.get("setup_action") === "request")
        return fail("github-app-approval-pending");
      const installationId = req.nextUrl.searchParams.get("installation_id");
      if (!installationId || !/^[1-9]\d*$/.test(installationId))
        throw new Error("Missing installation.");
      // The installation ID is untrusted until the next callback checks it with a user token.
      return await authorize(user.id, origin, installationId);
    }
    const code = req.nextUrl.searchParams.get("code");
    if (!code) throw new Error("GitHub App authorization was declined.");
    const token = await exchangeAppToken({
      code,
      code_verifier: flow.verifier!,
      redirect_uri: origin + "/api/github/app/callback",
    });
    const profile = await github<{ id: number; login: string }>(
      "/user",
      token.access_token,
    );
    const installations = await githubAppClient.installations(
      token.access_token,
    );
    if (
      flow.installationId &&
      !installations.some((i) => String(i.id) === flow.installationId)
    )
      throw new Error(
        "This GitHub user cannot access the requested installation.",
      );
    await saveAppConnection(user.id, profile, token);
    if (!installations.length)
      return NextResponse.redirect(new URL("/api/github/app/install", origin));
    return NextResponse.redirect(new URL("/?connected=github-app", origin));
  } catch {
    return fail("github-app-connection-failed");
  }
}
