/**
 * Fail closed before any staging deploy or remote migration.
 * Does not call Cloudflare and does not print secret values.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const staging = config.env?.staging;
const problems = [];

if (!staging) {
  problems.push("wrangler.jsonc has no env.staging. Refusing remote deploy.");
} else {
  const databaseId = staging.d1_databases?.[0]?.database_id ?? "";
  const databaseName = staging.d1_databases?.[0]?.database_name ?? "";
  const bucket = staging.r2_buckets?.[0]?.bucket_name ?? "";
  if (!databaseId || databaseId === "local-exportflow-not-a-remote-id") {
    problems.push("staging D1 id is missing or still the local placeholder.");
  }
  if (/nexora/i.test(databaseName) || /nexora/i.test(bucket)) {
    problems.push("staging bindings match an unrelated Nexora resource.");
  }
  if (bucket === "exportflow-documents-local" || databaseName === "exportflow-local") {
    problems.push("staging still points at local resource names.");
  }
}

if (existsSync(new URL("../dist", import.meta.url))) {
  const guard = spawnSync(process.execPath, ["scripts/build-artifact-guard.mjs", "--root", "dist", "--values", ".dev.vars"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (guard.status !== 0) {
    problems.push("publishable output still contains a local vars file or a configured credential value.");
  }
}

if (problems.length) {
  console.error("CLOUD CHECKPOINT BLOCKED");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(2);
}

console.log("staging preflight names are present. This does not prove a deploy or an upload.");
