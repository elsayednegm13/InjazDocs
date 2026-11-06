/* ─────────────────────────────────────────────────────────────────────────
 * AN ANGULAR ROUTER, HANDED OVER.
 *
 * An Angular app hands the kit its router after bootstrap:
 *
 *     registerRouter(appRef.injector.get(Router));
 *
 * and from then on the router, not the address bar, decides two things:
 *
 *   1. WHAT A SCREEN IS CALLED. The matched route's pattern, read from the
 *      router's own state after each completed navigation: the primary
 *      outlet only, children and empty-path parents joined, redirects already
 *      resolved by the router to the route that rendered. `:anything` is
 *      written `:id` (the one parameter form — see
 *      docs/decisions/route-pattern-parameter-form.md), the wildcard route is
 *      `**`, and a route matched by a custom matcher is `:matched` — never the
 *      address segment it matched, which is a visitor's value. The base path
 *      is included the way an address label includes it.
 *
 *   2. WHERE ONE VIEW ENDS AND THE NEXT BEGINS. Completed navigations,
 *      deduplicated by the router's own navigation id, under either location
 *      strategy — with the hash strategy the address path never changes, so
 *      the address hook alone would see one view for the whole visit.
 *      Cancelled, failed and skipped navigations open nothing; a redirect
 *      chain completes once.
 *
 * RECOGNISED BY SHAPE, NEVER BY NAME. A production build minifies class
 * names, so the router is recognised by the public members every Angular
 * major still supported carries: `navigateByUrl`, `createUrlTree`,
 * `serializeUrl` and `parseUrl` functions, a `config` array, `events` with a
 * `subscribe` function and `routerState.snapshot.root`. Only that hand-over
 * call ever makes the kit look: it never goes looking for Angular itself.
 *
 * WHAT IT NEVER DOES. It reads public router API only — never a private
 * field — and never triggers a lazy load: a lazy section's routes become
 * known when the app loads them, through the screens the visitor reaches. It
 * stays bounded in size and depth, and it never throws into the host: an
 * error puts the address back in charge of naming screens.
 *
 * It does not import the view machinery (vitals.ts); that module registers
 * the one handler completed navigations are handed to.
 * ───────────────────────────────────────────────────────────────────────── */

import { normalizeRouteLabel } from "./partName";
import { transmitLabelHasPII } from "./no-pii";
import { outsideAngular } from "./zoneSafe";
import { setScreenNamer, type ScreenNamer } from "./screenLabel";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object";
}

/** The router's public `EventType` numbers the kit acts on (stable,
 *  append-only, in every supported major). */
const NAVIGATION_END = 1;

/** The fixed word for the wildcard route's segment. */
export const WILDCARD_SEGMENT = "**";
/** The fixed word for a segment a custom matcher decided. */
export const MATCHED_SEGMENT = ":matched";
/** The one parameter form, shared with the route list (routeInventory.ts). */
export const PARAMETER_SEGMENT = ":id";

/** How deep a matched route may nest before the walk gives up. */
const MAX_DEPTH = 32;
/** How many children one step may list before the walk gives up. */
const MAX_CHILDREN = 200;
/** How many segments one step may carry before the walk gives up. */
const MAX_SEGMENTS = 64;
/** How many addresses the kit remembers a label for. */
const MAX_REMEMBERED = 200;
/** How many visited screens the route list may add. */
export const MAX_VISITED = 200;
/** How many route entries the configuration walk may look at. */
const MAX_CONFIG_ENTRIES = 2000;
/** How deep the configuration walk may go. */
const MAX_CONFIG_DEPTH = 16;

/** One completed navigation, as the view machinery hears it. */
export interface RouterNavigation {
  /** The screen's label, or null when none could be produced (the address
   *  label then stands in, through screenLabel.ts). */
  label: string | null;
  /** The primary outlet's concrete path — matrix parameters, query and
   *  fragment left out — which decides whether the screen changed. */
  path: string;
  /** The router's first completed navigation since it was handed over. */
  first: boolean;
}

type NavigationHandler = (nav: RouterNavigation) => void;

let navigationHandler: NavigationHandler | null = null;

/** The view machinery's one handler for completed navigations. */
export function onRouterNavigation(handler: NavigationHandler | null): void {
  navigationHandler = handler;
}

