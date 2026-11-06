import { describe, expect, it } from "vitest";
import { secretsEqual } from "../server/http/secret-equal";

describe("secretsEqual", () => {
  it("matches equal secrets and rejects empties, mismatches, and different lengths", async () => {
    expect(await secretsEqual("bootstrap-secret-value", "bootstrap-secret-value")).toBe(true);
    expect(await secretsEqual("bootstrap-secret-value", "bootstrap-secret-other")).toBe(false);
    expect(await secretsEqual("short", "bootstrap-secret-value")).toBe(false);
    expect(await secretsEqual("", "bootstrap-secret-value")).toBe(false);
    expect(await secretsEqual("bootstrap-secret-value", "")).toBe(false);
    expect(await secretsEqual("bootstrap-secret-value", undefined)).toBe(false);
  });
});