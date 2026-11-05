import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { currentTheme, type ThemeName } from "@/app/theme";

export function Toasts() {
  const { i18n } = useTranslation();
  const rtl = i18n.language.startsWith("ar");
  const [theme, setTheme] = useState<ThemeName>(currentTheme);
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    window.addEventListener("exportflow-theme", sync);
    return () => window.removeEventListener("exportflow-theme", sync);
  }, []);
  return (
    <Toaster
      theme={theme}
      position="top-right"
      offset={{ top: 16, right: 16 }}
      richColors
      closeButton
      dir={rtl ? "rtl" : "ltr"}
      toastOptions={{ duration: 6000 }}
    />
  );
}
