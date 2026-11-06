/* ─────────────────────────────────────────────────────────────────────────
 * THE NAME A SCREEN IS FILED UNDER — ONE RESOLVER FOR THE WHOLE DEVICE.
 *
 * Every reading this kit takes on a page is filed under a label naming the
 * screen it belongs to: the page-view reading, a press and the screen it led
 * to, a crash's place, a control census entry, a map step, reachability and a
 * soft-navigation entry. They are joined to each other on that label, so they
 * must all ask ONE question in ONE way — two consumers that named the same
 * screen two ways would report a pressed control as never pressed.
 *
 * Without a router handed over the label is the ADDRESS, cut down by the one
 * part-name rule (partName.ts): `/products/123` is `/products/:id`, and
 * `/products/blue-shoe` stays itself. That is every app's label, as it always
 * was.
 *
 * With a router handed over that can say which of the app's routes matched
 * (an Angular Router — angularRouter.ts), the label is the matched route's
 * PATTERN: `/products/blue-shoe` and `/products/red-hat` are both
 * `/products/:id`, one screen with one row. The router answers through the
 * small `ScreenNamer` interface below, so this module never needs to know
 * which framework is behind it.
 *
 * In router mode an address the router never completed a navigation to has no
 * pattern label, and this answers null for it rather than an address label: a
 * label from the other family would file a press under a screen name no
 * reading on this device uses.
 *
 * Outbound-call labels are NOT this question (they name a server's route, not
 * a screen) and do not come here.
 *
 * Imports only the part-name rule, so any module may import it.
 * ───────────────────────────────────────────────────────────────────────── */

import { normalizeRouteLabel } from "./partName";

/** What a handed-over router can answer about screens. */
export interface ScreenNamer {
  /** The label of the screen showing now, from the matched route, or null
   *  when it cannot be produced right now (the caller falls back to the
   *  address label). */
  labelNow(): string | null;
  /** The label recorded for an address the router completed a navigation
   *  to, or null when it never did. */
  labelForHref(href: string): string | null;
}

let namer: ScreenNamer | null = null;

/** A router has been handed over and names this app's screens. Null puts the
 *  address back in charge. */
export function setScreenNamer(next: ScreenNamer | null): void {
  namer = next;
}

/** True while a handed-over router names this app's screens. */
export function routerNamesScreens(): boolean {
  return namer !== null;
}

/** True when the label screenLabelNow() answers right now is the router's
 *  (a route pattern), false when it is the address's. */
export function screenLabelFromRouter(): boolean {
  return routerLabelNow() !== null;
}

function routerLabelNow(): string | null {
  if (namer === null) return null;
  try {
    return namer.labelNow();
  } catch {
    return null;
  }
}

/** The path of an absolute or root-relative address, query and fragment
 *  left for the part-name rule to cut. */
function pathOfHref(href: string): string {
  let path = href;
  const scheme = path.indexOf("://");
  if (scheme >= 0) {
    const slash = path.indexOf("/", scheme + 3);
    path = slash >= 0 ? path.slice(slash) : "/";
  }
  return path;
}

/**
 * The page the kit is on right now, as a screen label — or null where there
 * is no document to ask.
 */
export function screenLabelNow(): string | null {
  try {
    const routed = routerLabelNow();
    if (routed !== null) return routed;
    if (typeof location === "undefined") return null;
    if (typeof location.pathname !== "string") return null;
    return normalizeRouteLabel(location.pathname);
  } catch {
    return null;
  }
}

/** The label a view opening now is filed under. Where there is no address
 *  to read at all the page is its root, `/`, as it always was. */
export function screenLabelForView(): string | null {
  try {
    const routed = routerLabelNow();
    if (routed !== null) return routed;
    const path =
      typeof location !== "undefined" && typeof location.pathname === "string"
        ? location.pathname
        : "/";
    return normalizeRouteLabel(path);
  } catch {
    return null;
  }
}

function currentHref(): string | null {
  try {
    return typeof location !== "undefined" && typeof location.href === "string"
      ? location.href
      : null;
  } catch {
    return null;
  }
}

/**
 * The label of an address captured earlier (where a press happened, where it
 * led). In router mode it is the label the router recorded for that address,
 * or — for the address showing now — the screen's label now; any other
 * address answers null.
 */
export function screenLabelForHref(href: string): string | null {
  try {
    if (typeof href !== "string" || href === "") return null;
    if (namer !== null) {
      try {
        const recorded = namer.labelForHref(href);
        if (recorded !== null) return recorded;
      } catch {
        // fall through to the address showing now
      }
      return href === currentHref() ? screenLabelNow() : null;
    }
    return normalizeRouteLabel(pathOfHref(href));
  } catch {
    return null;
  }
}

/**
 * The label of an address a browser entry names, which may be relative to the
 * page (a soft-navigation entry's `name`).
 */
export function screenLabelForUrl(name: unknown): string | null {
  try {
    if (typeof name !== "string" || name === "") return null;
    const base = currentHref() ?? undefined;
    const url = new URL(name, base);
    if (namer !== null) return screenLabelForHref(url.href);
    return normalizeRouteLabel(url.pathname);
  } catch {
    return null;
  }
}

export function _resetScreenLabelForTests(): void {
  namer = null;
}
