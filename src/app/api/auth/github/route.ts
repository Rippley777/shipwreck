import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/server/auth";
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL || req.nextUrl.origin;
  if (
    !process.env.GITHUB_CLIENT_ID ||
    !process.env.GITHUB_CLIENT_SECRET ||
    !process.env.TOKEN_ENCRYPTION_KEY
  )
    return NextResponse.redirect(
      new URL("/?error=github-not-configured", origin),
    );
  const user = await currentUser();
  const state = randomBytes(32).toString("hex");
  (await cookies()).set(
    "github_state",
    JSON.stringify({ state, userId: user?.id ?? null }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https:"),
      maxAge: 600,
      path: "/",
    },
  );
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", origin + "/api/auth/github/callback");
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
