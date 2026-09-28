import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { currentUser, encrypt, session } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { github } from "@/lib/server/github";
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL || req.nextUrl.origin;
  try {
    const cookie = (await cookies()).get("github_state")?.value;
    (await cookies()).delete("github_state");
    if (!cookie) throw new Error("Missing OAuth state");
    const stored = JSON.parse(cookie);
    if (!stored.state || stored.state !== req.nextUrl.searchParams.get("state"))
      throw new Error("Invalid OAuth state");
    const current = await currentUser();
    if ((current?.id ?? null) !== stored.userId)
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
    let id = current?.demo ? undefined : current?.id;
    const linked = await query<{ id: string }>(
      "SELECT id FROM users WHERE github_id=$1",
      [String(profile.id)],
    );
    if (id && linked[0] && linked[0].id !== id)
      throw new Error("GitHub account already linked");
    if (!id) {
      id = linked[0]?.id;
      if (!id) {
        id = randomUUID();
        await query(
          "INSERT INTO users(id,email,name,github_id) VALUES($1,$2,$3,$4)",
          [
            id,
            profile.id + "@github.shipwreck.local",
            profile.name || profile.login,
            String(profile.id),
          ],
        );
      }
    }
    await query("UPDATE users SET github_id=$1 WHERE id=$2", [
      String(profile.id),
      id,
    ]);
    await query(
      "INSERT INTO repository_connections(user_id,encrypted_token,login) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=$2, login=$3",
      [id, encrypt(data.access_token), profile.login],
    );
    await session(id);
    return NextResponse.redirect(new URL("/", origin));
  } catch {
    return NextResponse.redirect(
      new URL("/?error=github-connection-failed", origin),
    );
  }
}
