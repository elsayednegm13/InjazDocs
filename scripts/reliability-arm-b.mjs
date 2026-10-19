import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const stateName = ".wrangler-reliability-b";
const armDir = path.resolve(root, stateName);
const persist = path.join(armDir, "state");
const developerState = path.resolve(root, ".wrangler", "state");
if (persist === developerState || persist.startsWith(developerState + path.sep)) {
  throw new Error("Refusing to use the developer state directory");
}
const existing = lstatSync(armDir, { throwIfNoEntry: false });
if (existing?.isSymbolicLink()) {
  throw new Error(`Refusing symlink state directory: ${readlinkSync(armDir)}`);
}
rmSync(armDir, { recursive: true, force: true });
mkdirSync(path.join(armDir, "empty-assets"), { recursive: true });
mkdirSync(persist, { recursive: true });

const vitePort = process.env.EXPORTFLOW_PORT || "43181";
const workerPort = process.env.EXPORTFLOW_WORKER_PORT || "43182";
const inspectorPort = process.env.EXPORTFLOW_INSPECTOR_PORT || "9231";
const base = `http://127.0.0.1:${vitePort}`;
const workerOrigin = `http://127.0.0.1:${workerPort}`;
const authSecret = randomBytes(32).toString("base64url");
const bootstrapSecret = randomBytes(24).toString("base64url");
const configPath = path.join(armDir, "wrangler.jsonc");
writeFileSync(
  configPath,
  JSON.stringify(
    {
      name: "exportflow-reliability-b",
      compatibility_date: "2026-10-11",
      compatibility_flags: ["nodejs_compat"],
      main: "../worker/index.ts",
      assets: {
        directory: "./empty-assets",
        not_found_handling: "single-page-application",
        run_worker_first: ["/api/*"],
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "exportflow-local",
          database_id: "local-exportflow-not-a-remote-id",
          migrations_dir: "../drizzle/migrations",
        },
      ],
      r2_buckets: [{ binding: "DOCUMENTS", bucket_name: "exportflow-documents-local" }],
      triggers: { crons: ["* * * * *"] },
      vars: {
        APP_NAME: "ExportFlow",
        COMPANY_TIMEZONE: "Africa/Cairo",
        INCOTERMS_EDITION_DEFAULT: "Incoterms 2020",
        MAX_UPLOAD_BYTES: "419430400",
        UPLOAD_PART_SIZE_BYTES: "10485760",
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  path.join(armDir, ".dev.vars"),
  `BETTER_AUTH_SECRET=${authSecret}\nBETTER_AUTH_URL=${base}\nBOOTSTRAP_SECRET=${bootstrapSecret}\nEXPORTFLOW_TRACE=${process.env.EXPORTFLOW_TRACE === "1" ? "1" : "0"}\nEXPORTFLOW_FIXTURE=reliability-b\n`,
);
writeFileSync(
  path.join(armDir, "sentinel.json"),
  JSON.stringify({ fixture: "reliability-b", persist, vitePort, workerPort, configPath, createdAt: new Date().toISOString() }, null, 2),
);

const childEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
delete childEnv.CLOUDFLARE_ENV;

const migrate = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "d1", "migrations", "apply", "exportflow-local",
    "--config", configPath,
    "--local",
    "--persist-to", persist,
  ],
  { cwd: root, stdio: "inherit", env: childEnv },
);
const migrateCode = await new Promise((resolve) => migrate.on("close", resolve));
if (migrateCode !== 0) process.exit(migrateCode ?? 1);

const worker = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "dev",
    "--config", configPath,
    "--local",
    "--ip", "127.0.0.1",
    "--port", workerPort,
    "--inspector-port", inspectorPort,
    "--persist-to", persist,
    "--no-latest",
  ],
  { cwd: root, stdio: "inherit", env: { ...childEnv, EXPORTFLOW_PERSIST: persist } },
);

const vite = spawn(
  process.execPath,
  [path.join(root, "node_modules/vite/bin/vite.js"), "--config", "vite.reliability.config.ts", "--host", "127.0.0.1", "--port", vitePort],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...childEnv, EXPORTFLOW_PORT: vitePort, EXPORTFLOW_WORKER_ORIGIN: workerOrigin },
  },
);

function stop() {
  vite.kill("SIGTERM");
  worker.kill("SIGTERM");
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
vite.on("exit", (code) => {
  worker.kill("SIGTERM");
  process.exit(code ?? 0);
});
worker.on("exit", (code) => {
  if (code && code !== 0) {
    vite.kill("SIGTERM");
    process.exit(code);
  }
});
