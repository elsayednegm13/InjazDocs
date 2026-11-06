import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_MARKER, assertIsolatedPersist as assertStrongPersist } from "../../scripts/isolation-guard.mjs";

// M01-B.1 static/synthetic coverage for the generated run-owned Worker config
// contract. Everything here is text inspection of ordinary project sources,
// in-memory evaluation of PURE functions extracted from scripts/e2e-server.mjs
// (never imported - importing it would spawn the runtime), version-pinned
// string invariants of the INSTALLED plugin/wrangler dists, and one OS-temp
// sandbox for guard/junction behavior. Nothing imports or executes
// vite.config, the E2E server module, the Cloudflare plugin, Wrangler,
// Miniflare or Playwright, and no protected or pre-existing path is touched.

// pnpm installs plain package symlinks under node_modules; the plugin's
// package.json is not exported for require.resolve, so both packages are
// addressed by their symlinked directories (read-only file reads only).
const pluginPkgDir = fileURLToPath(new URL("../../node_modules/@cloudflare/vite-plugin", import.meta.url));
const wranglerPkgDir = fileURLToPath(new URL("../../node_modules/wrangler", import.meta.url));

function readText(absolute) {
  return readFileSync(absolute, "utf8");
}
function readProjectFile(relative) {
  return readText(fileURLToPath(new URL(`../../${relative}`, import.meta.url)));
}

const serverSource = readProjectFile("scripts/e2e-server.mjs");
const viteSource = readProjectFile("vite.config.ts");
const pluginSource = readText(path.join(pluginPkgDir, "dist", "index.mjs"));
const wranglerSource = readText(path.join(wranglerPkgDir, "wrangler-dist", "cli.js"));
const pluginPkg = JSON.parse(readText(path.join(pluginPkgDir, "package.json")));
const wranglerPkg = JSON.parse(readText(path.join(wranglerPkgDir, "package.json")));

// --- extraction of PURE functions/consts (no module import, no execution) ---

