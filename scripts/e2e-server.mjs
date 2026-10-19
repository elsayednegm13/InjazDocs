import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const persist = path.join(root, ".wrangler-e2e/state");
const port = process.env.EXPORTFLOW_PORT || "43174";
const base = `http://127.0.0.1:${port}`;

rmSync(path.join(root, ".wrangler-e2e"), { recursive: true, force: true });
mkdirSync(path.dirname(persist), { recursive: true });
const bootstrapSecret = randomBytes(24).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");
const admin = {
  email: "e2e-admin@example.com",
  password: `E2e-${randomBytes(12).toString("base64url")}`,
  bootstrapSecret,
  base,
};
const traceLine = process.env.EXPORTFLOW_TRACE === "1" ? "EXPORTFLOW_TRACE=1\n" : "";
writeFileSync(path.join(root, ".dev.vars.e2e"), `BETTER_AUTH_SECRET=${authSecret}\nBETTER_AUTH_URL=${base}\nBOOTSTRAP_SECRET=${bootstrapSecret}\nEXPORTFLOW_TEST_FAULTS=1\n${traceLine}`);
writeFileSync(path.join(root, ".wrangler-e2e/admin.json"), JSON.stringify(admin, null, 2));

const migrate = spawn(
  process.execPath,
  [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "migrations", "apply", "exportflow-local", "--local", "--persist-to", persist],
  { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } },
);
const migrateCode = await new Promise((resolve) => migrate.on("close", resolve));
if (migrateCode !== 0) process.exit(migrateCode ?? 1);

const vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    EXPORTFLOW_PORT: port,
    EXPORTFLOW_PERSIST: persist,
    CLOUDFLARE_ENV: "e2e",
    CI: "1",
  },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => vite.kill("SIGTERM"));
process.on("SIGINT", () => vite.kill("SIGINT"));