/** Is this a handed-over Angular Router? By public shape only. */
export function isAngularRouter(v: unknown): v is Obj {
  try {
    if (!isObj(v)) return false;
    if (typeof v["navigateByUrl"] !== "function") return false;
    if (typeof v["createUrlTree"] !== "function") return false;
    if (typeof v["serializeUrl"] !== "function") return false;
    if (typeof v["parseUrl"] !== "function") return false;
    if (!Array.isArray(v["config"])) return false;
    const events = v["events"];
    if (!isObj(events) || typeof events["subscribe"] !== "function") return false;
    const state = v["routerState"];
    if (!isObj(state)) return false;
    const snapshot = state["snapshot"];
    return isObj(snapshot) && isObj(snapshot["root"]);
  } catch {
    return false;
  }
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** One route's own pattern segments, or null when the route cannot be read. */
function patternSegments(cfg: Obj): string[] | null {
  if (typeof cfg["matcher"] === "function") return [MATCHED_SEGMENT];
  const path = cfg["path"];
  if (path === undefined) return [];
  if (typeof path !== "string") return null;
  const out: string[] = [];
  const parts = path.split("/");
  if (parts.length > MAX_SEGMENTS) return null;
  for (const seg of parts) {
    if (seg === "") continue;
    if (seg === "**") out.push(WILDCARD_SEGMENT);
    else if (seg.startsWith(":")) out.push(PARAMETER_SEGMENT);
    else out.push(seg);
  }
  return out;
}

interface Walked {
  pattern: string[];
  concrete: string[];
}

/** Follow the primary outlet from the root of a router state snapshot. */
function walkSnapshot(root: unknown): Walked | null {
  const pattern: string[] = [];
  const concrete: string[] = [];
  let node: unknown = root;
  let depth = 0;
  while (isObj(node)) {
    depth += 1;
    if (depth > MAX_DEPTH) return null;
    const cfg = node["routeConfig"];
    if (isObj(cfg)) {
      const segs = patternSegments(cfg);
      if (segs === null) return null;
      pattern.push(...segs);
    }
    const url = node["url"];
    if (Array.isArray(url)) {
      if (url.length > MAX_SEGMENTS) return null;
      for (const u of url) {
        if (!isObj(u) || typeof u["path"] !== "string") return null;
        concrete.push(u["path"]);
      }
    }
    const children = node["children"];
    if (!Array.isArray(children) || children.length === 0) break;
    if (children.length > MAX_CHILDREN) return null;
    let next: unknown = null;
    for (const c of children) {
      if (isObj(c) && c["outlet"] === "primary") {
        next = c;
        break;
      }
    }
    if (next === null) break;
    node = next;
  }
  return { pattern, concrete };
}

function cutAt(text: string, chars: string): string {
  let end = text.length;
  for (const ch of chars) {
    const i = text.indexOf(ch);
    if (i >= 0 && i < end) end = i;
  }
  return text.slice(0, end);
}

function trimTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function samePath(a: string, b: string): boolean {
  return a === b || decoded(a) === decoded(b);
}

/**
 * The path a `<base href>` element declares, without its trailing slash — or
 * "" where the page declares none. Only an element counts: a document with no
 * `<base>` reports its own address as its base URI, which is a screen, not a
 * base path.
 */
function declaredBasePath(): string {
  try {
    if (typeof document === "undefined") return "";
    const query = (document as { querySelector?: unknown }).querySelector;
    if (typeof query !== "function") return "";
    const el: unknown = query.call(document, "base[href]");
    if (!isObj(el)) return "";
    const href = el["href"];
    if (typeof href !== "string" || href === "") return "";
    return trimTrailingSlash(new URL(href).pathname);
  } catch {
    return "";
  }
}

/**
 * The part of the address in front of the router's own URL: the page's path
 * under the hash strategy, the deployment's base path under the path
 * strategy. Included in every label the way an address label includes it.
 *
 * Where the address and the router's URL cannot be lined up — the router has
 * not completed a navigation yet, so its URL is still `/` — the page's
 * declared base path answers, never the address: an address there is a
 * screen, and a screen taken for a base path would put it in front of every
 * route in the list.
 */
function basePath(routerUrl: string): string {
  try {
    if (typeof location === "undefined") return declaredBasePath();
    const pathname = typeof location.pathname === "string" ? location.pathname : "";
    const hash = typeof location.hash === "string" ? location.hash : "";
    const routerPath = cutAt(routerUrl, "?#");
    if (hash.startsWith("#/")) {
      const hashPath = cutAt(hash.slice(1), "?");
      if (samePath(hashPath, routerPath)) return trimTrailingSlash(pathname);
    }
    if (routerPath !== "/" && routerPath !== "") {
      if (pathname.endsWith(routerPath)) {
        return trimTrailingSlash(pathname.slice(0, pathname.length - routerPath.length));
      }
      const dp = decoded(pathname);
      const dr = decoded(routerPath);
      if (dp.endsWith(dr)) return trimTrailingSlash(dp.slice(0, dp.length - dr.length));
    }
  } catch {
    // no base path is better than a wrong one
  }
  return declaredBasePath();
}

/** A label that passed the one part-name rule and the label screen, or null. */
function safeLabel(raw: string): string | null {
  const label = normalizeRouteLabel(raw);
  if (label === null) return null;
  if (transmitLabelHasPII(label) !== null) return null;
  return label;
}

interface ReadState {
  label: string | null;
  path: string;
}

/** The router's current screen: its label and its primary concrete path. */
function readCurrent(router: Obj): ReadState | null {
  const state = router["routerState"];
  if (!isObj(state)) return null;
  const snapshot = state["snapshot"];
  if (!isObj(snapshot)) return null;
  const walked = walkSnapshot(snapshot["root"]);
  if (walked === null) return null;
  const url = typeof router["url"] === "string" ? (router["url"] as string) : "/";
  const base = basePath(url);
  const label = safeLabel(`${base}/${walked.pattern.join("/")}`);
  return { label, path: `/${walked.concrete.join("/")}` };
}

/** An address reduced to what names a screen: query and fragment dropped,
 *  except a hash-strategy route, whose own query is dropped. */
function hrefKey(href: string): string {
  const hashAt = href.indexOf("#");
  let main = hashAt >= 0 ? href.slice(0, hashAt) : href;
  let fragment = hashAt >= 0 ? href.slice(hashAt) : "";
  main = cutAt(main, "?");
  if (fragment.startsWith("#/")) {
    fragment = cutAt(fragment, "?");
    return main + fragment;
  }
  return main;
}

function remember(map: Map<string, string>, key: string, value: string): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > MAX_REMEMBERED) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

