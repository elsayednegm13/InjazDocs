import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { applyBrandTheme } from "@/app/theme";
import { api } from "@/lib/api";
import { iconHrefNeedsUpdate, refetchWhenReadable } from "@/lib/query-retry";

export type CompanyBrand = {
  name: string;
  theme: "light" | "dark";
  hasLogo: boolean;
  hasFavicon: boolean;
  updatedAt: string | null;
};

export function useCompanyBrand(enabled = true) {
  const query = useQuery({
    queryKey: ["brand"],
    queryFn: async () => (await api<CompanyBrand>("/api/v1/public/brand")).data,
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: (active) => refetchWhenReadable(active.state.status),
  });
  useEffect(() => {
    const brand = query.data;
    if (!brand) return;
    applyBrandTheme(brand.theme === "dark" ? "dark" : "light");
    document.title = brand.name || "ExportFlow";
    const href = brand.hasFavicon
      ? `/api/v1/public/brand/favicon?v=${encodeURIComponent(brand.updatedAt ?? "")}`
      : "/favicon.svg";
    let icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    if (iconHrefNeedsUpdate(icon.href, href, window.location.href)) icon.href = href;
  }, [query.data]);
  return query.data;
}

export function brandAsset(kind: "logo" | "favicon", updatedAt: string | null) {
  return `/api/v1/public/brand/${kind}?v=${encodeURIComponent(updatedAt ?? "")}`;
}
