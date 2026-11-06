import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// M01-A.3 setup import contract closure (OA-01). Everything below is static
// text inspection of ordinary project source files plus one behavioral call
// into the pure fail-closed helper. Nothing imports or executes the Playwright
// config, any E2E spec, the web server, Vite, Wrangler or a database, and no
// protected path is ever resolved on disk. The only dynamic import is
// e2e/helpers.ts, whose module body is pure declarations; its only imported
// module with top-level code, scripts/isolation-guard.mjs, runs main() solely
// when executed directly as a script. Negative fixtures are in-memory strings.

function readProjectFile(relative) {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

const setupRaw = readProjectFile("e2e/setup.spec.ts");
const helpersRaw = readProjectFile("e2e/helpers.ts");
const configRaw = readProjectFile("playwright.config.ts");
const serverRaw = readProjectFile("scripts/e2e-server.mjs");

// Mirrors PROTECTED_ROOTS in scripts/isolation-guard.mjs. These literals must
// never appear in the setup flow or its config.
const PROTECTED_ROOT_LITERALS = [
  ".wrangler/state",
  ".wrangler-e2e",
  ".wrangler-perf",
  ".wrangler-reliability-b",
  ".wrangler-0653",
  ".wrangler-0654-drain",
  ".wrangler-0654-race",
  ".wrangler-verify",
  ".wrangler-transition-audit-20261020-c",
  ".wrangler-transition-audit-20261020-u",
  ".wrangler-transition-audit-20261020-p",
  ".wrangler-transition-audit-20261020-f",
  ".wrangler-transition-audit-20261020-h",
  ".wrangler-transition-audit-20261020-cwd",
];

// ---------------------------------------------------------------------------
// Minimal source masker: replaces comments, string/template-literal text and
// regex literals with spaces (length-preserving) so identifier scans only see
// real code. Template ${...} expressions stay code. This is deliberately not a
// full JS parser; it only has to be sound for the four files inspected here.
// ---------------------------------------------------------------------------

function maskSource(source) {
  const out = source.split("");
  const n = source.length;
  const blank = (start, end) => {
    for (let k = start; k < end && k < n; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  const lastCodeToken = (index) => {
    let k = index - 1;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k -= 1;
    const word = out.slice(k + 1, index).join("");
    if (word) return word;
    while (k >= 0 && /\s/.test(out[k])) k -= 1;
    return out[k] ?? "";
  };
  const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";"]);
  const REGEX_PRECEDER_WORDS = new Set(["return", "typeof", "case", "in", "of", "instanceof", "delete", "void", "do", "else"]);
  let i = 0;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1] ?? "";
    if (ch === "/" && next === "/") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
      const end = Math.min(j + 1, n);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "`") {
      i += 1;
      while (i < n && source[i] !== "`") {
        if (source[i] === "\\") {
          blank(i, i + 2);
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const c = source[i];
            if (c === "{") depth += 1;
            else if (c === "}") {
              depth -= 1;
              if (depth === 0) break;
            } else if (c === '"' || c === "'" || c === "`") {
              i += 1;
              while (i < n && source[i] !== c) {
                if (source[i] === "\\") i += 1;
                i += 1;
              }
            }
            i += 1;
          }
          i += 1; // past the closing "}"
          continue;
        }
        out[i] = " ";
        i += 1;
      }
      if (i < n) {
        out[i] = " "; // closing backtick
        i += 1;
      }
      continue;
    }
    if (ch === "/") {
      const token = lastCodeToken(i);
      const startsRegex =
        next !== "/" && next !== "*" && (REGEX_PRECEDERS.has(token) || REGEX_PRECEDER_WORDS.has(token));
      if (startsRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const c = source[j];
          if (c === "\\") {
            j += 2;
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) break;
          else if (c === "\n") break; // not a regex literal after all
          j += 1;
        }
        if (j < n && source[j] === "/") {
          let k = j + 1;
          while (k < n && /[A-Za-z]/.test(source[k])) k += 1;
          blank(i, k);
          i = k;
          continue;
        }
      }
    }
    i += 1;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Import declaration parser: accepts default, named, aliased, namespace and
// type-only imports (both `import type ...` and inline `type X`).
// ---------------------------------------------------------------------------

