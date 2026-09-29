import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser, decrypt, encrypt } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { github } from "@/lib/server/github";
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL || req.nextUrl.origin;
  try {
    const cookie = (await cookies()).get("github_state")?.value;
    (await cookies()).delete("github_state");
    const current = await currentUser();
    if (!current || current.demo)
      return NextResponse.redirect(
        new URL("/?error=create-account-first", origin),
      );
    if (!cookie) throw new Error("Missing OAuth state");
    const stored = JSON.parse(decrypt(cookie));
    if (
      !stored.state ||
      stored.state !== req.nextUrl.searchParams.get("state") ||
      typeof stored.expiresAt !== "number" ||
      stored.expiresAt <= Date.now()
    )
      throw new Error("Invalid OAuth state");
    if (current.id !== stored.userId)
      throw new Error("Session changed during OAuth");
    const code = req.nextUrl.searchParams.get("code");
    if (!code) throw new Error("Missing authorization code");
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: origin + "/api/auth/github/callback",
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await response.json();
    if (!data.access_token) throw new Error("Token exchange failed");
    const profile = await github<{
      id: number;
      login: string;
      name: string | null;
    }>("/user", data.access_token);
    const id = current.id;
    const linked = await query<{ id: string }>(
      "SELECT id FROM users WHERE github_id=$1",
      [String(profile.id)],
    );
    if (linked[0] && linked[0].id !== id)
      throw new Error("GitHub account already linked");
    const updated = await query(
      "UPDATE users SET github_id=$1 WHERE id=$2 AND (github_id IS NULL OR github_id=$1) RETURNING id",
      [String(profile.id), id],
    );
    if (!updated.length)
      throw new Error(
        "Connect the GitHub account already linked to this workspace.",
      );
    await query(
      "INSERT INTO repository_connections(user_id,encrypted_token,login) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=$2, login=$3",
      [id, encrypt(data.access_token), profile.login],
    );
    return NextResponse.redirect(new URL("/?connected=github", origin));
  } catch {
    return NextResponse.redirect(
      new URL("/?error=github-connection-failed", origin),
    );
  }
}
