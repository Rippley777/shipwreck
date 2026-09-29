import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authentication } from "../src/lib/scanner/authentication";

const source = await readFile(
  new URL("../src/lib/server/auth.ts", import.meta.url),
  "utf8",
);
test("custom authentication has evidence without claiming runtime verification", () => {
  const result = authentication.run({
    files: { "src/server/auth.ts": source },
  });
  assert.equal(result.status, "passed");
  assert.equal(result.confidence, "medium");
  assert.match(result.message, /does not verify runtime/);
  assert.ok(result.evidence.length >= 5);
  assert.ok(
    result.evidence.every((e) => e.file === "src/server/auth.ts" && e.line),
  );
  assert.ok(!JSON.stringify(result).includes("shipwreck_session"));
});

test("missing or partial authentication remains a verification gap", () => {
  for (const content of [
    "",
    "const session = cookies().get('session');",
    source.replace(/expires_at > NOW\(\)/g, "TRUE"),
    source.replace(/DELETE FROM sessions/g, "SELECT * FROM sessions"),
  ]) {
    const result = authentication.run({ files: { "auth.ts": content } });
    assert.equal(result.status, "unverified");
  }
});

test("docs, fixtures, environment names, and scanner patterns are not provider configuration", async () => {
  const result = authentication.run({
    files: {
      "README.md": "Use next-auth or express-session for authentication.",
      ".env.example": "GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=",
      "tests/auth.test.ts": source,
      "src/rules.ts":
        "const pattern = /next-auth|@auth\\/|@clerk|express-session/;",
      "src/lib/scanner/authentication.ts": await readFile(
        new URL("../src/lib/scanner/authentication.ts", import.meta.url),
        "utf8",
      ),
    },
  });
  assert.equal(result.status, "unverified");
});

test("existing library dependencies and imports remain recognized", () => {
  const examples: Record<string, string>[] = [
    { "package.json": JSON.stringify({ dependencies: { "next-auth": "5" } }) },
    { "auth.ts": 'import { auth } from "@clerk/nextjs/server";' },
  ];
  for (const files of examples)
    assert.equal(authentication.run({ files }).status, "passed");
  assert.equal(
    authentication.run({ files: { "package.json": "{" } }).status,
    "unverified",
  );
});
