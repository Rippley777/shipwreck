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

test("GitHub cannot sign in or create an account anonymously", async ({
  request,
}) => {
  for (const url of [
    "/api/auth/github",
    "/api/auth/github/callback?code=test-link&state=fake",
  ]) {
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.headers().location).toBe(
      `${origin}/?error=create-account-first`,
    );
    expect(response.headers()["set-cookie"] || "").not.toContain(
      "shipwreck_session=",
    );
    expect(
      (await (await request.get("/api/workspace")).json()).user,
    ).toBeNull();
  }
});

test("OAuth linking carries state; missing/mismatched callback state preserves identity", async ({
  request,
}) => {
  const { email } = await signup(request);
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
    const workspace = await (await request.get("/api/workspace")).json();
    expect(workspace.user.email).toBe(email);
    expect(workspace.github).toBeNull();
  }
});

test("GitHub links to the signed-in workspace without replacing its session or password login", async ({
  request,
  playwright,
}) => {
  const { email, cookie } = await signup(request);
  const before = await (await request.get("/api/workspace")).json();
  const start = await request.get("/api/auth/github", { maxRedirects: 0 });
  const state = new URL(start.headers().location).searchParams.get("state");
  const callback = await request.get(
    `/api/auth/github/callback?code=test-link&state=${state}`,
    { maxRedirects: 0 },
  );
  expect(callback.headers().location).toBe(`${origin}/?connected=github`);
  expect(callback.headers()["set-cookie"]).not.toContain("shipwreck_session=");
  const after = await (await request.get("/api/workspace")).json();
  expect(after.user).toEqual(before.user);
  expect(after.github).toBe("test-captain");
  const replay = await request.get(
    `/api/auth/github/callback?code=test-link&state=${state}`,
    { maxRedirects: 0 },
  );
  expect(replay.headers().location).toBe(
    `${origin}/?error=github-connection-failed`,
  );
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    const { email: otherEmail } = await signup(other);
    const attempt = await other.get("/api/auth/github", { maxRedirects: 0 });
    const otherState = new URL(attempt.headers().location).searchParams.get(
      "state",
    );
    const conflict = await other.get(
      `/api/auth/github/callback?code=test-link&state=${otherState}`,
      { maxRedirects: 0 },
    );
    expect(conflict.headers().location).toBe(
      `${origin}/?error=github-connection-failed`,
    );
    const otherWorkspace = await (await other.get("/api/workspace")).json();
    expect(otherWorkspace.user.email).toBe(otherEmail);
    expect(otherWorkspace.github).toBeNull();
  } finally {
    await other.dispose();
  }
  expect(
    (await request.storageState()).cookies.find(
      (c) => c.name === "shipwreck_session",
    )?.value,
  ).toBe(cookie.split("=")[1]);
  await request.post("/api/auth/logout", { headers, data: {} });
  const login = await request.post("/api/auth/login", {
    headers,
    data: { email, password },
  });
  expect(login.status()).toBe(200);
  expect((await (await request.get("/api/workspace")).json()).user.id).toBe(
    before.user.id,
  );
});

test("GitHub callback rejects logout, account switching, and tampered state", async ({
  request,
}) => {
  await signup(request);
  for (const change of ["logout", "switch", "tamper"]) {
    const start = await request.get("/api/auth/github", { maxRedirects: 0 });
    const state = new URL(start.headers().location).searchParams.get("state");
    if (change === "logout")
      await request.post("/api/auth/logout", { headers, data: {} });
    if (change === "switch") await signup(request);
    const callback = await request.get(
      `/api/auth/github/callback?code=test-link&state=${state}`,
      {
        maxRedirects: 0,
        ...(change === "tamper"
          ? {
              headers: {
                Cookie: (await request.storageState()).cookies
                  .map(
                    (c) =>
                      `${c.name}=${c.name === "github_state" ? "invalid" : c.value}`,
                  )
                  .join("; "),
              },
            }
          : {}),
      },
    );
    expect(callback.headers().location).toBe(
      `${origin}/?error=${change === "logout" ? "create-account-first" : "github-connection-failed"}`,
    );
    const workspace = await (await request.get("/api/workspace")).json();
    expect(workspace.github ?? null).toBeNull();
    if (change === "logout") await signup(request);
  }
});

