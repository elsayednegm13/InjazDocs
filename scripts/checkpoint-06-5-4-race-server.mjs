import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const folder = path.resolve(root, ".wrangler-0654-race");
const persist = path.join(folder, "state");
const developer = realpathSync(path.resolve(root, ".wrangler/state"));
if (path.resolve(folder) === path.resolve(root, ".wrangler") || path.resolve(persist).startsWith(developer)) {
  throw new Error("Refusing to use the developer persist directory.");
}
rmSync(folder, { recursive: true, force: true });
mkdirSync(persist, { recursive: true });
const port = "43178";
const base = `http://127.0.0.1:${port}`;
const admin = {
  email: "cp0654-admin@example.com",
  password: `Race-${randomBytes(12).toString("base64url")}`,
  bootstrapSecret: randomBytes(24).toString("base64url"),
  base,
};
writeFileSync(path.join(folder, "admin.json"), JSON.stringify(admin));
const fault = process.env.CP0654_FAULT || "0";
if (!/^[a-z0-9-]{1,40}$/.test(fault)) throw new Error("Refusing an unexpected fault token.");
writeFileSync(
  path.resolve(root, ".dev.vars.cp0654"),
  [
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
    `BETTER_AUTH_URL=${base}`,
    `BOOTSTRAP_SECRET=${admin.bootstrapSecret}`,
    `EXPORTFLOW_TEST_FAULTS=${fault}`,
    "EXPORTFLOW_TRACE=1",
    "EXPORTFLOW_FIXTURE=cp0654",
    "",
  ].join("\n"),
);
console.log(`race vars written name=.dev.vars.cp0654 port=${port} fault=${fault}`);
const migrate = spawn(
  process.execPath,
  [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "migrations", "apply", "exportflow-local", "--local", "--persist-to", persist],
  { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } },
);
const migrateCode = await new Promise((resolve) => migrate.on("close", resolve));
if (migrateCode !== 0) process.exit(migrateCode ?? 1);
const real = realpathSync(persist);
if (real === developer || real.startsWith(developer + path.sep)) {
  throw new Error("Migrated persist resolved to the developer D1 directory.");
}
const vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    EXPORTFLOW_PORT: port,
    EXPORTFLOW_PERSIST: persist,
    EXPORTFLOW_TRACE: "1",
    CLOUDFLARE_ENV: "cp0654",
    CI: "1",
  },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => vite.kill("SIGTERM"));
process.on("SIGINT", () => vite.kill("SIGINT"));
