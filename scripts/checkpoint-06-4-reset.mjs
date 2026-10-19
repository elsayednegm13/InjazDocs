import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertPerfPath, perfRoot } from "./checkpoint-06-4-guard.mjs";

const root = process.cwd();
const target = assertPerfPath(perfRoot);
rmSync(target, { recursive: true, force: true });
mkdirSync(path.join(target, "state"), { recursive: true });
writeFileSync(path.join(target, "ISOLATED.txt"), "Disposable performance state. Not the developer database.\n");

const port = "43176";
const base = `http://127.0.0.1:${port}`;
const secret = randomBytes(24).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");
const adminPassword = `Perf-${randomBytes(9).toString("base64url")}`;
const officerPassword = `Perf-${randomBytes(9).toString("base64url")}`;
writeFileSync(path.join(root, ".dev.vars.perf"), `BETTER_AUTH_SECRET=${authSecret}\nBETTER_AUTH_URL=${base}\nBOOTSTRAP_SECRET=${secret}\nEXPORTFLOW_TRACE=1\n`);
writeFileSync(path.join(target, "accounts.json"), JSON.stringify({
  base,
  email: "perf-admin@example.com",
  password: adminPassword,
  officerEmail: "perf-officer@example.com",
  officerPassword,
  bootstrapSecret: secret,
}, null, 2));

const migrate = spawn(process.execPath, [
  path.join(root, "node_modules/wrangler/bin/wrangler.js"),
  "d1", "migrations", "apply", "exportflow-local", "--local", "--persist-to", path.join(target, "state"),
], { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } });
const code = await new Promise((resolve) => migrate.on("close", resolve));
if (code !== 0) process.exit(code ?? 1);
console.log("perf database migrated");
