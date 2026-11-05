const STORAGE_KEY = "exportflow.theme";

export type ThemeName = "light" | "dark";

export function currentTheme(): ThemeName {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: ThemeName) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event("exportflow-theme"));
}

export function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}
