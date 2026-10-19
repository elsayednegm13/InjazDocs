import { spawn } from "node:child_process";
import path from "node:path";
import { assertPerfPath, perfRoot } from "./checkpoint-06-4-guard.mjs";

const root = process.cwd();
const persist = assertPerfPath(path.join(perfRoot, "state"));
const port = process.env.EXPORTFLOW_PORT || "43176";
const vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    EXPORTFLOW_PORT: port,
    EXPORTFLOW_PERSIST: persist,
    CLOUDFLARE_ENV: "perf",
    EXPORTFLOW_TRACE: "1",
  },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => vite.kill("SIGTERM"));
process.on("SIGINT", () => vite.kill("SIGINT"));
