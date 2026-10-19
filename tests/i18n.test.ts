import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const en = JSON.parse(readFileSync("src/locales/en.json", "utf8")) as Record<string, string>;
const ar = JSON.parse(readFileSync("src/locales/ar.json", "utf8")) as Record<string, string>;

describe("locale dictionaries", () => {
  it("has the same nonempty keys in English and Arabic", () => {
    const enKeys = Object.keys(en).sort();
    const arKeys = Object.keys(ar).sort();
    expect(arKeys).toEqual(enKeys);
    for (const key of enKeys) {
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(ar[key].trim().length).toBeGreaterThan(0);
      expect(ar[key]).not.toBe(key);
    }
  });

  it("does not expose raw status enums as English labels", () => {
    for (const [key, value] of Object.entries(en)) {
      if (!key.startsWith("status.")) continue;
      expect(value).not.toBe(key.slice("status.".length));
    }
  });
});
