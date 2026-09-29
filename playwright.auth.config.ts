import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "auth.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3107" },
  reporter: "list",
  webServer: {
    command: "node --import tsx scripts/auth-test-server.ts",
    url: "http://127.0.0.1:3107/api/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
