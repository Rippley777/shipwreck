import { test, expect } from "@playwright/test";
const origin = process.env.TEST_URL || "http://localhost:3000";
test("demo report, filters, fix prompts, rescan, history, and mobile", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Clear skies start with a Hull Check." }),
  ).toBeVisible();
  await page.getByPlaceholder("Search projects…").fill("api-gateway");
  await expect(page.locator(".project-table tbody tr")).toHaveCount(1);
  await page.getByPlaceholder("Search projects…").fill("");
  await page
    .getByRole("button", { name: "View launchpad", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "2 critical findings deserve a closer look.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Resource ownership needs review/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "What Shipwreck found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Copy fix prompt", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "not a confirmed vulnerability",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Environment", exact: true }).click();
  await expect(
    page.getByText("STRIPE_WEBHOOK_SECRET", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Manifest", exact: true }).click();
  await expect(page.getByText("PostgreSQL", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Run Hull Check", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Hull Check complete" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(3);
  await page.locator(".history-row").last().click();
  await expect(page.getByText(/Viewing scan from/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Destructive database migration/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/project-report.png",
    fullPage: true,
  });
  await page.locator(".back-link").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, -236, 0)",
  );
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.screenshot({
    path: "artifacts/dashboard-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("account lifecycle, project settings/deletion, CSRF and tenant isolation", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Make it your workspace" }).click();
  const email = `qa-${Date.now()}@example.com`;
  const password = "test-password-long-enough";
  await page.getByLabel("Name", { exact: true }).fill("QA Captain");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Public repository browsing" }),
  ).toBeVisible();
  const request = context.request;
  const response = await request.post("/api/projects", {
    headers: { Origin: origin },
    data: {
      name: "test-voyage",
      repository: "octocat/Hello-World",
      branch: "master",
    },
  });
  expect(response.status()).toBe(200);
  const { id } = await response.json();
  await page.reload();
  await page.getByRole("button", { name: "View test-voyage" }).click();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByLabel("Project name").fill("renamed-voyage");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: /renamed-voyage/ }),
  ).toBeVisible();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/");
  await expect(
    otherPage.getByRole("heading", {
      name: "Clear skies start with a Hull Check.",
    }),
  ).toBeVisible();
  const foreign = await other.request.post("/api/scans", {
    headers: { Origin: origin },
    data: { projectId: id },
  });
  expect(foreign.status()).toBe(404);
  const foreignUpdate = await other.request.post("/api/projects/update", {
    headers: { Origin: origin },
    data: {
      id,
      name: "stolen-project",
      repository: "octocat/Hello-World",
      branch: "master",
    },
  });
  expect(foreignUpdate.status()).toBe(404);
  const csrf = await request.post("/api/projects/delete", {
    headers: { Origin: "https://evil.example" },
    data: { id },
  });
  expect(csrf.status()).toBe(403);
  await other.close();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await page.getByRole("button", { name: "Yes, delete project" }).click();
  await expect(
    page.getByRole("heading", { name: "Your first launch starts here" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await expect(
    page.getByText("QA Captain", { exact: true }).first(),
  ).toBeVisible();
  await context.close();
});

test("private repository picker carries installation identity through branch selection and project creation", async ({
  page,
}) => {
  const email = `private-ui-${Date.now()}@example.com`;
  await page.request.post("/api/auth/signup", {
    headers: { Origin: origin },
    data: { name: "Private Captain", email, password: "private-test-password" },
  });
  const workspace = await (await page.request.get("/api/workspace")).json();
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: {
        ...workspace,
        githubApp: { login: "captain" },
        githubAppConfigured: true,
      },
    }),
  );
  await page.route("**/api/repositories", (route) =>
    route.fulfill({
      json: [
        {
          id: 456,
          full_name: "private-org/service",
          default_branch: "release",
          private: true,
          installation_id: "123",
        },
      ],
    }),
  );
  let branchURL = "";
  await page.route("**/api/branches?**", (route) => {
    branchURL = route.request().url();
    return route.fulfill({ json: [{ name: "release" }, { name: "main" }] });
  });
  let submitted: Record<string, unknown> = {};
  await page.route("**/api/projects", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      status: 400,
      json: {
        error: "Mock boundary: request captured without contacting GitHub.",
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByRole("button", { name: "Browse connected repositories" })
    .click();
  await page
    .getByLabel("Select repository")
    .selectOption("private-org/service");
  await expect(
    page.getByText(/This repository uses read-only GitHub App access/),
  ).toBeVisible();
  await expect(page.getByRole("combobox").last()).toHaveValue("release");
  expect(new URL(branchURL).searchParams.get("installation_id")).toBe("123");
  await page
    .getByRole("button", { name: "Create project & run Hull Check" })
    .click();
  await expect(page.getByText(/Mock boundary: request captured/)).toBeVisible();
  expect(submitted.github_installation_id).toBe("123");
  expect(submitted.repository).toBe("private-org/service");
  expect(submitted.branch).toBe("release");
  await page.keyboard.press("Escape");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page.getByText("GitHub App connected as captain")).toBeVisible();
  await page.route("**/api/github/app/installations", (route) =>
    route.fulfill({ json: [{ id: 123, account: { login: "private-org" } }] }),
  );
  await page.getByRole("button", { name: "View installations" }).click();
  await expect(page.getByText("Installation 123")).toBeVisible();
  await page.unroute("**/api/workspace");
  await page.getByRole("button", { name: "Disconnect App" }).click();
  await expect(
    page.getByRole("link", { name: "Connect GitHub App" }),
  ).toHaveCount(0);
});
