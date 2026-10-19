import { defineConfig } from "@playwright/test";

const port = 43174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ["--disable-dev-shm-usage"] } }
      : { channel: "chrome" as const, launchOptions: { args: ["--disable-dev-shm-usage"] } }),
  },
  projects: [
    { name: "setup", testMatch: /setup\.spec\.ts/ },
    {
      name: "e2e",
      dependencies: ["setup"],
      testIgnore: /setup\.spec\.ts/,
      use: { viewport: { width: 1280, height: 800 }, storageState: ".wrangler-e2e/admin-state.json" },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      EXPORTFLOW_PORT: String(port),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
