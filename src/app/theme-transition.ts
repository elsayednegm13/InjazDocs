import { flushSync } from "react-dom";
import { applyTheme, currentTheme, themeRevealRadius, type ThemeName } from "./theme";

const REVEAL_MS = 650;
const REVEAL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function paintTheme(next: ThemeName) {
  const root = document.documentElement;
  applyTheme(next);
  root.classList.toggle("dark", next === "dark");
  root.dataset.theme = next;
}

export function revealTheme(x: number, y: number) {
  const next: ThemeName = currentTheme() === "dark" ? "light" : "dark";
  const root = document.documentElement;
  if (typeof document.startViewTransition !== "function") {
    paintTheme(next);
    return;
  }
  root.classList.add("theme-transitioning");
  try {
    const transition = document.startViewTransition(() => {
      flushSync(() => {
        paintTheme(next);
      });
    });
    void transition.ready
      .then(() => {
        const maxRadius = themeRevealRadius(x, y, window.innerWidth, window.innerHeight);
        root.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`],
          },
          {
            duration: REVEAL_MS,
            easing: REVEAL_EASING,
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => undefined);
    void transition.finished.finally(() => {
      root.classList.remove("theme-transitioning");
    });
  } catch {
    root.classList.remove("theme-transitioning");
    paintTheme(next);
  }
}
