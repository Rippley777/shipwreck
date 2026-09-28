import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify, createHash } from "node:crypto";
import {
  GitHubAppClient,
  type GitHubRequest,
} from "../src/lib/server/github-app-client";
import {
  signAppJWT,
  pkce,
  type AppOAuthToken,
} from "../src/lib/server/github-app-config";
import {
  appUserToken,
  type AppConnection,
  type ConnectionStore,
} from "../src/lib/server/github-app-connection";
import { encrypt } from "../src/lib/server/auth";
import {
  validateAppFlow,
  type AppFlow,
} from "../src/lib/server/github-app-flow";
Object.assign(process.env, {
  GITHUB_APP_ID: "42",
  GITHUB_APP_SLUG: "shipwreck-test",
  GITHUB_APP_CLIENT_ID: "Iv1.test",
  GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  GITHUB_APP_PRIVATE_KEY: "test-key",
  TOKEN_ENCRYPTION_KEY: "b".repeat(64),
});
const installation = {
  id: 123,
  app_id: 42,
  account: { login: "private-org" },
  suspended_at: null,
  permissions: { contents: "read", metadata: "read" },
};
const repository = {
  id: 456,
  full_name: "private-org/service",
  default_branch: "main",
  private: true,
};
const issued = {
  token: "installation-token",
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  permissions: { contents: "read", metadata: "read" },
};
type Call = {
  route: string;
  token?: string;
  options?: Parameters<GitHubRequest>[2];
};
function remote(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  const request: GitHubRequest = async <T>(
    route: string,
    token?: string,
    options?: Parameters<GitHubRequest>[2],
  ) => {
    const call = { route, token, options };
    calls.push(call);
    return (await handler(call)) as T;
  };
  return { request, calls };
}
function normal(call: Call) {
  if (call.route === "/repos/private-org/service") return repository;
  if (call.route.endsWith("/installation")) return installation;
  if (call.route.endsWith("/access_tokens")) return issued;
  if (call.route === "/installation/token") return undefined;
  throw new Error("Unexpected API call: " + call.route);
}
test("App JWT uses RS256, backdated issuance, and an expiry below ten minutes", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const token = signAppJWT("Iv1.app", key, 1000);
  const [header, payload, signature] = token.split(".");
  assert.equal(
    JSON.parse(Buffer.from(header, "base64url").toString()).alg,
    "RS256",
  );
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
    iat: 940,
    exp: 1540,
    iss: "Iv1.app",
  });
  assert.ok(
    verify(
      "RSA-SHA256",
      Buffer.from(header + "." + payload),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  );
  assert.throws(
    () => signAppJWT("app", "not a private key"),
    /private key is invalid/,
  );
});
test("PKCE challenge matches a cryptographically random verifier", () => {
  const first = pkce();
  assert.equal(
    first.challenge,
    createHash("sha256").update(first.verifier).digest("base64url"),
  );
  assert.notEqual(first.verifier, pkce().verifier);
  assert.ok(first.verifier.length >= 43);
});
test("callback state is encrypted and bound to session, purpose, expiry and PKCE", () => {
  const flow: AppFlow = {
    state: "s".repeat(64),
    userId: "alice",
    purpose: "authorize",
    expiresAt: Date.now() + 60000,
    verifier: "v".repeat(43),
  };
  const cookie = encrypt(JSON.stringify(flow));
  assert.deepEqual(
    validateAppFlow(cookie, flow.state, "alice", "authorize"),
    flow,
  );
  assert.throws(() => validateAppFlow(cookie, "other", "alice", "authorize"));
  assert.throws(() => validateAppFlow(cookie, flow.state, "bob", "authorize"));
  assert.throws(() => validateAppFlow(cookie, flow.state, "alice", "install"));
  assert.throws(() =>
    validateAppFlow(
      encrypt(JSON.stringify({ ...flow, expiresAt: 0 })),
      flow.state,
      "alice",
      "authorize",
    ),
  );
  assert.throws(() =>
    validateAppFlow(
      cookie.slice(0, -4) + "abcd",
      flow.state,
      "alice",
      "authorize",
    ),
  );
  assert.throws(() =>
    validateAppFlow(
      encrypt(JSON.stringify({ ...flow, verifier: undefined })),
      flow.state,
      "alice",
      "authorize",
    ),
  );
});
test("private repository token validates user access first and scopes issuance to one read-only repository", async () => {
  const mock = remote(normal);
  const client = new GitHubAppClient(
    mock.request,
    async () => "app-jwt",
    () => "42",
  );
  assert.equal(
    await client.repositoryToken(
      "alice-user-token",
      repository.full_name,
      "123",
    ),
    issued.token,
  );
  assert.equal(mock.calls[0].token, "alice-user-token");
  assert.equal(mock.calls[1].token, "app-jwt");
  assert.deepEqual(mock.calls[2], {
    route: "/app/installations/123/access_tokens",
    token: "app-jwt",
    options: {
      method: "POST",
      body: { repository_ids: [456], permissions: { contents: "read" } },
    },
  });
  await client.revoke(issued.token);
  assert.deepEqual(mock.calls[3], {
    route: "/installation/token",
    token: issued.token,
    options: { method: "DELETE" },
  });
});
test("an unauthorized user cannot use an installed App to read another account", async () => {
  const mock = remote((call) => {
    if (call.route === `/repos/${repository.full_name}`)
      throw new Error("Repository not found.");
    return normal(call);
  });
  let signed = false;
  const client = new GitHubAppClient(
    mock.request,
    async () => {
      signed = true;
      return "jwt";
    },
    () => "42",
  );
  await assert.rejects(
    client.repositoryToken("bob-user-token", repository.full_name, "123"),
  );
  assert.equal(mock.calls.length, 1);
  assert.equal(signed, false);
});
test("forged installation IDs, another App, suspended installations and missing contents permission fail before token issuance", async () => {
  for (const changed of [
    { ...installation, id: 999 },
    { ...installation, app_id: 99 },
    { ...installation, suspended_at: "2026-01-01" },
    { ...installation, permissions: { metadata: "read" } },
  ]) {
    const mock = remote((call) =>
      call.route.endsWith("/installation") ? changed : normal(call),
    );
    const client = new GitHubAppClient(
      mock.request,
      async () => "jwt",
      () => "42",
    );
    await assert.rejects(
      client.repositoryToken("user-token", repository.full_name, "123"),
      /cannot access/,
    );
    assert.ok(!mock.calls.some((c) => c.route.endsWith("/access_tokens")));
  }
});
test("revoked user authorization fails before minting a new installation token", async () => {
  const mock = remote(() => {
    throw new Error("GitHub authorization expired or was revoked.");
  });
  const client = new GitHubAppClient(
    mock.request,
    async () => "jwt",
    () => "42",
  );
  await assert.rejects(
    client.repositoryToken("revoked", repository.full_name, "123"),
    /revoked/,
  );
  assert.equal(mock.calls.length, 1);
});
test("expired or excessively privileged installation tokens are rejected", async () => {
  for (const changed of [
    { ...issued, expires_at: "invalid" },
    { ...issued, expires_at: new Date(0).toISOString() },
    { ...issued, permissions: { contents: "write" } },
  ]) {
    const mock = remote((call) =>
      call.route.endsWith("/access_tokens") ? changed : normal(call),
    );
    const client = new GitHubAppClient(
      mock.request,
      async () => "jwt",
      () => "42",
    );
    await assert.rejects(
      client.repositoryToken("user", repository.full_name, "123"),
      /read-only/,
    );
  }
});
test("installation and repository pagination retain only accessible installations for the configured App", async () => {
  const filler = Array.from({ length: 99 }, (_, i) => ({
    ...installation,
    id: 1000 + i,
    app_id: 9,
  }));
  const mock = remote((call) => {
    if (call.route === "/user/installations?per_page=100&page=1")
      return {
        total_count: 101,
        installations: [
          ...filler,
          { ...installation, suspended_at: "2026-01-01" },
        ],
      };
    if (call.route === "/user/installations?per_page=100&page=2")
      return { total_count: 101, installations: [installation] };
    if (
      call.route === "/user/installations/123/repositories?per_page=100&page=1"
    )
      return {
        total_count: 101,
        repositories: Array.from({ length: 100 }, (_, i) => ({
          ...repository,
          id: i + 1,
          full_name: "private-org/repo-" + i,
        })),
      };
    if (
      call.route === "/user/installations/123/repositories?per_page=100&page=2"
    )
      return { total_count: 101, repositories: [repository] };
    throw new Error("Unexpected route");
  });
  const client = new GitHubAppClient(
    mock.request,
    async () => "jwt",
    () => "42",
  );
  const repos = await client.repositories("user-token");
  assert.equal(repos.length, 101);
  assert.equal(repos.at(-1)?.private, true);
  assert.ok(repos.every((r) => r.installation_id === "123"));
  assert.ok(mock.calls.every((c) => c.token === "user-token"));
});
function connection(overrides: Partial<AppConnection> = {}): AppConnection {
  return {
    user_id: "alice",
    app_id: "42",
    github_user_id: "7",
    login: "alice",
    encrypted_token: encrypt("old-user-token"),
    encrypted_refresh_token: encrypt("old-refresh-token"),
    expires_at: new Date(Date.now() - 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
  };
}
function memoryStore(initial: AppConnection | null) {
  let data = initial;
  let locked: string | null = null;
  let releases = 0;
  const store: ConnectionStore = {
    async get(id) {
      return data?.user_id === id ? data : null;
    },
    async claim(_id, lock) {
      if (locked) return false;
      locked = lock;
      return true;
    },
    async finish(_id, lock, token) {
      if (!data || locked !== lock) return false;
      data = {
        ...data,
        encrypted_token: encrypt(token.access_token),
        encrypted_refresh_token: token.refresh_token
          ? encrypt(token.refresh_token)
          : null,
        expires_at: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000).toISOString()
          : null,
      };
      locked = null;
      return true;
    },
    async release(_id, lock) {
      releases++;
      if (locked === lock) locked = null;
    },
  };
  return {
    store,
    disconnect() {
      data = null;
    },
    releases: () => releases,
  };
}
const fresh: AppOAuthToken = {
  access_token: "fresh-user-token",
  token_type: "bearer",
  expires_in: 28800,
  refresh_token: "fresh-refresh-token",
  refresh_token_expires_in: 15897600,
};
test("expired user token is refreshed and the encrypted rotated credentials are reused", async () => {
  const memory = memoryStore(connection());
  let exchanges = 0;
  const exchange = async (fields: Record<string, string>) => {
    exchanges++;
    assert.deepEqual(fields, {
      grant_type: "refresh_token",
      refresh_token: "old-refresh-token",
    });
    return fresh;
  };
  assert.equal(
    await appUserToken("alice", memory.store, exchange),
    "fresh-user-token",
  );
  assert.equal(
    await appUserToken("alice", memory.store, exchange),
    "fresh-user-token",
  );
  assert.equal(exchanges, 1);
  assert.equal(memory.releases(), 1);
});
test("missing, wrong-App or expired refresh credentials require reconnecting without provider calls", async () => {
  for (const value of [
    null,
    connection({ app_id: "99" }),
    connection({ encrypted_refresh_token: null }),
    connection({ refresh_expires_at: new Date(0).toISOString() }),
  ]) {
    let called = false;
    const memory = memoryStore(value);
    await assert.rejects(
      appUserToken("alice", memory.store, async () => {
        called = true;
        return fresh;
      }),
    );
    assert.equal(called, false);
  }
});
test("a concurrent refresh cannot reuse a rotating refresh token", async () => {
  const memory = memoryStore(connection());
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const exchange = async () => {
    calls++;
    start();
    await gate;
    return fresh;
  };
  const first = appUserToken("alice", memory.store, exchange);
  await started;
  await assert.rejects(
    appUserToken("alice", memory.store, exchange),
    /being refreshed/,
  );
  finish();
  assert.equal(await first, "fresh-user-token");
  assert.equal(calls, 1);
});
test("disconnect during refresh cannot restore deleted credentials", async () => {
  const memory = memoryStore(connection());
  await assert.rejects(
    appUserToken("alice", memory.store, async () => {
      memory.disconnect();
      return fresh;
    }),
    /connection changed/,
  );
  assert.equal(await memory.store.get("alice"), null);
});
test("failed provider refresh releases its lease for a later retry", async () => {
  const memory = memoryStore(connection());
  await assert.rejects(
    appUserToken("alice", memory.store, async () => {
      throw new Error("provider unavailable");
    }),
    /provider unavailable/,
  );
  assert.equal(
    await appUserToken("alice", memory.store, async () => fresh),
    "fresh-user-token",
  );
  assert.equal(memory.releases(), 2);
});
test("installation token is revoked even when repository ingestion fails", async () => {
  const mock = remote(normal);
  const client = new GitHubAppClient(
    mock.request,
    async () => "jwt",
    () => "42",
  );
  await assert.rejects(
    client.withRepository(
      "user",
      repository.full_name,
      "123",
      async (token) => {
        assert.equal(token, issued.token);
        throw new Error("ingestion failed");
      },
    ),
    /ingestion failed/,
  );
  assert.equal(mock.calls.at(-1)?.route, "/installation/token");
  assert.equal(mock.calls.at(-1)?.options?.method, "DELETE");
});
test("read-only contents with unrelated write permissions is rejected", async () => {
  const mock = remote((call) =>
    call.route.endsWith("/access_tokens")
      ? { ...issued, permissions: { contents: "read", issues: "write" } }
      : normal(call),
  );
  const client = new GitHubAppClient(
    mock.request,
    async () => "jwt",
    () => "42",
  );
  await assert.rejects(
    client.repositoryToken("user", repository.full_name, "123"),
    /read-only/,
  );
  assert.equal(mock.calls.at(-1)?.route, "/installation/token");
});
test("GitHub App migration preserves existing projects and supports idempotent upgrades", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const db = new PGlite();
  try {
    await db.exec(await readFile("migrations/001_initial.sql", "utf8"));
    await db.query(
      "INSERT INTO users(id,email,name) VALUES('user','user@example.com','Captain')",
    );
    await db.query(
      "INSERT INTO projects(id,user_id,name,repository,source) VALUES('project','user','Existing project','org/repo','github')",
    );
    const migration = await readFile("migrations/002_github_app.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const rows = await db.query<{
      name: string;
      github_installation_id: string | null;
    }>("SELECT name,github_installation_id FROM projects");
    assert.equal(rows.rows[0].name, "Existing project");
    assert.equal(rows.rows[0].github_installation_id, null);
    await db.query(
      "INSERT INTO github_app_connections(user_id,app_id,github_user_id,login,encrypted_token) VALUES('user','42','7','captain','encrypted')",
    );
    await db.query("DELETE FROM users WHERE id='user'");
    assert.equal(
      (await db.query("SELECT * FROM github_app_connections")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
