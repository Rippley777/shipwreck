import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { query } from "./db";
const scrypt = promisify(scryptCallback);
export type User = { id: string; email: string; name: string; demo: boolean };
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function passwordValid(password: string, stored: string) {
  const [salt, value] = stored.split(":");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, "hex");
  return expected.length === key.length && timingSafeEqual(expected, key);
}
export async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await query(
    "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)",
    [hash(token), userId, new Date(Date.now() + 7 * 86400_000)],
  );
  (await cookies()).set("shipwreck_session", token, {
    httpOnly: true,
    secure: process.env.APP_URL?.startsWith("https:") ?? false,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get("shipwreck_session")?.value;
  if (!token) return null;
  const rows = await query<User>(
    "SELECT u.id,u.email,u.name,u.demo FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at > NOW()",
    [hash(token)],
  );
  return rows[0] ?? null;
}
export async function logout() {
  const token = (await cookies()).get("shipwreck_session")?.value;
  if (token)
    await query("DELETE FROM sessions WHERE token_hash=$1", [hash(token)]);
  (await cookies()).delete("shipwreck_session");
}
export async function createUser(
  email: string,
  name: string,
  password?: string,
  demo = false,
) {
  const id = randomUUID();
  await query(
    "INSERT INTO users (id,email,name,password_hash,demo) VALUES ($1,$2,$3,$4,$5)",
    [id, email, name, password ? await passwordHash(password) : null, demo],
  );
  return id;
}
function encryptionKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[\da-f]{64}$/i.test(key))
    throw new Error(
      "GitHub connection requires TOKEN_ENCRYPTION_KEY (32 bytes, hex).",
    );
  return Buffer.from(key, "hex");
}
export function encrypt(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("hex"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((v) => Buffer.from(v, "hex"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const rows = await query<{ hits: number }>(
    `INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,NOW()+($2 * INTERVAL '1 second')) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at < NOW() THEN 1 ELSE rate_limits.hits+1 END, reset_at=CASE WHEN rate_limits.reset_at < NOW() THEN NOW()+($2 * INTERVAL '1 second') ELSE rate_limits.reset_at END RETURNING hits`,
    [key, windowSeconds],
  );
  if (rows[0].hits > limit)
    throw new Error("Too many requests. Please try again later.");
}
