/**
 * Fail a local build when publishable output contains local secret files,
 * persistence databases, or configured secret values.
 * Prints paths and variable names only. Never prints values.
 */
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_KEY = /SECRET|PASSWORD|PRIVATE|TOKEN|ACCESS_KEY|API_KEY/i;
const ALLOWED_NAMES = new Set([".env.example", ".dev.vars.example"]);

export function isProhibitedPublishName(name) {
  if (ALLOWED_NAMES.has(name)) return false;
  if (name === ".dev.vars" || name.startsWith(".dev.vars.")) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx|jks)$/i.test(name)) return true;
  if (/\.sqlite(-journal)?$/i.test(name)) return true;
  if (name === "id_rsa" || name === "id_ed25519") return true;
  return false;
}

export function scanPublishTree(root) {
  const violations = [];
  const resolved = path.resolve(root);
  if (!statExists(resolved)) return violations;
  walk(resolved, (filePath, entry) => {
    const relative = path.relative(resolved, filePath);
    const parts = relative.split(path.sep);
    if (parts.includes(".wrangler")) {
      violations.push({ kind: "persistence", path: relative });
      return;
    }
    if (entry.isFile() && isProhibitedPublishName(entry.name)) {
      violations.push({ kind: "file", path: relative });
    }
  });
  return violations;
}

export function stripCopiedDevVars(root) {
  const resolved = assertGeneratedRoot(root);
  const removed = [];
  walk(resolved, (filePath, entry) => {
    if (!entry.isFile()) return;
    if (entry.name === ".dev.vars" || entry.name.startsWith(".dev.vars.") || entry.name === ".env" || (entry.name.startsWith(".env.") && entry.name !== ".env.example")) {
      if (ALLOWED_NAMES.has(entry.name)) return;
      rmSync(filePath);
      removed.push(path.relative(resolved, filePath));
    }
  });
  return removed;
}

export function findConfiguredValueLeaks(root, assignments) {
  const leaks = [];
  const needles = assignments.filter((item) => SECRET_KEY.test(item.key) && item.value.length >= 16);
  if (!needles.length || !statExists(path.resolve(root))) return leaks;
  const files = [];
  walk(path.resolve(root), (filePath, entry) => {
    if (!entry.isFile()) return;
    if (!/\.(js|mjs|css|html|map|json|txt)$/i.test(entry.name)) return;
    if (isProhibitedPublishName(entry.name)) return;
    files.push(filePath);
  });
  for (const filePath of files) {
    const text = readFileSync(filePath);
    for (const item of needles) {
      if (text.includes(Buffer.from(item.value))) leaks.push({ key: item.key, path: path.relative(path.resolve(root), filePath) });
    }
  }
  return leaks;
}

export function parseAssignments(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    rows.push({ key, value });
  }
  return rows;
}

function assertGeneratedRoot(root) {
  const resolved = path.resolve(root);
  if (path.basename(resolved) !== "dist") {
    throw new Error("Refusing to delete files outside a directory named dist");
  }
  if (resolved.split(path.sep).includes(".wrangler")) {
    throw new Error("Refusing to delete Wrangler state");
  }
  return resolved;
}

function statExists(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    visit(filePath, entry);
    if (entry.isDirectory()) walk(filePath, visit);
  }
}

function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const root = rootFlag >= 0 ? args[rootFlag + 1] : "dist";
  const valuesFlag = args.indexOf("--values");
  const valuesPath = valuesFlag >= 0 ? args[valuesFlag + 1] : "";
  if (args.includes("--strip-copied-vars")) {
    const removed = stripCopiedDevVars(root);
    for (const item of removed) console.log(`removed ${item}`);
  }
  const violations = scanPublishTree(root);
  let leaks = [];
  if (valuesPath && statExists(path.resolve(valuesPath))) {
    leaks = findConfiguredValueLeaks(root, parseAssignments(readFileSync(valuesPath, "utf8")));
  }
  if (!violations.length && !leaks.length) {
    console.log(`publishable output is clean: ${root}`);
    return;
  }
  for (const item of violations) console.error(`prohibited ${item.kind}: ${item.path}`);
  for (const item of leaks) console.error(`configured value present for ${item.key} in ${item.path}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
