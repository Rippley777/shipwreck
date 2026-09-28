import { createHash, randomBytes, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
export function githubAppConfigured() {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_SLUG &&
    process.env.GITHUB_APP_CLIENT_ID &&
    process.env.GITHUB_APP_CLIENT_SECRET &&
    (process.env.GITHUB_APP_PRIVATE_KEY ||
      process.env.GITHUB_APP_PRIVATE_KEY_PATH) &&
    /^[a-f\d]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY || "")
  );
}
export function githubAppConfig() {
  if (!githubAppConfigured())
    throw new Error(
      "Configure GitHub App credentials and token encryption before connecting private repositories.",
    );
  return {
    id: z
      .string()
      .regex(/^[1-9]\d*$/)
      .parse(process.env.GITHUB_APP_ID),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .parse(process.env.GITHUB_APP_SLUG),
    clientId: process.env.GITHUB_APP_CLIENT_ID!,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
  };
}
export function signAppJWT(
  issuer: string,
  key: string,
  now = Math.floor(Date.now() / 1000),
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: issuer }),
  ).toString("base64url");
  const message = header + "." + payload;
  try {
    return (
      message +
      "." +
      sign("RSA-SHA256", Buffer.from(message), key).toString("base64url")
    );
  } catch {
    throw new Error("The configured GitHub App private key is invalid.");
  }
}
export async function appJWT() {
  const config = githubAppConfig();
  const key =
    process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n") ||
    (await readFile(process.env.GITHUB_APP_PRIVATE_KEY_PATH!, "utf8"));
  return signAppJWT(config.clientId, key);
}
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
export const appTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("bearer"),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});
export type AppOAuthToken = z.infer<typeof appTokenSchema>;
export async function exchangeAppToken(
  fields: Record<string, string>,
): Promise<AppOAuthToken> {
  const config = githubAppConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...fields,
    }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const parsed = appTokenSchema.safeParse(await response.json());
  if (!response.ok || !parsed.success)
    throw new Error(
      "GitHub App authorization could not be renewed. Reconnect the GitHub App.",
    );
  if (parsed.data.expires_in && !parsed.data.refresh_token)
    throw new Error(
      "GitHub returned an expiring token without a refresh token. Reconnect the GitHub App.",
    );
  return parsed.data;
}
