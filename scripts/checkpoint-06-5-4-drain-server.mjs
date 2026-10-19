import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const persist = path.resolve(root, ".wrangler-0654-drain/state");
const real = realpathSync(persist);
const developer = realpathSync(path.resolve(root, ".wrangler/state"));
if (real === developer || real.startsWith(developer + path.sep)) {
  throw new Error("Refusing to bind the drain server to the developer D1 directory.");
}
if (!real.startsWith(path.resolve(root, ".wrangler-0654-drain"))) {
  throw new Error("Drain persist path escaped .wrangler-0654-drain.");
}
const port = "43179";
const base = `http://127.0.0.1:${port}`;
mkdirSync(path.dirname(persist), { recursive: true });
const varsPath = path.resolve(root, ".dev.vars.cp0654drain");
writeFileSync(
  varsPath,
  [
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
    `BETTER_AUTH_URL=${base}`,
    `BOOTSTRAP_SECRET=${randomBytes(24).toString("base64url")}`,
    "EXPORTFLOW_TRACE=1",
    "EXPORTFLOW_FIXTURE=cp0654drain",
    "",
  ].join("\n"),
);
console.log(`drain vars written name=.dev.vars.cp0654drain port=${port}`);
const vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    EXPORTFLOW_PORT: port,
    EXPORTFLOW_PERSIST: persist,
    EXPORTFLOW_TRACE: "1",
    CLOUDFLARE_ENV: "cp0654drain",
    CI: "1",
  },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => vite.kill("SIGTERM"));
process.on("SIGINT", () => vite.kill("SIGINT"));
