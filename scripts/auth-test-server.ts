// Disposable production-mode server for authentication regression tests.
// Never uses .env credentials or the developer/production database.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";

const directory = await mkdtemp(path.join(tmpdir(), "shipwreck-auth-"));
const demo = process.argv.includes("--demo");
const port = demo ? "3108" : "3107";
const pg = new PGlite(directory);
for (const name of (await readdir("migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await pg.exec(await readFile(path.join("migrations", name), "utf8"));
const salt = randomBytes(16).toString("hex");
await pg.query(
  "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
  [
    "expired-test-user",
    "expired@example.test",
    "Expired session",
    salt +
      ":" +
      scryptSync("authentication-regression-password", salt, 64).toString(
        "hex",
      ),
  ],
);
await pg.query(
  "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW() - INTERVAL '1 day')",
  [
    createHash("sha256").update("e".repeat(64)).digest("hex"),
    "expired-test-user",
  ],
);
await pg.query(
  "INSERT INTO projects(id,user_id,name,repository,source) VALUES($1,$2,$3,$4,$5)",
  [
    "11111111-1111-4111-8111-111111111111",
    "expired-test-user",
    "Private project",
    "private/repository",
    "demo",
  ],
);
await pg.query("INSERT INTO scans(id,project_id,report) VALUES($1,$2,$3)", [
  "seed-scan",
  "11111111-1111-4111-8111-111111111111",
  JSON.stringify({ results: [], marker: "private-scan-evidence" }),
]);
await pg.close();

const child = spawn(
  process.execPath,
  [
    "--import",
    path.resolve("scripts/auth-test-github.mjs"),
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_URL: `http://127.0.0.1:${port}`,
      DATABASE_URL: "",
      EMBEDDED_DATABASE_PATH: directory,
      ENABLE_DEMO: String(demo),
      TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      // Fake IDs exercise redirect/state construction without contacting GitHub.
      GITHUB_CLIENT_ID: "test-oauth-client",
      GITHUB_CLIENT_SECRET: "test-oauth-secret",
      GITHUB_APP_ID: "",
      GITHUB_APP_SLUG: "",
      GITHUB_APP_CLIENT_ID: "",
      GITHUB_APP_CLIENT_SECRET: "",
      GITHUB_APP_PRIVATE_KEY: "",
      GITHUB_APP_PRIVATE_KEY_PATH: "",
    },
  },
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => child.kill(signal));
child.on("exit", async (code) => {
  await rm(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