test("GitHub App authorization saves the connection and preserves the Shipwreck session", async ({
  request,
}) => {
  const { cookie } = await signup(request);
  const before = await (await request.get("/api/workspace")).json();
  const start = await request.get("/api/github/app/connect", {
    maxRedirects: 0,
  });
  const target = new URL(start.headers().location);
  expect(target.origin).toBe("https://github.com");
  expect(target.searchParams.get("client_id")).toBe("test-app-client");
  expect(target.searchParams.get("redirect_uri")).toBe(
    `${origin}/api/github/app/callback`,
  );
  expect(target.searchParams.get("code_challenge_method")).toBe("S256");
  expect(target.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  const callbackPath = `/api/github/app/callback?code=test-app-link&state=${target.searchParams.get("state")}`;
  const callback = await request.get(callbackPath, { maxRedirects: 0 });
  expect(callback.headers().location).toBe(`${origin}/?connected=github-app`);
  const after = await (await request.get("/api/workspace")).json();
  expect(after.user).toEqual(before.user);
  expect(after.githubApp).toEqual({ login: "app-captain" });
  expect(
    (await request.storageState()).cookies.find(
      (c) => c.name === "shipwreck_session",
    )?.value,
  ).toBe(cookie.split("=")[1]);
  const replay = await request.get(callbackPath, { maxRedirects: 0 });
  expect(replay.headers().location).toBe(
    `${origin}/?error=github-app-state-invalid`,
  );
});

test("GitHub App rejects missing, tampered, mismatched, and switched-account callback state", async ({
  request,
}) => {
  await signup(request);
  const missing = await request.get(
    "/api/github/app/callback?code=test-app-link",
    { maxRedirects: 0 },
  );
  expect(missing.headers().location).toBe(
    `${origin}/?error=github-app-state-invalid`,
  );
  for (const change of ["state", "cookie", "account"]) {
    const start = await request.get("/api/github/app/connect", {
      maxRedirects: 0,
    });
    let state = new URL(start.headers().location).searchParams.get("state");
    if (change === "state") state = "wrong";
    if (change === "account") await signup(request);
    const response = await request.get(
      `/api/github/app/callback?code=test-app-link&state=${state}`,
      {
        maxRedirects: 0,
        ...(change === "cookie"
          ? {
              headers: {
                Cookie: (await request.storageState()).cookies
                  .map(
                    (c) =>
                      `${c.name}=${c.name === "github_app_flow" ? "invalid" : c.value}`,
                  )
                  .join("; "),
              },
            }
          : {}),
      },
    );
    expect(response.headers().location).toBe(
      `${origin}/?error=github-app-state-invalid`,
    );
    expect(
      (await (await request.get("/api/workspace")).json()).githubApp,
    ).toBeNull();
  }
});

test("GitHub App callback reports provider failures without exposing provider responses", async ({
  request,
}) => {
  await signup(request);
  for (const [code, reason] of [
    ["test-app-bad-client", "github-app-client-credentials"],
    ["test-app-bad-redirect", "github-app-redirect-mismatch"],
    ["test-app-bad-code", "github-app-code-expired"],
    ["test-app-email", "github-app-email-unverified"],
    ["test-app-unknown-error", "github-app-token-failed"],
  ]) {
    const start = await request.get("/api/github/app/connect", {
      maxRedirects: 0,
    });
    const state = new URL(start.headers().location).searchParams.get("state");
    const response = await request.get(
      `/api/github/app/callback?code=${code}&state=${state}`,
      { maxRedirects: 0 },
    );
    expect(response.headers().location).toBe(`${origin}/?error=${reason}`);
    expect(await response.text()).not.toContain(
      "provider-secret-must-not-be-exposed",
    );
    expect(
      (await (await request.get("/api/workspace")).json()).githubApp,
    ).toBeNull();
  }
});

test("GitHub App installation returns through setup and verifies the user's installation access", async ({
  request,
}) => {
  await signup(request);
  const start = await request.get("/api/github/app/connect", {
    maxRedirects: 0,
  });
  const state = new URL(start.headers().location).searchParams.get("state");
  const initial = await request.get(
    `/api/github/app/callback?code=test-app-install&state=${state}`,
    { maxRedirects: 0 },
  );
  expect(initial.headers().location).toBe(`${origin}/api/github/app/install`);
  const install = await request.get("/api/github/app/install", {
    maxRedirects: 0,
  });
  const installUrl = new URL(install.headers().location);
  expect(installUrl.origin + installUrl.pathname).toBe(
    "https://github.com/apps/shipwreck-test/installations/new",
  );
  const setup = await request.get(
    `/api/github/app/setup?installation_id=123&setup_action=install&state=${installUrl.searchParams.get("state")}`,
    { maxRedirects: 0 },
  );
  const authorization = new URL(setup.headers().location);
  expect(authorization.origin).toBe("https://github.com");
  const callback = await request.get(
    `/api/github/app/callback?code=test-app-installed&state=${authorization.searchParams.get("state")}`,
    { maxRedirects: 0 },
  );
  expect(callback.headers().location).toBe(`${origin}/?connected=github-app`);
  expect(
    (await (await request.get("/api/workspace")).json()).githubApp,
  ).toEqual({ login: "install-captain" });

  const restart = await request.get("/api/github/app/install", {
    maxRedirects: 0,
  });
  const forged = await request.get(
    `/api/github/app/setup?installation_id=999&state=${new URL(restart.headers().location).searchParams.get("state")}`,
    { maxRedirects: 0 },
  );
  const rejected = await request.get(
    `/api/github/app/callback?code=test-app-installed&state=${new URL(forged.headers().location).searchParams.get("state")}`,
    { maxRedirects: 0 },
  );
  expect(rejected.headers().location).toBe(
    `${origin}/?error=github-app-installation-access`,
  );
});

test("GitHub App account conflict does not overwrite another workspace's connection", async ({
  request,
  playwright,
}) => {
  await signup(request);
  const start = await request.get("/api/github/app/connect", {
    maxRedirects: 0,
  });
  const state = new URL(start.headers().location).searchParams.get("state");
  const connected = await request.get(
    `/api/github/app/callback?code=test-app-conflict&state=${state}`,
    { maxRedirects: 0 },
  );
  expect(connected.headers().location).toBe(`${origin}/?connected=github-app`);
  const owner = await (await request.get("/api/workspace")).json();
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    await signup(other);
    const before = await (await other.get("/api/workspace")).json();
    const attempt = await other.get("/api/github/app/connect", {
      maxRedirects: 0,
    });
    const response = await other.get(
      `/api/github/app/callback?code=test-app-conflict&state=${new URL(attempt.headers().location).searchParams.get("state")}`,
      { maxRedirects: 0 },
    );
    expect(response.headers().location).toBe(
      `${origin}/?error=github-app-account-mismatch`,
    );
    const after = await (await other.get("/api/workspace")).json();
    expect(after.user).toEqual(before.user);
    expect(after.githubApp).toBeNull();
    expect(
      (await (await request.get("/api/workspace")).json()).githubApp,
    ).toEqual(owner.githubApp);
  } finally {
    await other.dispose();
  }
});

test("email signup leads to optional GitHub settings; login contains no GitHub SSO", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /GitHub/ })).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "New to Shipwreck? Create an account" })
    .click();
  await expect(
    dialog.getByText(/Connect GitHub afterward in Settings/),
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: /GitHub/ })).toHaveCount(0);
  const email = `${randomUUID()}@example.test`;
  await dialog.getByLabel("Name", { exact: true }).fill("Email Captain");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect GitHub", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await page.screenshot({
    path: "artifacts/email-signup-settings.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .locator(".settings-panel")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(dialog.getByLabel("Email", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "artifacts/email-login.png",
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your first launch starts here" }),
  ).toBeVisible();
});