function parseClause(clause) {
  const bindings = [];
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of clause) {
    if (ch === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        parts.push({ named: true, text: current.trim() });
        current = "";
        continue;
      }
    } else if (depth === 0 && ch === ",") {
      parts.push({ named: false, text: current.trim() });
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push({ named: false, text: current.trim() });
  for (const part of parts) {
    if (part.named) {
      for (const piece of part.text.split(",")) {
        const item = piece.trim();
        if (!item) continue;
        const typeOnly = /^type\s+/.test(item);
        const cleaned = item.replace(/^type\s+/, "");
        const asMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        if (asMatch) bindings.push({ local: asMatch[2], imported: asMatch[1], kind: "named", typeOnly });
        else if (/^[A-Za-z_$][\w$]*$/.test(cleaned)) bindings.push({ local: cleaned, imported: cleaned, kind: "named", typeOnly });
      }
    } else {
      const item = part.text;
      const nsMatch = item.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (nsMatch) bindings.push({ local: nsMatch[1], imported: "*", kind: "namespace", typeOnly: false });
      else if (/^[A-Za-z_$][\w$]*$/.test(item)) bindings.push({ local: item, imported: "default", kind: "default", typeOnly: false });
    }
  }
  return bindings;
}

function parseImportDeclarations(masked, raw) {
  const bindings = [];
  const spans = [];
  const re = /\bimport\b/g;
  let m;
  while ((m = re.exec(masked))) {
    const slice = raw.slice(m.index);
    const fromMatch = slice.match(/^import\s+(type\s+)?([\s\S]*?)\s*from\s*(["'])([^"'\n]+)\3/);
    let typeOnly = false;
    let clause = "";
    let specifier = null;
    let consumed = 0;
    if (fromMatch) {
      typeOnly = Boolean(fromMatch[1]);
      clause = fromMatch[2];
      specifier = fromMatch[4];
      consumed = fromMatch[0].length;
    } else {
      const bareMatch = slice.match(/^import\s*(["'])([^"'\n]+)\1/);
      if (!bareMatch) continue; // dynamic import( or import.meta — not a declaration
      specifier = bareMatch[2];
      consumed = bareMatch[0].length;
    }
    const semi = slice.slice(consumed).match(/^\s*;/);
    spans.push([m.index, m.index + consumed + (semi ? semi[0].length : 0)]);
    if (!clause) continue;
    for (const binding of parseClause(clause)) {
      bindings.push({ ...binding, module: specifier, typeOnly: typeOnly || binding.typeOnly });
    }
  }
  return { bindings, spans };
}

function blankSpans(masked, spans) {
  const chars = masked.split("");
  for (const [start, end] of spans) {
    for (let k = start; k < end && k < chars.length; k++) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "await", "async", "new", "if", "else", "throw",
  "as", "from", "import", "export", "type", "true", "false", "null", "undefined", "this",
  "typeof", "void", "in", "of", "for", "while", "do", "switch", "case", "break", "continue",
  "try", "catch", "finally", "class", "extends", "default", "delete", "instanceof", "super",
  "yield", "require",
]);

// Identifier references in value position. Member accesses (x.y) and object
// keys / labels (x:) are skipped; for these sources no watched identifier ever
// sits directly before ":" in a ternary, so the key heuristic is safe.
function collectReferences(code) {
  const refs = new Map();
  const re = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[0];
    if (JS_KEYWORDS.has(name)) continue;
    let p = m.index - 1;
    while (p >= 0 && /\s/.test(code[p])) p -= 1;
    if (p >= 0 && code[p] === ".") continue;
    let q = m.index + name.length;
    while (q < code.length && /\s/.test(code[q])) q += 1;
    if (q < code.length && code[q] === ":") continue;
    refs.set(name, (refs.get(name) ?? 0) + 1);
  }
  return refs;
}

function collectExports(masked) {
  const names = new Set();
  const patterns = [
    /\bexport\s+async\s+function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(masked))) names.add(m[1]);
  }
  const braceRe = /\bexport\s*\{([^}]*)\}/g;
  let b;
  while ((b = braceRe.exec(masked))) {
    for (const piece of b[1].split(",")) {
      const item = piece.trim();
      if (!item) continue;
      const asMatch = item.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) names.add(asMatch[2]);
      else if (/^[A-Za-z_$][\w$]*$/.test(item)) names.add(item);
    }
  }
  return names;
}

// Core binding-coverage checker. requiredFrom maps identifiers that MUST be
// referenced and MUST resolve through an import of the exact module.
function checkContract(source, helperExportNames, requiredFrom) {
  const problems = [];
  const masked = maskSource(source);
  const { bindings, spans } = parseImportDeclarations(masked, source);
  const refs = collectReferences(blankSpans(masked, spans));
  const bindingByLocal = new Map(bindings.map((b) => [b.local, b]));

  for (const [name, module] of Object.entries(requiredFrom)) {
    if (!refs.has(name)) {
      problems.push(`required-unused:${name}`);
      continue;
    }
    const binding = bindingByLocal.get(name);
    if (!binding) {
      problems.push(`unbound:${name}`);
      continue;
    }
    if (binding.typeOnly) problems.push(`type-only-value-use:${name}`);
    if (binding.module !== module) problems.push(`wrong-module:${name}:${binding.module}`);
  }
  for (const name of helperExportNames) {
    if (!refs.has(name)) continue;
    const binding = bindingByLocal.get(name);
    if (!binding) problems.push(`unbound-helper:${name}`);
    else if (binding.module !== "./helpers") problems.push(`wrong-helper-module:${name}:${binding.module}`);
  }
  for (const binding of bindings) {
    if (binding.module !== "./helpers" || binding.kind !== "named" || binding.typeOnly) continue;
    if (refs.has(binding.local) && !helperExportNames.has(binding.imported)) {
      problems.push(`unknown-helper-export:${binding.imported}`);
    }
  }
  return { problems, refs, bindings };
}

const helperExports = collectExports(maskSource(helpersRaw));
const SETUP_REQUIRED = {
  path: "node:path",
  e2eRunRoot: "./helpers",
  expect: "@playwright/test",
  test: "@playwright/test",
};

function protectedLiteralsIn(text) {
  return PROTECTED_ROOT_LITERALS.filter((literal) => text.includes(literal));
}

function setupStorageProblems(source) {
  const problems = [];
  if (!/const runRoot = e2eRunRoot\(\);/.test(source)) problems.push("runroot-not-from-helper");
  if (!/storageState\(\{\s*path:\s*path\.join\(runRoot,\s*"admin-state\.json"\)\s*\}\)/.test(source)) {
    problems.push("storage-state-not-runroot-derived");
  }
  const code = blankSpans(maskSource(source), parseImportDeclarations(maskSource(source), source).spans);
  if ((code.match(/\be2eRunRoot\s*\(\s*\)/g) ?? []).length !== 1) problems.push("runroot-source-count-not-one");
  if ((code.match(/storageState\s*\(\s*\{/g) ?? []).length !== 1) problems.push("storage-state-count-not-one");
  problems.push(...protectedLiteralsIn(source).map((literal) => `protected-literal:${literal}`));
  return problems;
}

function configAgreementProblems(configText, setupText) {
  const problems = [];
  if (!setupText.includes('path.join(runRoot, "admin-state.json")')) problems.push("setup-storage-not-runroot-derived");
  if (!configText.includes('path.join(runRoot, "admin-state.json")')) problems.push("config-storage-not-runroot-derived");
  if (!configText.includes("EXPORTFLOW_E2E_ROOT: runRoot")) problems.push("config-webserver-root-not-propagated");
  if (!configText.includes("storageState: e2eStorageState()")) problems.push("config-project-storage-not-wired");
  if (!configText.includes("testMatch: /setup\\.spec\\.ts/")) problems.push("config-setup-project-match-missing");
  if (!configText.includes('dependencies: ["setup"]')) problems.push("config-e2e-depends-on-setup-missing");
  const spanStart = configText.indexOf("const runRoot = (() => {");
  const spanEnd = spanStart >= 0 ? configText.indexOf("})();", spanStart) : -1;
  const span = spanStart >= 0 && spanEnd > spanStart ? configText.slice(spanStart, spanEnd + 4) : "";
  if (!span) {
    problems.push("config-runroot-span-missing");
  } else {
    if (!span.includes("process.env.EXPORTFLOW_E2E_ROOT")) problems.push("config-runroot-not-explicit-env");
    if (!span.includes("EXPORTFLOW_E2E_ROOT_REQUIRED")) problems.push("config-runroot-not-fail-closed");
    if (!span.includes("path.resolve")) problems.push("config-runroot-not-resolved");
  }
  return problems;
}

function failClosedProblems(helpersText, configText, serverText) {
  const problems = [];
  const start = helpersText.indexOf("export function e2eRunRoot");
  const end = start >= 0 ? helpersText.indexOf("\n}", start) + 2 : -1;
  const body = start >= 0 && end > start ? helpersText.slice(start, end) : "";
  if (!body) {
    problems.push("e2erunroot-body-missing");
  } else {
    if (!body.includes("process.env.EXPORTFLOW_E2E_ROOT")) problems.push("helper-not-explicit-env");
    if (!body.includes("EXPORTFLOW_E2E_ROOT_REQUIRED")) problems.push("helper-not-fail-closed");
    if (!/return assertIsolatedPersist\(explicit, \{ root, requireRunMarker: true \}(?: as [A-Za-z_$][\w$]*)?\);/.test(body)) {
      problems.push("helper-return-not-guarded");
    }
    if ((body.match(/\breturn\b/g) ?? []).length !== 1) problems.push("helper-alternate-return");
    if (/\|\|\s*["'`]/.test(body) || /\?\?\s*["'`]/.test(body)) problems.push("helper-env-fallback");
    if (body.includes(".wrangler") || body.includes("mkdtemp") || body.includes("tmpdir")) {
      problems.push("helper-hardcoded-or-temp-fallback");
    }
  }
  if (!configText.includes("EXPORTFLOW_E2E_ROOT_REQUIRED")) problems.push("config-not-fail-closed");
  if (!serverText.includes("EXPORTFLOW_E2E_ROOT_REQUIRED")) problems.push("server-not-fail-closed");
  if (!serverText.includes("EXPORTFLOW_E2E_ROOT_NOT_FRESH")) problems.push("server-no-freshness-refusal");
  // The fail-closed exit must precede the first mkdirSync CALL; the word also
  // appears in the fs import line, which is not a filesystem effect.
  if (serverText.indexOf("EXPORTFLOW_E2E_ROOT_REQUIRED") > serverText.indexOf("mkdirSync(")) {
    problems.push("server-guard-after-mkdir");
  }
  return problems;
}

// ---------------------------------------------------------------------------
// STATIC CONTRACT
// ---------------------------------------------------------------------------

test("M01-A3 static: setup.spec.ts resolves every referenced contract identifier through real imports", () => {
  const { problems } = checkContract(setupRaw, helperExports, SETUP_REQUIRED);
  assert.deepEqual(problems, []);
});

test("M01-A3 static: the e2eRunRoot binding resolves to the genuine ./helpers export", () => {
  assert.ok(helperExports.has("e2eRunRoot"), "e2e/helpers.ts must export e2eRunRoot");
  assert.match(helpersRaw, /export function e2eRunRoot\(\): string \{/);
  const { bindings, refs } = checkContract(setupRaw, helperExports, SETUP_REQUIRED);
  assert.ok(refs.has("e2eRunRoot"), "setup.spec.ts must actually call e2eRunRoot");
  const binding = bindings.find((b) => b.imported === "e2eRunRoot" && b.module === "./helpers" && !b.typeOnly);
  assert.ok(binding, "e2eRunRoot must be imported from ./helpers as a value");
  // Every referenced ./helpers name must be a real export of that module.
  const referencedHelperNames = bindings
    .filter((b) => b.module === "./helpers" && refs.has(b.local) && !b.typeOnly)
    .map((b) => b.imported);
  assert.ok(referencedHelperNames.length >= 1);
  for (const name of referencedHelperNames) {
    assert.ok(helperExports.has(name), `./helpers has no export named ${name}`);
  }
});

test("M01-A3 static: setup storageState derives from e2eRunRoot with no hardcoded historical path", () => {
  assert.deepEqual(setupStorageProblems(setupRaw), []);
  assert.deepEqual(protectedLiteralsIn(configRaw), []);
});

test("M01-A3 static: setup and Playwright config agree on <runRoot>/admin-state.json", () => {
  assert.deepEqual(configAgreementProblems(configRaw, setupRaw), []);
  // The server consumes the same explicit root for its own run files.
  assert.ok(serverRaw.includes('path.join(runRoot, "state")'));
  assert.ok(serverRaw.includes('path.join(runRoot, "admin.json")'));
});

test("M01-A3 static: the explicit run-root contract fails closed with no fallback", () => {
  assert.deepEqual(failClosedProblems(helpersRaw, configRaw, serverRaw), []);
});

test("M01-A3 behavior: e2eRunRoot() throws EXPORTFLOW_E2E_ROOT_REQUIRED when the root is absent", async () => {
  // Pure declaration module: importing it starts nothing. The guard throws on
  // a missing/blank env value before any path resolution can happen.
  const saved = process.env.EXPORTFLOW_E2E_ROOT;
  delete process.env.EXPORTFLOW_E2E_ROOT;
  try {
    const helpers = await import("../../e2e/helpers.ts");
    await assert.rejects(async () => helpers.e2eRunRoot(), /EXPORTFLOW_E2E_ROOT_REQUIRED/);
    process.env.EXPORTFLOW_E2E_ROOT = "";
    await assert.rejects(async () => helpers.e2eRunRoot(), /EXPORTFLOW_E2E_ROOT_REQUIRED/);
    process.env.EXPORTFLOW_E2E_ROOT = "   ";
    await assert.rejects(async () => helpers.e2eRunRoot(), /EXPORTFLOW_E2E_ROOT_REQUIRED/);
  } finally {
    if (saved === undefined) delete process.env.EXPORTFLOW_E2E_ROOT;
    else process.env.EXPORTFLOW_E2E_ROOT = saved;
  }
});

// ---------------------------------------------------------------------------
// NEGATIVE REGRESSIONS — in-memory mutated copies only
// ---------------------------------------------------------------------------

test("M01-A3 regression: removing the node:path import is detected as unbound", () => {
  const mutated = setupRaw.replace('import path from "node:path";\n', "");
  assert.notEqual(mutated, setupRaw);
  const { problems } = checkContract(mutated, helperExports, SETUP_REQUIRED);
  assert.ok(problems.includes("unbound:path"), `expected unbound:path, got ${JSON.stringify(problems)}`);
});

test("M01-A3 regression: removing e2eRunRoot from the helpers import is detected as unbound", () => {
  const mutated = setupRaw.replace("clearViteOverlay, e2eRunRoot, login", "clearViteOverlay, login");
  assert.notEqual(mutated, setupRaw);
  const { problems } = checkContract(mutated, helperExports, SETUP_REQUIRED);
  assert.ok(problems.includes("unbound:e2eRunRoot"), `expected unbound:e2eRunRoot, got ${JSON.stringify(problems)}`);
});

test("M01-A3 regression: a hardcoded protected storageState path in setup fails both checks", () => {
  const mutated = setupRaw.replace(
    'path.join(runRoot, "admin-state.json")',
    '".wrangler-e2e/admin-state.json"',
  );
  assert.notEqual(mutated, setupRaw);
  const problems = setupStorageProblems(mutated);
  assert.ok(problems.includes("storage-state-not-runroot-derived"), JSON.stringify(problems));
  assert.ok(problems.includes("protected-literal:.wrangler-e2e"), JSON.stringify(problems));
});

test("M01-A3 regression: a hardcoded admin-state path in the Playwright config breaks the agreement", () => {
  const mutated = configRaw.replace(
    'path.join(runRoot, "admin-state.json")',
    '".wrangler-e2e/admin-state.json"',
  );
  assert.notEqual(mutated, configRaw);
  const problems = configAgreementProblems(mutated, setupRaw);
  assert.ok(problems.includes("config-storage-not-runroot-derived"), JSON.stringify(problems));
  assert.ok(protectedLiteralsIn(mutated).includes(".wrangler-e2e"));
});

test("M01-A3 regression: an env fallback default inside the helper is detected", () => {
  const mutated = helpersRaw.replace(
    "const explicit = process.env.EXPORTFLOW_E2E_ROOT;",
    'const explicit = process.env.EXPORTFLOW_E2E_ROOT || ".wrangler-e2e";',
  );
  assert.notEqual(mutated, helpersRaw);
  const problems = failClosedProblems(mutated, configRaw, serverRaw);
  assert.ok(problems.includes("helper-env-fallback"), JSON.stringify(problems));
  assert.ok(problems.includes("helper-hardcoded-or-temp-fallback"), JSON.stringify(problems));
});

test("M01-A3 parser control: valid aliased import styles still satisfy binding coverage", () => {
  const aliased = setupRaw
    .replace('import path from "node:path";\n', "")
    .replace(
      'import { adminCreds, clearViteOverlay, e2eRunRoot, login } from "./helpers";',
      'import { adminCreds, clearViteOverlay, e2eRunRoot as resolveRunRoot, login } from "./helpers";',
    )
    .replace("const runRoot = e2eRunRoot();", "const runRoot = resolveRunRoot();")
    .replace("path.join(", "nodePath.join(")
    .replace(
      'import { expect, test } from "@playwright/test";',
      'import nodePath from "node:path";\nimport { expect, test } from "@playwright/test";',
    );
  assert.notEqual(aliased, setupRaw);
  assert.match(aliased, /nodePath\.join\(runRoot, "admin-state\.json"\)/);
  const { problems } = checkContract(aliased, helperExports, {
    nodePath: "node:path",
    resolveRunRoot: "./helpers",
    expect: "@playwright/test",
    test: "@playwright/test",
  });
  assert.deepEqual(problems, []);
});
