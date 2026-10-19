import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const roots = ["src", "server", "scripts", "drizzle"];
const extra = ["package.json", "pnpm-lock.yaml", "vite.config.ts", "wrangler.jsonc", "playwright.config.ts", "tsconfig.json"];
const skip = new Set([".dev.vars", ".dev.vars.e2e", ".dev.vars.perf", ".dev.vars.example"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mjs|sql|css|json|jsonc)$/.test(entry.name) && !skip.has(entry.name)) {
      out.push(full);
    }
  }
}

const files = [...extra];
for (const root of roots) walk(root, files);
const rows = files.sort().map((file) => {
  const bytes = readFileSync(file);
  return { file: file.replaceAll("\\", "/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const dev = statSync(".wrangler/state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite");
mkdirSync("docs/performance/checkpoint-06-5", { recursive: true });
const payload = {
  capturedAt: new Date().toISOString(),
  developerDb: { bytes: dev.size, mtime: dev.mtime.toISOString() },
  fileCount: rows.length,
  rows,
};
writeFileSync("docs/performance/checkpoint-06-5/source-hashes.json", JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ fileCount: rows.length, developerBytes: dev.size, developerMtime: dev.mtime.toISOString() }));
