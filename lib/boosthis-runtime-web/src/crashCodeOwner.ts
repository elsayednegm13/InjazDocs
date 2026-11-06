import { callGroupDestination } from "./callGroups";
import type { CrashCauseFields } from "./crashCause";
export function currentPageAddress(): string {
  try { return (globalThis as { location?: { href?: string } }).location?.href ?? ""; } catch { return ""; }
}
let startPage = currentPageAddress();
export function rememberCrashStartPage(): void { startPage = currentPageAddress(); }
export function isInlinePage(address: string): boolean {
  const clean = (s: string) => s.split(/[?#]/)[0];
  return !!address && [currentPageAddress(), startPage].some(p => !!p && clean(p) === clean(address));
}
/** Read only frame lines, never an address quoted in the error message. */
export function firstCodeAddress(stack?: string, filename?: unknown): string | undefined {
  const lines = (stack ?? "").slice(0, 16384).split("\n");
  const v8 = lines.some(l => /^\s*at\s/.test(l));
  for (const line of lines) {
    if (!(v8 ? /^\s*at\s/.test(line) : line.includes("@"))) continue;
    const address = line.match(/[a-z][a-z0-9+.-]*:\/\/[^\s()]+/i)?.[0];
    if (address) return address.replace(/:\d+(?::\d+)?$/, "");
  }
  return typeof filename === "string" && filename ? filename : undefined;
}
/** The store platforms on the shared list: a crash in one of their files is
 *  "the store platform's own scripts", named. */
const STORE_PLATFORMS = ["shopify", "salla", "zid", "bigcommerce", "wix", "squarespace"] as const;
function isStorePlatform(service: string): service is (typeof STORE_PLATFORMS)[number] {
  return (STORE_PLATFORMS as readonly string[]).includes(service);
}
/** Shopify serves its own scripts under these paths, on its hosts AND on the
 *  store's own address. On any other site the same path is that site's own
 *  file, so the path alone never names Shopify: the host must be Shopify's,
 *  or the page must be a Shopify store (its storefront object exists; only
 *  its presence is read, never its contents). */
const SHOPIFY_SCRIPT_PATH = /\/shopifycloud\/|^\/cdn\/wpm\/|\/wpm@|\/web-pixels/;
const SHOPIFY_HOST = /(^|\.)shopify\.com$|(^|\.)shopifycloud\.com$|(^|\.)shopifysvc\.com$|^shop\.app$/;
function pageIsShopifyStore(): boolean {
  try {
    const store = (globalThis as { Shopify?: unknown }).Shopify;
    return typeof store === "object" && store !== null;
  } catch { return false; }
}
export function crashCodeOwner(address?: string): Pick<CrashCauseFields, "codeOwner" | "codeService"> {
  if (!address) return { codeOwner: "no-address" };
  if (isInlinePage(address)) return { codeOwner: "inline-page" };
  try {
    const u = new URL(address, currentPageAddress() || undefined);
    const host = u.hostname.toLowerCase(), path = u.pathname;
    if (SHOPIFY_SCRIPT_PATH.test(path) && (SHOPIFY_HOST.test(host) || pageIsShopifyStore())) return { codeOwner: "store-platform", codeService: "shopify" };
    if (host === "cdn.shopify.com" && path.startsWith("/extensions/")) return { codeOwner: "named-service", codeService: "shopify-apps" };
    if (host === "cdn.shopify.com" && path.startsWith("/s/files/")) return { codeOwner: "same-site" };
    if (SHOPIFY_HOST.test(host)) return { codeOwner: "store-platform", codeService: "shopify" };
    // Google's tag manager file: named by the crash check alone; a call to
    // the same host stays grouped under "google-analytics" (callGroups.ts).
    if (/(^|\.)googletagmanager\.com$/.test(host)) return { codeOwner: "named-service", codeService: "google-tag-manager" };
    const service = callGroupDestination(u.href);
    if (isStorePlatform(service)) return { codeOwner: "store-platform", codeService: service };
    const page = currentPageAddress();
    if (page && host.replace(/^www\./, "") === new URL(page).hostname.replace(/^www\./, "")) return { codeOwner: "same-site" };
    if (service !== "same-origin" && service !== "third-party" && service !== "unnamed") return { codeOwner: "named-service", codeService: service };
  } catch { /* An unreadable address is not attributed. */ }
  return { codeOwner: "other-address" };
}
