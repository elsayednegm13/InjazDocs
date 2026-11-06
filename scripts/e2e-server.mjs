import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertIsolatedPersist } from "./isolation-guard.mjs";

const root = process.cwd();

// One explicit, fresh, run-owned root is mandatory. The server never invents a
// root: Playwright and the helpers read the same EXPORTFLOW_E2E_ROOT, so a
// locally invented root would silently diverge from theirs.
const explicitRoot = process.env.EXPORTFLOW_E2E_ROOT;
if (!explicitRoot || !String(explicitRoot).trim()) {
  console.error("EXPORTFLOW_E2E_ROOT_REQUIRED: pass a fresh run-owned root explicitly");
  process.exit(2);
}
const runRoot = assertIsolatedPersist(explicitRoot, { root });
if (existsSync(runRoot) && readdirSync(runRoot).length > 0) {
  console.error("EXPORTFLOW_E2E_ROOT_NOT_FRESH: refuse to reuse a non-empty run root");
  process.exit(2);
}
const persist = assertIsolatedPersist(path.join(runRoot, "state"), { root });
mkdirSync(persist, { recursive: true });

const port = process.env.EXPORTFLOW_PORT || "43174";
const base = `http://127.0.0.1:${port}`;
const bootstrapSecret = randomBytes(24).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");
const admin = {
  email: "e2e-admin@example.invalid",
  password: `E2e-${randomBytes(12).toString("base64url")}`,
  bootstrapSecret,
  base,
};
const traceLine = process.env.EXPORTFLOW_TRACE === "1" ? "EXPORTFLOW_TRACE=1\n" : "";

// --- M01-B.1: generated, run-owned Worker config ----------------------------
//
// Wrangler resolves worker dev vars from dirname(effective config)/
// .dev.vars[.<CLOUDFLARE_ENV>]. Pinning the Vite plugin and the D1 migration
// run to a generated config inside the owned run root therefore makes
// <runRoot>/.dev.vars.e2e the first and only secrets file in that lookup; the
// project-root .dev.vars can never be reached while this contract holds. main
// and migrations_dir must be absolute because the generated config lives
// outside the project tree. The allowlisted fields mirror the project's
// public local worker setup only: no account, route, remote or telemetry
// fields, and no reference to the project wrangler config at all.

export function buildGeneratedWorkerConfig({ projectRoot }) {
  return {
    name: "exportflow",
    compatibility_date: "2026-10-11",
    compatibility_flags: ["nodejs_compat"],
    main: path.resolve(projectRoot, "worker", "index.ts"),
    assets: {
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "exportflow-local",
        database_id: "local-exportflow-not-a-remote-id",
        migrations_dir: path.resolve(projectRoot, "drizzle", "migrations"),
      },
    ],
    r2_buckets: [
      {
        binding: "DOCUMENTS",
        bucket_name: "exportflow-documents-local",
      },
    ],
    triggers: {
      crons: ["* * * * *"],
    },
    vars: {
      APP_NAME: "ExportFlow",
      COMPANY_TIMEZONE: "Africa/Cairo",
      INCOTERMS_EDITION_DEFAULT: "Incoterms 2020",
      MAX_UPLOAD_BYTES: "419430400",
      UPLOAD_PART_SIZE_BYTES: "10485760",
    },
  };
}

export function validateGeneratedWorkerConfig(config, { projectRoot }) {
  const problems = [];
  const expect = (condition, code) => {
    if (!condition) problems.push(code);
  };
  expect(config.name === "exportflow", "WORKER_NAME_MISMATCH");
  expect(config.main === path.resolve(projectRoot, "worker", "index.ts"), "MAIN_NOT_PROJECT_ENTRY");
  const d1 = config.d1_databases;
  expect(Array.isArray(d1) && d1.length === 1, "D1_BINDING_COUNT");
  expect(!!d1?.[0] && d1[0].binding === "DB", "D1_BINDING_NAME");
  expect(!!d1?.[0] && d1[0].database_name === "exportflow-local", "D1_DATABASE_NAME");
  expect(
    !!d1?.[0] && d1[0].migrations_dir === path.resolve(projectRoot, "drizzle", "migrations"),
    "MIGRATIONS_DIR_NOT_PROJECT_ABSOLUTE",
  );
  expect(Array.isArray(config.r2_buckets) && config.r2_buckets.length === 1, "R2_BINDING_COUNT");
  expect(!!config.r2_buckets?.[0] && config.r2_buckets[0].binding === "DOCUMENTS", "R2_BINDING_NAME");
  for (const field of ["account_id", "route", "routes", "zone_id", "send_metrics", "services", "kv_namespaces", "queues", "secrets"]) {
    expect(config[field] === undefined, `FORBIDDEN_FIELD:${field}`);
  }
  expect(!JSON.stringify(config).toLowerCase().includes('"remote"'), "REMOTE_BINDING_FLAG");
  if (problems.length > 0) {
    throw new Error(`GENERATED_WORKER_CONFIG_INVALID: ${problems.join(",")}`);
  }
}

