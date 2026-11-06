import { useSyncExternalStore } from "react";
import { currentTheme, subscribeTheme, type ThemeName } from "@/app/theme";

export function useThemeName(): ThemeName {
  return useSyncExternalStore(subscribeTheme, currentTheme, () => "light");
}