function extractFunction(source, name) {
  const match = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = source.indexOf("(", match.index);
  let j = i;
  for (; j < source.length; j++) {
    if (source[j] === "(") depth += 1;
    else if (source[j] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const open = source.indexOf("{", j);
  let braceDepth = 0;
  let k = open;
  for (; k < source.length; k++) {
    if (source[k] === "{") braceDepth += 1;
    else if (source[k] === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) break;
    }
  }
  return source.slice(match.index, k + 1);
}

function extractConstArray(source, name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*\\[`).exec(source);
  if (!match) throw new Error(`const ${name} not found`);
  const start = source.indexOf("[", match.index);
  let depth = 0;
  let k = start;
  for (; k < source.length; k++) {
    if (source[k] === "[") depth += 1;
    else if (source[k] === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, k + 1);
}

function evalFunction(source, name, scope = {}) {
  const src = extractFunction(source, name).replace(/^export\s+/, "");
  const keys = Object.keys(scope);
  const factory = new Function(...keys, `"use strict"; return (${src});`);
  return factory(...keys.map((key) => scope[key]));
}

function evalConstArray(source, name) {
  return new Function(`"use strict"; return (${extractConstArray(source, name)});`)();
}

const SYNTHETIC_PROJECT = "C:/exportflow-synth";
const SYNTHETIC_RUN_ROOT = `${SYNTHETIC_PROJECT}/.wrangler-safety-20261021-m01b1-run`;
const childEnvAllowlist = evalConstArray(serverSource, "CHILD_ENV_ALLOWLIST");
const devVarsKeys = evalConstArray(serverSource, "GENERATED_DEV_VARS_KEYS");
const buildConfig = evalFunction(serverSource, "buildGeneratedWorkerConfig", { path });
const validateConfig = evalFunction(serverSource, "validateGeneratedWorkerConfig", { path });
const validateDevVars = evalFunction(serverSource, "validateSyntheticDevVars", {
  GENERATED_DEV_VARS_KEYS: devVarsKeys,
});
const buildChildEnv = evalFunction(serverSource, "buildChildEnv", {
  path,
  process: { env: process.env },
  CHILD_ENV_ALLOWLIST: childEnvAllowlist,
});

const synthConfig = buildConfig({ projectRoot: SYNTHETIC_PROJECT });

function expectThrowsWith(fn, needle) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes(needle), `expected "${needle}" in "${message}"`);
    return message;
  }
  assert.fail(`expected a throw containing "${needle}"`);
}

// ---------------------------------------------------------------------------
// T01/T02/T03: generated config location, identity and secrets co-location
// ---------------------------------------------------------------------------

test("T01 generated config is derived in the exact runRoot and rejects a missing root", () => {
  assert.match(serverSource, /const generatedConfigPath = path\.join\(runRoot, "wrangler\.e2e\.generated\.jsonc"\);/);
  assert.match(serverSource, /assertIsolatedPersist\(generatedConfigPath, \{ root \}\);/);
  assert.match(serverSource, /EXPORTFLOW_E2E_ROOT_REQUIRED/);
  assert.match(serverSource, /EXPORTFLOW_E2E_ROOT_NOT_FRESH/);
  // The launcher still fails closed on a missing/blank explicit root.
  assert.ok(serverSource.indexOf("EXPORTFLOW_E2E_ROOT_REQUIRED") < serverSource.indexOf("assertIsolatedPersist(explicitRoot"));
});

test("T02 the generated file is the exact one written, re-validated and handed to Vite and the migration run", () => {
  // one single definition, consumed by write + round-trip + migration --config + vite env
  assert.equal((serverSource.match(/const generatedConfigPath = /g) ?? []).length, 1);
  assert.match(serverSource, /writeFileSync\(generatedConfigPath,/);
  assert.match(serverSource, /validateGeneratedWorkerConfig\(JSON\.parse\(readFileSync\(generatedConfigPath, "utf8"\)\), \{ projectRoot: root \}\)/);
  assert.match(serverSource, /"--config",\s*generatedConfigPath/);
  assert.match(serverSource, /EXPORTFLOW_E2E_WRANGLER_CONFIG_PATH = generatedConfigPath/);
});

test("T03 secrets file lives in dirname(configPath) = runRoot and the vite child runs with CLOUDFLARE_ENV=e2e", () => {
  assert.match(serverSource, /const devVarsPath = path\.join\(runRoot, "\.dev\.vars\.e2e"\);/);
  assert.match(serverSource, /path\.dirname\(generatedConfigPath\) !== runRoot \|\| path\.dirname\(devVarsPath\) !== runRoot/);
  assert.match(serverSource, /assertIsolatedPersist\(devVarsPath, \{ root \}\);/);
  assert.match(serverSource, /\{ \.\.\.childEnv, CLOUDFLARE_ENV: "e2e" \}/);
  // The migration child must NOT carry CLOUDFLARE_ENV (no env sections, no dev vars needed).
  assert.match(serverSource, /env: childEnv \},\n\);/);
});

// ---------------------------------------------------------------------------
// T04: synthetic secrets fail closed before any spawn
// ---------------------------------------------------------------------------

test("T04 validateSyntheticDevVars rejects missing/empty/duplicate/malformed entries and validation precedes spawn", () => {
  const ok = "BETTER_AUTH_SECRET=s1\nBETTER_AUTH_URL=http://127.0.0.1:43174\nBOOTSTRAP_SECRET=b1\nEXPORTFLOW_TEST_FAULTS=1\nEXPORTFLOW_TRACE=1\n";
  const parsed = validateDevVars(ok);
  assert.equal(parsed.get("BETTER_AUTH_SECRET"), "s1");
  expectThrowsWith(() => validateDevVars("BETTER_AUTH_URL=http://x\nBOOTSTRAP_SECRET=b\nEXPORTFLOW_TEST_FAULTS=1\n"), "SYNTHETIC_DEV_VARS_MISSING_KEY:BETTER_AUTH_SECRET");
  expectThrowsWith(() => validateDevVars("BETTER_AUTH_SECRET=\n"), "SYNTHETIC_DEV_VARS_EMPTY_VALUE:BETTER_AUTH_SECRET");
  expectThrowsWith(() => validateDevVars("BETTER_AUTH_SECRET=a\nBETTER_AUTH_SECRET=b\n"), "SYNTHETIC_DEV_VARS_DUPLICATE_KEY:BETTER_AUTH_SECRET");
  expectThrowsWith(() => validateDevVars("no-equals-sign\n"), "SYNTHETIC_DEV_VARS_MALFORMED_LINE");
  expectThrowsWith(() => validateDevVars("lower-key=1\n"), "SYNTHETIC_DEV_VARS_BAD_KEY");
  // write -> validate strictly before the first spawn call
  const lastValidate = serverSource.lastIndexOf("validateSyntheticDevVars(");
  const firstSpawn = serverSource.indexOf("spawn(");
  assert.ok(lastValidate > 0 && firstSpawn > 0);
  assert.ok(lastValidate < firstSpawn, "secrets validation must run before the first spawn");
});

// ---------------------------------------------------------------------------
// T05: the installed loader branch is pinned to the generated config directory
// ---------------------------------------------------------------------------

test("T05 installed wrangler 4.149.0 tries <configDir>/.dev.vars.<env> first and the generic file only as fallback", () => {
  assert.equal(wranglerPkg.version, "4.149.0");
  const body = extractFunction(wranglerSource, "loadDotDevDotVars");
  const envSpecific = body.indexOf("tryLoadDotDevDotVars(`${envPath}.${env6}`)");
  const generic = body.lastIndexOf("tryLoadDotDevDotVars(envPath)");
  assert.ok(envSpecific > 0, "env-specific lookup not found");
  assert.ok(generic > envSpecific, "generic .dev.vars fallback must be tried only after the e2e-specific file");
  // userConfigPath is the passed config path (the generated run-owned file)
  assert.ok(wranglerSource.includes("userConfigPath: config2"));
  assert.match(wranglerSource, /getVarsForDev\(\s*configParam\.userConfigPath,/);
  // serve path passes no envFiles -> lookup is strictly configDir-scoped
  const gmo = extractFunction(wranglerSource, "unstable_getMiniflareWorkerOptions");
  assert.ok(gmo.includes("getBindings2(") && gmo.includes("options?.envFiles"));
});

test("T05b installed plugin 1.63.1 forwards configPath and resolves dev vars from it in serve mode", () => {
  assert.equal(pluginPkg.version, "1.63.1");
  assert.ok(pluginSource.includes("pluginConfig.configPath ?? prefixedEnv.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH"));
  assert.match(pluginSource, /wrangler\.unstable_readConfig\(\{\s*config: configPath,\s*env: env\$3\s*\}/);
  // serve-mode miniflare options carry no envFiles override
  const serveStart = pluginSource.indexOf("configPath = getValidatedWranglerConfigPath(root, pluginConfig.configPath");
  const serveEnd = pluginSource.indexOf("function workerNameToEnvironmentName");
  assert.ok(serveStart > 0 && serveEnd > serveStart);
  const serveRegion = pluginSource.slice(serveStart, serveEnd);
  assert.ok(!serveRegion.includes("envFiles"), "serve path must not introduce an envFiles override");
  assert.ok(!serveRegion.includes("writeDeployConfig("));
  // the actual serve call site passes only loopback-local options, no envFiles
  const callSite = pluginSource.indexOf("wrangler.unstable_getMiniflareWorkerOptions({");
  assert.ok(callSite > 0, "serve-mode call site not found");
  const callSiteWindow = pluginSource.slice(callSite, callSite + 300);
  assert.ok(callSiteWindow.includes("resolvedPluginConfig.cloudflareEnv"), "serve call site must use the plugin cloudflareEnv");
  assert.ok(!callSiteWindow.includes("envFiles"), "serve call site must not pass envFiles");
});

// ---------------------------------------------------------------------------
// T06/T07/T08: remote bindings, allowlisted fields, local binding contract
// ---------------------------------------------------------------------------

test("T06 test mode passes remoteBindings:false and the installed default true makes that mandatory", () => {
  assert.match(viteSource, /\.\.\.\(e2eWranglerConfigPath \? \{ configPath: e2eWranglerConfigPath, remoteBindings: false as const \} : \{\}\)/);
  assert.ok(!viteSource.includes("remoteBindings: true"));
  assert.ok(pluginSource.includes("pluginConfig.remoteBindings ?? true"), "installed default must stay true so the explicit false is load-bearing");
  assert.ok(pluginSource.includes("!resolvedPluginConfig.remoteBindings ? null : await maybeStartOrUpdateRemoteProxySession("));
  assert.match(serverSource, /REMOTE_BINDING_FLAG/);
});

test("T07 generated config has no account/route/remote fields and validation rejects them", () => {
  validateConfig(synthConfig, { projectRoot: SYNTHETIC_PROJECT });
  expectThrowsWith(
    () => validateConfig({ ...synthConfig, account_id: "real-account-id" }, { projectRoot: SYNTHETIC_PROJECT }),
    "FORBIDDEN_FIELD:account_id",
  );
  expectThrowsWith(() => validateConfig({ ...synthConfig, routes: ["example.com/*"] }, { projectRoot: SYNTHETIC_PROJECT }), "FORBIDDEN_FIELD:routes");
  expectThrowsWith(
    () => validateConfig({ ...synthConfig, d1_databases: [{ ...synthConfig.d1_databases[0], remote: true }] }, { projectRoot: SYNTHETIC_PROJECT }),
    "REMOTE_BINDING_FLAG",
  );
  const keys = Object.keys(synthConfig);
  assert.deepEqual(keys.sort(), [
    "assets",
    "compatibility_date",
    "compatibility_flags",
    "d1_databases",
    "main",
    "name",
    "r2_buckets",
    "triggers",
    "vars",
  ]);
});

test("T08 worker entry/migrations stay absolute project paths and D1/R2 binding names hold", () => {
  assert.equal(synthConfig.main, path.resolve(SYNTHETIC_PROJECT, "worker", "index.ts"));
  assert.equal(synthConfig.d1_databases[0].migrations_dir, path.resolve(SYNTHETIC_PROJECT, "drizzle", "migrations"));
  assert.equal(synthConfig.d1_databases[0].binding, "DB");
  assert.equal(synthConfig.d1_databases[0].database_name, "exportflow-local");
  assert.equal(synthConfig.r2_buckets[0].binding, "DOCUMENTS");
  expectThrowsWith(
    () => validateConfig({ ...synthConfig, main: "worker/index.ts" }, { projectRoot: SYNTHETIC_PROJECT }),
    "MAIN_NOT_PROJECT_ENTRY",
  );
  expectThrowsWith(
    () =>
      validateConfig(
        { ...synthConfig, d1_databases: [{ ...synthConfig.d1_databases[0], migrations_dir: "drizzle/migrations" }] },
        { projectRoot: SYNTHETIC_PROJECT },
      ),
    "MIGRATIONS_DIR_NOT_PROJECT_ABSOLUTE",
  );
});

// ---------------------------------------------------------------------------
// T09: guard/junction behavior in a run-owned OS-temp sandbox
// ---------------------------------------------------------------------------

test("T09 the strong guard accepts the real generated paths and rejects junction escapes and non-owned dirs", () => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "exportflow-m01b1-"));
  try {
    const projectRoot = path.join(sandbox, "proj");
    const runRoot = path.join(projectRoot, `${RUN_MARKER}m01b1`);
    mkdirSync(runRoot, { recursive: true });
    const configPath = path.join(runRoot, "wrangler.e2e.generated.jsonc");
    const secretsPath = path.join(runRoot, ".dev.vars.e2e");
    assert.doesNotThrow(() => assertStrongPersist(configPath, { root: projectRoot }));
    assert.doesNotThrow(() => assertStrongPersist(secretsPath, { root: projectRoot }));
    // junction escaping the owned root is refused
    const outside = path.join(sandbox, "outside");
    mkdirSync(outside);
    const link = path.join(runRoot, `${RUN_MARKER}escape`);
    symlinkSync(outside, link, "junction");
    expectThrowsWith(() => assertStrongPersist(link, { root: projectRoot }), "PERSIST_OUTSIDE_PROJECT");
    // a config sibling placed outside any marker dir is refused
    expectThrowsWith(() => assertStrongPersist(path.join(projectRoot, "rogue.jsonc"), { root: projectRoot }), "AUDIT_ROOT_REQUIRED");
    // in-file containment check used by vite.config (pure logic replica)
    const relative = path.relative(runRoot, path.join(runRoot, "sub", "x.jsonc"));
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));
    assert.ok(path.relative(runRoot, projectRoot).startsWith(".."));
  } finally {
    assert.ok(path.basename(sandbox).startsWith("exportflow-m01b1-"));
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T10: no default config selection, no project-config fallback, fail-closed
// ---------------------------------------------------------------------------

test("T10 vite.config has a closed E2E contract with no project-config fallback", () => {
  assert.match(viteSource, /if \(!testMode\) return undefined;/);
  assert.match(viteSource, /EXPORTFLOW_E2E_WRANGLER_CONFIG_REQUIRED/);
  assert.match(viteSource, /EXPORTFLOW_E2E_ENV_MISMATCH/);
  assert.match(viteSource, /EXPORTFLOW_E2E_CONFIG_NOT_ABSOLUTE/);
  assert.match(viteSource, /EXPORTFLOW_E2E_CONFIG_NOT_IN_RUN_ROOT/);
  assert.match(viteSource, /EXPORTFLOW_E2E_CONFIG_MISSING/);
  assert.match(viteSource, /EXPORTFLOW_E2E_DEV_VARS_MISSING/);
  assert.match(viteSource, /assertIsolatedPersist\(configPath, \{ root: process\.cwd\(\), requireRunMarker: true \}\)/);
  assert.ok(!viteSource.includes("findWranglerConfig"));
  assert.ok(!viteSource.includes("wrangler.jsonc"));
  assert.ok(!serverSource.includes("wrangler.jsonc"), "the launcher must not read the project config at all");
});

// ---------------------------------------------------------------------------
// T11: dev/prod branches and the transport workaround stay intact
// ---------------------------------------------------------------------------

test("T11 non-test behavior and the ~320ms transport workaround are preserved", () => {
  assert.match(viteSource, /const persistPath = explicitPersistPath \?\? "\.wrangler\/state";/);
  assert.match(viteSource, /EXPORTFLOW_PERSIST_REQUIRED/);
  assert.match(viteSource, /DEVELOPER_STATE_FORBIDDEN/);
  assert.match(viteSource, /HISTORICAL_TEST_ROOT_FORBIDDEN/);
  assert.equal((viteSource.match(/"\.wrangler\/state"/g) ?? []).length, 1, "the developer-state literal must stay in its dev-only default branch");
  assert.equal((viteSource.match(/\.wrangler-/g) ?? []).length, 13, "wrangler- literals must remain only in the historical denylist");
  assert.match(viteSource, /maxRequestsPerClient: 1/);
  assert.match(viteSource, /keepAliveTimeout: 1/);
  assert.match(viteSource, /workerdBodyGate/);
  assert.match(viteSource, /setTimeout\(resolve, 320\)/);
  assert.match(viteSource, /cloudflare\(\{ persistState: \{ path: persistPath \}, inspectorPort: process\.env\.CI \? false : undefined/);
});

// ---------------------------------------------------------------------------
// T12: child env sanitization
// ---------------------------------------------------------------------------

test("T12 child env is an allowlist: inherited secrets and env channels are dropped", () => {
  const fakeEnv = {
    PATH: "C:/tools",
    SYSTEMROOT: "C:/Windows",
    BETTER_AUTH_SECRET: "leak-me",
    CLOUDFLARE_API_TOKEN: "leak-me",
    CLOUDFLARE_ENV: "production",
    CLOUDFLARE_ACCOUNT_ID: "leak-me",
    VITE_SOMETHING: "leak-me",
    NODE_OPTIONS: "--inspect",
    USERPROFILE: "C:/Users/x",
    APPDATA: "C:/Users/x/AppData/Roaming",
    npm_config_token: "leak-me",
    EXPORTFLOW_TRACE: "1",
  };
  const scoped = evalFunction(serverSource, "buildChildEnv", { path, process: { env: fakeEnv }, CHILD_ENV_ALLOWLIST: childEnvAllowlist });
  const env = scoped({
    runRoot: SYNTHETIC_RUN_ROOT,
    persist: `${SYNTHETIC_RUN_ROOT}/state`,
    port: "43174",
    generatedConfigPath: `${SYNTHETIC_RUN_ROOT}/wrangler.e2e.generated.jsonc`,
  });
  for (const forbidden of ["BETTER_AUTH_SECRET", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ENV", "CLOUDFLARE_ACCOUNT_ID", "VITE_SOMETHING", "NODE_OPTIONS", "USERPROFILE", "APPDATA", "npm_config_token", "EXPORTFLOW_TRACE"]) {
    assert.equal(env[forbidden], undefined, `${forbidden} must not reach the child env`);
  }
  assert.equal(env.PATH, "C:/tools");
  assert.equal(env.TMP, path.join(SYNTHETIC_RUN_ROOT, "tmp"));
  assert.equal(env.TEMP, path.join(SYNTHETIC_RUN_ROOT, "tmp"));
  assert.equal(env.CI, "1");
  assert.equal(env.WRANGLER_SEND_METRICS, "false");
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
  assert.equal(env.EXPORTFLOW_E2E_ROOT, SYNTHETIC_RUN_ROOT);
  assert.equal(env.EXPORTFLOW_PERSIST, `${SYNTHETIC_RUN_ROOT}/state`);
  assert.equal(env.EXPORTFLOW_E2E_WRANGLER_CONFIG_PATH, `${SYNTHETIC_RUN_ROOT}/wrangler.e2e.generated.jsonc`);
  assert.ok(env.CLOUDFLARE_ENV === undefined, "CLOUDFLARE_ENV is added only at the vite spawn site");
});

// ---------------------------------------------------------------------------
// T13: no runtime/test hooks or cleanup in the touched files
// ---------------------------------------------------------------------------

test("T13 the patched files stay free of runtime imports, cleanup calls and historical literals", () => {
  assert.ok(!serverSource.includes("@playwright"));
  assert.ok(!serverSource.includes("vitest"));
  assert.ok(!serverSource.includes("wrangler.jsonc"));
  assert.ok(!/\b(?:rmSync|unlinkSync|rmdirSync|rm)\s*\(/.test(serverSource));
  assert.ok(!serverSource.includes(".wrangler-e2e"));
  assert.ok(!serverSource.includes(".wrangler/state"));
  assert.equal((viteSource.match(/\.wrangler-e2e/g) ?? []).length, 1, "vite.config keeps .wrangler-e2e only inside its historical denylist");
});

// ---------------------------------------------------------------------------
// T14: negative regressions prove the assertions bite
// ---------------------------------------------------------------------------

test("T14 regression: removing --config, flipping remoteBindings, or dropping the REQUIRED throw is detected", () => {
  const noConfigFlag = serverSource.replace('"--config",\n    generatedConfigPath,\n', "");
  assert.notEqual(noConfigFlag, serverSource);
  assert.doesNotMatch(noConfigFlag, /"--config",\s*generatedConfigPath/);

  const flipped = viteSource.replace("remoteBindings: false as const", "remoteBindings: true as const");
  assert.notEqual(flipped, viteSource);
  assert.throws(() => {
    if (flipped.includes("remoteBindings: true")) throw new Error("remoteBindings must be false in test mode");
  });

  const noThrow = viteSource.replace("EXPORTFLOW_E2E_WRANGLER_CONFIG_REQUIRED", "EXPORTFLOW_E2E_WRANGLER_CONFIG_MAYBE");
  assert.notEqual(noThrow, viteSource);
  assert.doesNotMatch(noThrow, /EXPORTFLOW_E2E_WRANGLER_CONFIG_REQUIRED/);

  const noDevVarsWrite = serverSource.replace('const devVarsPath = path.join(runRoot, ".dev.vars.e2e");', "");
  assert.notEqual(noDevVarsWrite, serverSource);
  assert.doesNotMatch(noDevVarsWrite, /const devVarsPath = path\.join\(runRoot, "\.dev\.vars\.e2e"\);/);

  // the builder itself refuses a real account id
  expectThrowsWith(
    () => validateConfig({ ...synthConfig, account_id: "6f3a1b2c8d9e0f1a2b3c4d5e6f7a8b9c0123456789abcdef0123456789abcdef".slice(0, 32) }, { projectRoot: SYNTHETIC_PROJECT }),
    "FORBIDDEN_FIELD:account_id",
  );
});