// ── The handed-over router ───────────────────────────────────────────────────

interface Attached {
  router: Obj;
  current: string | null;
  /** The primary concrete path of the last completed navigation. */
  path: string | null;
  lastId: number;
  sawFirst: boolean;
  byHref: Map<string, string>;
  visited: Set<string>;
}

let active: Attached | null = null;
import { isRuntimeInert, registerLockLifecycle } from "./lockGate";
const subscribed = new WeakSet<object>();
let releaseLifecycle: (() => void) | undefined;
const subscriptions = new Map<object, { unsubscribe: () => void }>();

const namer: ScreenNamer = {
  labelNow() {
    return active === null ? null : active.current;
  },
  labelForHref(href: string) {
    if (active === null) return null;
    return active.byHref.get(href) ?? active.byHref.get(hrefKey(href)) ?? null;
  },
};

/** Stop listening for good and put the address back in charge. */
function standDown(): void {
  for (const [router, subscription] of subscriptions) {
    try { subscription.unsubscribe(); } catch { /* host safety */ }
    subscribed.delete(router);
  }
  subscriptions.clear();
  active = null;
  setScreenNamer(null);
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

/** The router's own URL reduced to the primary path the way a walked state
 *  would give it: query, fragment and matrix parameters left out. */
function pathOfRouterUrl(router: Obj): string {
  const url = typeof router["url"] === "string" ? (router["url"] as string) : "/";
  const segs = cutAt(url, "?#(")
    .split("/")
    .map((seg) => cutAt(seg, ";"))
    .filter((seg) => seg !== "");
  return `/${segs.join("/")}`;
}

/** The router completed a navigation (or was handed over already on one). */
function observe(a: Attached): void {
  // A state the kit cannot walk still completed a navigation: the view
  // machinery hears of it, and the address names the screen (label null).
  const read = readCurrent(a.router) ?? { label: null, path: pathOfRouterUrl(a.router) };
  a.current = read.label;
  a.path = read.path;
  if (read.label !== null) {
    const href = currentHref();
    if (href !== null) {
      remember(a.byHref, href, read.label);
      remember(a.byHref, hrefKey(href), read.label);
    }
    if (a.visited.size < MAX_VISITED || a.visited.has(read.label)) {
      a.visited.add(read.label);
    }
  }
  const first = !a.sawFirst;
  a.sawFirst = true;
  const handler = navigationHandler;
  if (handler !== null) handler({ label: read.label, path: read.path, first });
}

function onEvent(a: Attached, e: unknown): void {
  if (active !== a) return;
  try {
    if (!isObj(e)) return;
    // Only a COMPLETED navigation decides anything. Cancelled, failed and
    // skipped ones leave the screen where it was; a redirect chain completes
    // once, under the id of the navigation that started it.
    if (e["type"] !== NAVIGATION_END) return;
    const id = e["id"];
    if (typeof id === "number" && Number.isFinite(id)) {
      if (id <= a.lastId) return;
      a.lastId = id;
    }
    observe(a);
  } catch {
    standDown();
  }
}

/**
 * Take over naming screens and deciding views from this router. Idempotent
 * per router; a different router handed over later takes over from the
 * first. Returns whether the router is now in charge.
 */
export function attachAngularRouter(router: Obj): boolean {
  releaseLifecycle?.();
  releaseLifecycle = registerLockLifecycle({
    uninstall: detachAngularRouter,
    clear: () => {},
    reinstall: () => { attachAngularRouter(router); },
  });
  if (isRuntimeInert()) return false;
  try {
    if (active !== null && active.router === router) return true;
    const a: Attached = {
      router,
      current: null,
      path: null,
      lastId: -1,
      sawFirst: false,
      byHref: new Map(),
      visited: new Set(),
    };
    active = a;
    setScreenNamer(namer);
    if (!subscribed.has(router)) {
      subscribed.add(router);
      const events = router["events"] as Obj;
      const subscribe = events["subscribe"] as (fn: (e: unknown) => void) => unknown;
      // The router emits inside the app's zone; the kit's work on each event
      // is its own and runs outside it.
      const subscription = subscribe.call(events, (e: unknown) =>
        outsideAngular(() => {
          if (!isRuntimeInert() && active !== null && active.router === router) onEvent(active, e);
        }),
      );
      if (isObj(subscription) && typeof subscription["unsubscribe"] === "function") {
        subscriptions.set(router, subscription as { unsubscribe: () => void });
      }
    }
    // Handed over after the first navigation already completed (the usual
    // case: the app bootstraps, then hands the router over): that navigation
    // is the screen showing now.
    if (router["navigated"] === true) observe(a);
    return active === a;
  } catch {
    standDown();
    return false;
  }
}

/** Let go of any handed-over router (a later hand-over of something that is
 *  not an Angular Router, or nothing). */
export function detachAngularRouter(): void {
  standDown();
}

/** True while a handed-over Angular Router names screens. */
export function angularRouterActive(): boolean {
  return active !== null;
}

/** The primary path of the handed-over router's last completed navigation,
 *  or null before it completed one. */
export function angularRouterPath(): string | null {
  return active === null ? null : active.path;
}

// ── The route list ───────────────────────────────────────────────────────────

/** The route list's view of an Angular app. */
export interface AngularRouteRead {
  /** Labels from the configuration, then screens visited inside lazy
   *  sections, de-duplicated. */
  labels: string[];
  /** How many lazy sections (`loadChildren`) the configuration holds. Their
   *  own routes live inside them, and whether one has loaded is visible only
   *  through a private field the kit never reads, so every one counts: the
   *  list is incomplete by their routes, less the screens visited in them. */
  unread: number;
}

/**
 * Read the routes the router's configuration declares, without loading a
 * single lazy section, plus every screen the visitor reached (which covers
 * routes inside lazy sections they loaded). Null when the configuration
 * cannot be read.
 */
export function readAngularRoutes(router: Obj): AngularRouteRead | null {
  try {
    const config = router["config"];
    if (!Array.isArray(config)) return null;
    const url = typeof router["url"] === "string" ? (router["url"] as string) : "/";
    const base = basePath(url);
    const labels: string[] = [];
    const seen = new Set<string>();
    let unread = 0;
    let looked = 0;
    const add = (segs: string[]): void => {
      const label = safeLabel(`${base}/${segs.join("/")}`);
      if (label === null || seen.has(label)) return;
      seen.add(label);
      labels.push(label);
    };
    const walk = (routes: unknown[], prefix: string[], depth: number): boolean => {
      if (depth > MAX_CONFIG_DEPTH) return false;
      for (const r of routes) {
        looked += 1;
        if (looked > MAX_CONFIG_ENTRIES) return false;
        if (!isObj(r)) return false;
        // A named outlet's route is a panel beside a screen, not a screen.
        const outlet = r["outlet"];
        if (typeof outlet === "string" && outlet !== "primary") continue;
        // A redirect renders nothing: the route it lands on is listed itself.
        if (r["redirectTo"] !== undefined) continue;
        const segs = patternSegments(r);
        if (segs === null) return false;
        const here = [...prefix, ...segs];
        const lazy = typeof r["loadChildren"] === "function";
        if (lazy) unread += 1;
        const children = r["children"];
        if (Array.isArray(children) && children.length > 0) {
          if (!walk(children, here, depth + 1)) return false;
          continue;
        }
        // A lazy section's own routes are inside it, unread until it loads.
        if (lazy) continue;
        add(here);
      }
      return true;
    };
    if (!walk(config, [], 0)) return null;
    const a = active !== null && active.router === router ? active : null;
    if (a !== null) {
      for (const v of a.visited) {
        if (!seen.has(v)) {
          seen.add(v);
          labels.push(v);
        }
      }
    }
    return { labels, unread };
  } catch {
    return null;
  }
}

/** Forget any handed-over router. The view machinery's handler stays: it is
 *  registered once, when that module loads. */
export function _resetAngularRouterForTests(): void {
  active = null;
  setScreenNamer(null);
}