const GENERATED_DEV_VARS_KEYS = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "BOOTSTRAP_SECRET", "EXPORTFLOW_TEST_FAULTS"];

// Fail-closed check of the synthetic secrets file BEFORE any process that
// could read it is spawned. Only key names are ever reported.
export function validateSyntheticDevVars(text, { requiredKeys = GENERATED_DEV_VARS_KEYS } = {}) {
  const seen = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) throw new Error("SYNTHETIC_DEV_VARS_MALFORMED_LINE");
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error(`SYNTHETIC_DEV_VARS_BAD_KEY:${key}`);
    if (seen.has(key)) throw new Error(`SYNTHETIC_DEV_VARS_DUPLICATE_KEY:${key}`);
    if (!value) throw new Error(`SYNTHETIC_DEV_VARS_EMPTY_VALUE:${key}`);
    seen.set(key, value);
  }
  for (const key of requiredKeys) {
    if (!seen.has(key)) throw new Error(`SYNTHETIC_DEV_VARS_MISSING_KEY:${key}`);
  }
  return seen;
}

// Child processes inherit nothing sensitive: a strict allowlist of harmless OS
// variables plus the explicit run contract. TMP/TEMP are redirected into the
// owned root; analytics and the .env dev-vars fallback are disabled.
const CHILD_ENV_ALLOWLIST = [
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

export function buildChildEnv({ runRoot: ownedRoot, persist: ownedPersist, port: e2ePort, generatedConfigPath }) {
  const env = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const tmpDir = path.join(ownedRoot, "tmp");
  env.TMP = tmpDir;
  env.TEMP = tmpDir;
  env.CI = "1";
  env.EXPORTFLOW_PORT = String(e2ePort);
  env.EXPORTFLOW_E2E_ROOT = ownedRoot;
  env.EXPORTFLOW_PERSIST = ownedPersist;
  env.EXPORTFLOW_E2E_WRANGLER_CONFIG_PATH = generatedConfigPath;
  env.WRANGLER_SEND_METRICS = "false";
  env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  return env;
}

// --- Owned synthetic artifacts, validated before any process starts ---------

const generatedConfigPath = path.join(runRoot, "wrangler.e2e.generated.jsonc");
const devVarsPath = path.join(runRoot, ".dev.vars.e2e");
assertIsolatedPersist(generatedConfigPath, { root });
assertIsolatedPersist(devVarsPath, { root });
if (path.dirname(generatedConfigPath) !== runRoot || path.dirname(devVarsPath) !== runRoot) {
  console.error("GENERATED_ARTIFACT_NOT_IN_RUN_ROOT");
  process.exit(2);
}

const workerConfig = buildGeneratedWorkerConfig({ projectRoot: root });
validateGeneratedWorkerConfig(workerConfig, { projectRoot: root });
if (!existsSync(workerConfig.main)) {
  console.error("WORKER_ENTRY_MISSING");
  process.exit(2);
}
if (!existsSync(workerConfig.d1_databases[0].migrations_dir)) {
  console.error("MIGRATIONS_DIR_MISSING");
  process.exit(2);
}
writeFileSync(generatedConfigPath, `${JSON.stringify(workerConfig, null, 2)}\n`);
// Round-trip proof: the file handed to Vite/Wrangler is exactly the validated one.
validateGeneratedWorkerConfig(JSON.parse(readFileSync(generatedConfigPath, "utf8")), { projectRoot: root });

writeFileSync(devVarsPath, `BETTER_AUTH_SECRET=${authSecret}\nBETTER_AUTH_URL=${base}\nBOOTSTRAP_SECRET=${bootstrapSecret}\nEXPORTFLOW_TEST_FAULTS=1\nALLOW_TEST_DELAY_HEADERS=true\n${traceLine}`);
validateSyntheticDevVars(readFileSync(devVarsPath, "utf8"));

writeFileSync(path.join(runRoot, "admin.json"), JSON.stringify(admin, null, 2));
writeFileSync(path.join(runRoot, "run.json"), JSON.stringify({ runRoot, persist, port, workerConfigPath: generatedConfigPath, createdAt: new Date().toISOString() }, null, 2));
mkdirSync(path.join(runRoot, "tmp"), { recursive: true });

const childEnv = buildChildEnv({ runRoot, persist, port, generatedConfigPath });

const migrate = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "d1",
    "migrations",
    "apply",
    "exportflow-local",
    "--local",
    "--persist-to",
    persist,
    "--config",
    generatedConfigPath,
  ],
  { cwd: root, stdio: "inherit", env: childEnv },
);
const migrateCode = await new Promise((resolve) => migrate.on("close", resolve));
if (migrateCode !== 0) process.exit(migrateCode ?? 1);

const vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: { ...childEnv, CLOUDFLARE_ENV: "e2e" },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => vite.kill("SIGTERM"));
process.on("SIGINT", () => vite.kill("SIGINT"));
