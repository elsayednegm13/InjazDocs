import { flushSync } from "react-dom";
import { applyTheme, currentTheme, themeRevealRadius, type ThemeName } from "@/app/theme";

export function revealTheme(x: number, y: number) {
  const next: ThemeName = currentTheme() === "dark" ? "light" : "dark";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    applyTheme(next);
    return;
  }
  try {
    const transition = document.startViewTransition(() => {
      flushSync(() => {
        applyTheme(next);
      });
    });
    void transition.ready
      .then(() => {
        const maxRadius = themeRevealRadius(x, y, window.innerWidth, window.innerHeight);
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => undefined);
  } catch {
    applyTheme(next);
  }
}
