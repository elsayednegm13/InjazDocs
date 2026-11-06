import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = 43174;
const baseURL = `http://127.0.0.1:${port}`;

// Fail closed at config load, before the webServer starts any child process:
// the run root must be supplied explicitly and is then propagated unchanged to
// the server, the helpers and the storage-state file.
const runRoot = (() => {
  const explicit = process.env.EXPORTFLOW_E2E_ROOT;
  if (!explicit || !String(explicit).trim()) {
    throw new Error(
      "EXPORTFLOW_E2E_ROOT_REQUIRED: Playwright must run with an explicit fresh run-owned root",
    );
  }
  return path.resolve(String(explicit));
})();

function e2eStorageState(): string {
  const explicit = process.env.EXPORTFLOW_E2E_ADMIN_STATE;
  if (explicit && String(explicit).trim()) {
    return String(explicit);
  }
  return path.join(runRoot, "admin-state.json");
}

// Only the OS variables required to spawn Node are forwarded to the webServer
// child. Project secrets, Cloudflare credentials and the developer environment
// are never inherited (W1-G0 GAP-15).
const SERVER_ENV_ALLOWLIST = [
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "OS",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
];

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SERVER_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

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
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: e2eStorageState(),
      },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    // W1-G0 GAP-15: the launcher must not inherit the host environment. Only
    // the harmless OS variables needed to spawn Node are forwarded; the run
    // contract is added explicitly below.
    env: {
      ...serverEnv(),
      EXPORTFLOW_E2E_ROOT: runRoot,
      EXPORTFLOW_PORT: String(port),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
