import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const origin = "http://127.0.0.1:3107";
const password = "authentication-regression-password";
const headers = { Origin: origin };
async function signup(request: APIRequestContext) {
  const email = `${randomUUID()}@example.test`;
  const response = await request.post("/api/auth/signup", {
    headers,
    data: { email, name: "Test account", password },
  });
  expect(response.status()).toBe(200);
  return { email, cookie: response.headers()["set-cookie"].split(";")[0] };
}

test("anonymous, forged, malformed, and expired sessions cannot read or mutate protected resources", async ({
  request,
}) => {
  for (const token of [
    undefined,
    "a".repeat(64),
    "malformed",
    "e".repeat(64),
  ]) {
    const cookie: Record<string, string> = token
      ? { Cookie: `shipwreck_session=${token}` }
      : {};
    // Preserve the existing anonymous GET contract, including workspace bootstrap.
    for (const route of [
      "workspace",
      "repositories",
      "branches",
      "github/app/installations",
    ]) {
      const response = await request.get(`/api/${route}`, { headers: cookie });
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ user: null, demoEnabled: false });
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
    for (const route of [
      "projects",
      "projects/update",
      "projects/delete",
      "scans",
      "github/app/disconnect",
    ]) {
      const response = await request.post(`/api/${route}`, {
        headers: { ...headers, ...cookie },
        data: {},
      });
      expect(response.status()).toBe(401);
    }
  }
});

test("signup establishes identity; invalid login fails; valid login succeeds; logout revokes the token", async ({
  request,
  playwright,
}) => {
  const { email, cookie } = await signup(request);
  const state = await (await request.get("/api/workspace")).json();
  expect(state.user.email).toBe(email);
  expect(state.user).not.toHaveProperty("password_hash");
  expect(state.projects).toEqual([]);
  const stored = (await request.storageState()).cookies.find(
    (c) => c.name === "shipwreck_session",
  )!;
  expect(stored.httpOnly).toBe(true);
  expect(stored.sameSite).toBe("Lax");
  expect(stored.path).toBe("/");
  expect(stored.value).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (await request.post("/api/auth/logout", { headers, data: {} })).status(),
  ).toBe(200);
  const replay = await request.post("/api/projects/delete", {
    headers: { ...headers, Cookie: cookie },
    data: { id: randomUUID() },
  });
  expect(replay.status()).toBe(401);

  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    for (const input of [
      { email, password: "wrong-password-long-enough" },
      { email: "unknown@example.test", password },
    ]) {
      const response = await client.post("/api/auth/login", {
        headers,
        data: input,
      });
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({
        error: "Email or password is incorrect.",
      });
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
    expect(
      (
        await client.post("/api/auth/login", {
          headers,
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    expect((await (await client.get("/api/workspace")).json()).user.id).toBe(
      state.user.id,
    );
  } finally {
    await client.dispose();
  }
});

test("projects remain isolated between real accounts", async ({
  request,
  playwright,
}) => {
  await signup(request);
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    await signup(other);
    const project = {
      name: "Owned project",
      repository: "octocat/Hello-World",
      branch: "main",
    };
    const create = await request.post("/api/projects", {
      headers,
      data: project,
    });
    expect(create.status()).toBe(200);
    const { id } = await create.json();
    expect((await (await other.get("/api/workspace")).json()).projects).toEqual(
      [],
    );
    expect(
      (
        await other.post("/api/scans", { headers, data: { projectId: id } })
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.post("/api/projects/update", {
          headers,
          data: { ...project, id, name: "Stolen" },
        })
      ).status(),
    ).toBe(404);
    // Deletion deliberately returns an idempotent success; ownership must still hold.
    expect(
      (
        await other.post("/api/projects/delete", { headers, data: { id } })
      ).status(),
    ).toBe(200);
    let own = (await (await request.get("/api/workspace")).json()).projects;
    expect(own.map((p: { id: string }) => p.id)).toEqual([id]);
    expect(own[0].name).toBe(project.name);
    expect(
      (
        await request.post("/api/projects/update", {
          headers,
          data: { ...project, id, name: "Updated" },
        })
      ).status(),
    ).toBe(200);
    own = (await (await request.get("/api/workspace")).json()).projects;
    expect(own[0].name).toBe("Updated");
    expect(
      (
        await request.post("/api/projects/delete", { headers, data: { id } })
      ).status(),
    ).toBe(200);
    expect(
      (await (await request.get("/api/workspace")).json()).projects,
    ).toEqual([]);
  } finally {
    await other.dispose();
  }
});

test("missing/cross-site origins cannot write and production demo login is disabled", async ({
  request,
}) => {
  await signup(request);
  for (const origin of [undefined, "https://evil.example"]) {
    const response = await request.post("/api/projects/delete", {
      headers: origin ? { Origin: origin } : {},
      data: { id: randomUUID() },
    });
    expect(response.status()).toBe(403);
  }
  expect(
    (await request.post("/api/auth/demo", { headers, data: {} })).status(),
  ).toBe(403);
});

test("scan history is visible only to its owner", async ({
  request,
  playwright,
}) => {
  await signup(request);
  const owner = await playwright.request.newContext({ baseURL: origin });
  try {
    expect(
      (
        await owner.post("/api/auth/login", {
          headers,
          data: { email: "expired@example.test", password },
        })
      ).status(),
    ).toBe(200);
    const workspace = await (await owner.get("/api/workspace")).json();
    expect(workspace.projects[0].history[0].report.marker).toBe(
      "private-scan-evidence",
    );
    const foreign = await request.get("/api/workspace");
    expect(await foreign.text()).not.toContain("private-scan-evidence");
    expect(
      (
        await request.post("/api/scans", {
          headers,
          data: { projectId: workspace.projects[0].id },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await owner.dispose();
  }
});

test("repeated invalid credentials are rate limited without issuing a session", async ({
  request,
}) => {
  const email = `${randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 12; attempt++) {
    expect(
      (
        await request.post("/api/auth/login", {
          headers,
          data: { email, password },
        })
      ).status(),
    ).toBe(401);
  }
  const response = await request.post("/api/auth/login", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({
    error: "Too many requests. Please try again later.",
  });
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

test("OAuth redirect carries state; missing/mismatched callback state creates no session", async ({
  request,
}) => {
  const response = await request.get("/api/auth/github", { maxRedirects: 0 });
  const target = new URL(response.headers().location);
  expect(target.origin).toBe("https://github.com");
  expect(target.searchParams.get("client_id")).toBe("test-oauth-client");
  expect(target.searchParams.get("redirect_uri")).toBe(
    `${origin}/api/auth/github/callback`,
  );
  expect(target.searchParams.get("scope")).toBe("read:user");
  expect(target.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
  for (const url of [
    "/api/auth/github/callback?code=fake&state=wrong",
    "/api/auth/github/callback",
  ]) {
    const callback = await request.get(url, { maxRedirects: 0 });
    expect(callback.headers().location).toBe(
      `${origin}/?error=github-connection-failed`,
    );
    expect(
      (await (await request.get("/api/workspace")).json()).user,
    ).toBeNull();
  }
});
