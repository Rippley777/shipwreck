import test from "node:test";
import assert from "node:assert/strict";
import { scan, fixPrompt } from "../src/lib/scanner/index";
import { checks } from "../src/lib/scanner/checks";
import { environment } from "../src/lib/scanner/analyze";
import { demoFiles } from "../src/lib/demo";
import { isPublicIP, inspectURL } from "../src/lib/server/production";
import {
  passwordHash,
  passwordValid,
  encrypt,
  decrypt,
} from "../src/lib/server/auth";
const result = (files: Record<string, string>, id: string) =>
  scan({ files }).results.find((r) => r.id === id)!;
test("check library has unique stable IDs and required fields", () => {
  assert.ok(checks.length >= 25);
  assert.equal(new Set(checks.map((c) => c.id)).size, checks.length);
  for (const check of checks) {
    assert.ok(check.why);
    assert.ok(check.fix);
    assert.ok(check.category);
  }
});
test("demo produces evidence-backed findings and deterministic output", () => {
  const a = scan({ files: demoFiles });
  const b = scan({ files: demoFiles });
  assert.deepEqual(a.results, b.results);
  assert.equal(a.status, "Needs Attention");
  assert.equal(a.counts.critical, 2);
  assert.ok(
    a.environment.find(
      (e) => e.name === "STRIPE_WEBHOOK_SECRET" && !e.documented,
    ),
  );
  for (const r of a.results.filter(
    (r) => r.status === "failed" || r.status === "unverified",
  ))
    assert.ok(r.evidence.length, r.id);
});
test("backup absence is uncertainty, never a confirmed vulnerability", () => {
  const r = result(
    { "db.ts": "const db = process.env.DATABASE_URL" },
    "database.backups",
  );
  assert.equal(r.status, "unverified");
  assert.equal(
    result({ "app.ts": "hello" }, "database.backups").status,
    "not_applicable",
  );
});
test("ownership pattern is flagged conservatively", () => {
  const vulnerable = result(
    { "route.ts": "db.project.findUnique({ where: { id: params.id } });" },
    "auth.ownership",
  );
  assert.equal(vulnerable.status, "unverified");
  assert.equal(vulnerable.confidence, "medium");
  const healthy = result(
    {
      "route.ts":
        "db.project.findUnique({ where: { id_ownerId: { id: params.id, ownerId: session.user.id } } });",
    },
    "auth.ownership",
  );
  assert.equal(healthy.status, "passed");
});
test("credential content is never included in evidence or fix prompts", () => {
  const secret = "ghp_" + "a".repeat(36);
  const r = result(
    { "config.ts": `const key = '${secret}';` },
    "security.secrets",
  );
  assert.equal(r.status, "failed");
  assert.equal(r.evidence[0].line, 1);
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.ok(!fixPrompt(r).includes(secret));
});
test("public secrets and disabled TLS block launch", () => {
  const report = scan({
    files: {
      "app.ts":
        "const db = process.env.NEXT_PUBLIC_DATABASE_URL;\nconst client={rejectUnauthorized:false};",
    },
  });
  assert.equal(report.status, "Launch Blocked");
  assert.equal(
    report.results.find((r) => r.id === "security.public-secret")?.status,
    "failed",
  );
});
test("destructive migrations have a healthy counterpart", () => {
  assert.equal(
    result(
      { "migrations/1.sql": "DROP TABLE customers;" },
      "database.destructive",
    ).status,
    "failed",
  );
  assert.equal(
    result(
      { "migrations/1.sql": "ALTER TABLE customers ADD COLUMN nickname TEXT;" },
      "database.destructive",
    ).status,
    "passed",
  );
});
test("environment collects dot, bracket, Vite, Python, Docker and CI references", () => {
  const vars = environment({
    files: {
      "a.ts": `process.env.API_KEY; process.env['TOKEN']; import.meta.env.VITE_HOST; process.env.OPTIONAL ?? 'default';`,
      "a.py": `os.environ['PY_SECRET']`,
      Dockerfile: "ENV NODE_ENV=production\nARG BUILD_KEY",
      ".github/workflows/ci.yml": "TOKEN: ${{ secrets.CI_TOKEN }}",
      ".env.example": "API_KEY=\nTOKEN=\n",
    },
  });
  for (const name of [
    "API_KEY",
    "TOKEN",
    "VITE_HOST",
    "PY_SECRET",
    "NODE_ENV",
    "BUILD_KEY",
    "CI_TOKEN",
  ])
    assert.ok(
      vars.find((v) => v.name === name),
      name,
    );
  assert.equal(vars.find((v) => v.name === "OPTIONAL")?.optional, true);
  assert.equal(vars.find((v) => v.name === "API_KEY")?.secret, true);
});
test("dotenv values are not emitted", () => {
  const report = scan({
    files: {
      ".env": "DATABASE_URL=postgres://private:password@server/private",
    },
  });
  assert.equal(
    report.results.find((r) => r.id === "environment.committed")?.status,
    "failed",
  );
  assert.ok(!JSON.stringify(report).includes("private:password"));
});
test("final Docker stage determines user check", () => {
  const healthy = {
    Dockerfile: "FROM node:22 AS build\nRUN npm ci\nFROM node:22\nUSER node",
  };
  assert.equal(result(healthy, "deployment.container-user").status, "passed");
  assert.equal(
    result(
      { Dockerfile: "FROM node:22 AS build\nUSER node\nFROM node:22" },
      "deployment.container-user",
    ).status,
    "failed",
  );
});
test("Stripe verifies recognized calls and marks helper ambiguity unverified", () => {
  assert.equal(
    result(
      { "api/webhook.ts": "stripe.webhooks.constructEvent(body, sig, secret)" },
      "integrations.stripe",
    ).status,
    "passed",
  );
  assert.equal(
    result(
      { "api/webhook.ts": "stripe; helper.validate(body)" },
      "integrations.stripe",
    ).status,
    "unverified",
  );
});
test("URL observations and missing cookies reflect evidence", () => {
  const r = scan({
    files: {},
    observation: {
      url: "https://example.com",
      status: 200,
      headers: {
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
      },
      cookies: [],
    },
  });
  assert.equal(r.results.find((r) => r.id === "url.https")?.status, "passed");
  assert.equal(
    r.results.find((r) => r.id === "url.cookies")?.status,
    "unverified",
  );
});
test("unreachable deployments do not invent HTTP failures", () => {
  const r = scan({
    files: {},
    observation: {
      url: "https://example.com",
      error: "Request timed out.",
      headers: {},
      cookies: [],
    },
  });
  assert.ok(
    r.results
      .filter((r) => r.id.startsWith("url."))
      .every((r) => r.status === "unverified"),
  );
});
test("SSRF classification blocks private, loopback, mapped, multicast and reserved addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "224.0.0.1",
    "100.64.0.1",
    "192.0.2.1",
  ])
    assert.equal(isPublicIP(address), false, address);
  assert.equal(isPublicIP("8.8.8.8"), true);
  assert.equal(isPublicIP("2606:4700:4700::1111"), true);
});
test("URL inspection rejects local targets and unsupported protocols", async () => {
  for (const url of [
    "http://127.0.0.1",
    "http://[::1]",
    "file:///etc/passwd",
    "http://example.com:8080",
  ]) {
    const result = await inspectURL(url);
    assert.ok(result.error, url);
    assert.equal(result.status, undefined);
  }
});
test("password storage is salted and validates correctly", async () => {
  const first = await passwordHash("correct horse battery staple");
  const second = await passwordHash("correct horse battery staple");
  assert.notEqual(first, second);
  assert.ok(await passwordValid("correct horse battery staple", first));
  assert.ok(!(await passwordValid("wrong password", first)));
});
test("provider token encryption is authenticated", () => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  const encrypted = encrypt("private-token");
  assert.ok(!encrypted.includes("private-token"));
  assert.equal(decrypt(encrypted), "private-token");
  const pieces = encrypted.split(".");
  pieces[2] = "00" + pieces[2].slice(2);
  assert.throws(() => decrypt(pieces.join(".")));
});
test("fix prompt preserves uncertainty and asks for regression tests", () => {
  const r = result({ "db.ts": "process.env.DATABASE_URL" }, "database.backups");
  const prompt = fixPrompt(r);
  assert.match(prompt, /not a confirmed vulnerability/);
  assert.match(prompt, /regression tests/);
});
test("security fixtures do not become launch blockers", () => {
  const report = scan({
    files: {
      "tests/config.test.ts":
        "process.env.NEXT_PUBLIC_DATABASE_URL; rejectUnauthorized:false;",
      "src/config.ts": "process.env.PUBLIC_URL",
    },
  });
  assert.equal(
    report.results.find((r) => r.id === "security.public-secret")?.status,
    "passed",
  );
  assert.equal(
    report.results.find((r) => r.id === "security.tls")?.status,
    "passed",
  );
  assert.ok(
    !report.environment.find((v) => v.name === "NEXT_PUBLIC_DATABASE_URL"),
  );
});
