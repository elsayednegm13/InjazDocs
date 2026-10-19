import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "../locales/ar.json";
import en from "../locales/en.json";

const stored = localStorage.getItem("exportflow.lang") || "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: stored,
  fallbackLng: "en",
  keySeparator: false,
  interpolation: { escapeValue: false },
});

export function applyDir(lang: string) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  localStorage.setItem("exportflow.lang", lang);
}

applyDir(stored);

export default i18n;
