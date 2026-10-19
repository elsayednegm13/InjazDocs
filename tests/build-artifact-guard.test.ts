import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findConfiguredValueLeaks, isProhibitedPublishName, parseAssignments, scanPublishTree, stripCopiedDevVars } from "../scripts/build-artifact-guard.mjs";

describe("publishable artifact guard", () => {
  it("flags copied local vars and ignores example templates", () => {
    expect(isProhibitedPublishName(".dev.vars")).toBe(true);
    expect(isProhibitedPublishName(".env.local")).toBe(true);
    expect(isProhibitedPublishName(".dev.vars.example")).toBe(false);
    expect(isProhibitedPublishName(".env.example")).toBe(false);
  });

  it("fails a dirty tree, then passes after only the copied vars file is removed", () => {
    const root = mkdtempSync(path.join(tmpdir(), "exportflow-dist-"));
    const dist = path.join(root, "dist", "exportflow");
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, ".dev.vars"), "SENTINEL_SECRET='synthetic-value-not-a-real-credential'\n");
    writeFileSync(path.join(dist, "index.js"), "export const mode = 'LOCAL_WORKER_PARTS';\n");
    const dirty = scanPublishTree(path.join(root, "dist"));
    expect(dirty.map((item) => item.path.replaceAll("\\", "/"))).toContain("exportflow/.dev.vars");
    const removed = stripCopiedDevVars(path.join(root, "dist"));
    expect(removed.map((item) => item.replaceAll("\\", "/"))).toEqual(["exportflow/.dev.vars"]);
    expect(scanPublishTree(path.join(root, "dist"))).toEqual([]);
  });

  it("detects a synthetic secret value inside a bundle without echoing it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "exportflow-bundle-"));
    const dist = path.join(root, "dist");
    mkdirSync(dist);
    const sentinel = "synthetic-sentinel-value-0123456789";
    writeFileSync(path.join(dist, "app.js"), `const leaked = "${sentinel}";\n`);
    const leaks = findConfiguredValueLeaks(dist, parseAssignments(`DEMO_SECRET=${sentinel}\nAPP_NAME=ExportFlow\n`));
    expect(leaks.map((item) => item.key)).toEqual(["DEMO_SECRET"]);
    expect(JSON.stringify(leaks)).not.toContain(sentinel);
  });

  it("refuses to delete outside a generated dist directory", () => {
    expect(() => stripCopiedDevVars(path.join(tmpdir(), "not-dist"))).toThrow(/dist/);
  });
});
