import { query } from "./lib/server/db";
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");
await query("DELETE FROM sessions WHERE expires_at < NOW()");
await query("DELETE FROM rate_limits WHERE reset_at < NOW()");
const deleted = await query<{ id: string }>(
  "DELETE FROM users WHERE demo=TRUE AND created_at < NOW() - INTERVAL '7 days' AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.user_id=users.id AND expires_at>NOW()) RETURNING id",
);
console.log(
  `Expired sessions and rate-limit records removed. ${deleted.length} inactive demo workspaces removed.`,
);
process.exit(0);
