import { describe, expect, it } from "vitest";
import { themeRevealOrigin, themeRevealRadius } from "../src/app/theme";

describe("theme reveal", () => {
  it("covers the farthest screen corner from the press point", () => {
    expect(themeRevealRadius(0, 0, 1000, 800)).toBe(Math.hypot(1000, 800));
    expect(themeRevealRadius(1000, 800, 1000, 800)).toBe(Math.hypot(1000, 800));
    expect(themeRevealRadius(250, 100, 1000, 800)).toBe(Math.hypot(750, 700));
  });

  it("uses the button center when the keyboard reports a zero point", () => {
    expect(themeRevealOrigin(0, 0, { left: 40, top: 12, width: 32, height: 32 })).toEqual({ x: 56, y: 28 });
    expect(themeRevealOrigin(18, 24, { left: 40, top: 12, width: 32, height: 32 })).toEqual({ x: 18, y: 24 });
  });
});
