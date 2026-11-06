import { afterEach, describe, expect, it, vi } from "vitest";
import { themeRevealOrigin, themeRevealRadius } from "../src/app/theme";
import { revealTheme } from "../src/app/theme-transition";

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

describe("revealTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays the circular wave even when the system asks for reduced motion", async () => {
    const classes = new Set<string>();
    const animate = vi.fn();
    let sawFrozenSnapshot = false;
    const root = {
      classList: {
        contains: (name: string) => classes.has(name),
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        toggle(name: string, force?: boolean) {
          const on = force ?? !classes.has(name);
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
      },
      dataset: {} as { theme?: string },
      animate,
    };
    const finished = Promise.resolve();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("window", {
      innerWidth: 800,
      innerHeight: 600,
      dispatchEvent: () => true,
      matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal("document", {
      documentElement: root,
      startViewTransition: (update: () => void) => {
        sawFrozenSnapshot = classes.has("theme-transitioning");
        update();
        return { ready: Promise.resolve(), finished };
      },
    });

    revealTheme(12, 34);
    await finished;
    await Promise.resolve();

    expect(sawFrozenSnapshot).toBe(true);
    expect(classes.has("dark")).toBe(true);
    expect(root.dataset.theme).toBe("dark");
    expect(classes.has("theme-transitioning")).toBe(false);
    expect(animate).toHaveBeenCalledWith(
      {
        clipPath: ["circle(0px at 12px 34px)", `circle(${Math.hypot(788, 566)}px at 12px 34px)`],
      },
      {
        duration: 650,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        pseudoElement: "::view-transition-new(root)",
      },
    );
  });

  it("switches immediately when the browser has no view transition", () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        contains: (name: string) => classes.has(name),
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        toggle(name: string, force?: boolean) {
          const on = force ?? !classes.has(name);
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
      },
      dataset: {} as { theme?: string },
    };
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("window", {
      dispatchEvent: () => true,
      matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal("document", { documentElement: root });

    revealTheme(0, 0);

    expect(classes.has("dark")).toBe(true);
    expect(classes.has("theme-transitioning")).toBe(false);
    expect(root.dataset.theme).toBe("dark");
  });
});
