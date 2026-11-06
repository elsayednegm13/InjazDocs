const STORAGE_KEY = "exportflow.theme";
const PIN_KEY = "exportflow.theme.pin";

export type ThemeName = "light" | "dark";

export function currentTheme(): ThemeName {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function commitTheme(theme: ThemeName) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event("exportflow-theme"));
}

/** A header or settings choice owns the theme until the visitor clears site data. */
export function themePinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function applyTheme(theme: ThemeName) {
  try {
    localStorage.setItem(PIN_KEY, "1");
  } catch {
    /* The class still updates when storage is blocked. */
  }
  commitTheme(theme);
}

/** Company identity applies only when this browser has not chosen a theme. */
export function applyBrandTheme(theme: ThemeName) {
  if (themePinned()) return;
  commitTheme(theme);
}

export function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}

export function subscribeTheme(onChange: () => void) {
  window.addEventListener("exportflow-theme", onChange);
  return () => window.removeEventListener("exportflow-theme", onChange);
}

export function themeRevealRadius(x: number, y: number, width: number, height: number) {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}

export function themeRevealOrigin(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
) {
  if (clientX === 0 && clientY === 0) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: clientX, y: clientY };
}
