/** Calls the page makes that WAIT ON PURPOSE — named by the developer.
 *
 * A long-poll waits on purpose (25 seconds, say) and then answers with
 * ordinary JSON. Nothing in the call tells it apart from a slow one, and the
 * contract refuses a duration threshold, so no kit can recognise one. Only the
 * developer knows a call waits on purpose, so the developer names it
 * (`startWebVitals({ waitsOnPurpose: [...] })`) and the kit honours the name.
 * The rule is the calling side of docs/held-open-calls.md ("Waits declared on
 * purpose" → "Calls the app makes").
 *
 * WHAT A NAME IS. The call's address without the query: a path on the page's
 * own site (`/api/poll`) or a full address
 * (`https://api.telegram.org/bot:token/getUpdates`). Text written as `:name`
 * stands for one run of characters inside ONE segment — never a `/` — so the
 * contract's own example matches the token Telegram puts after `bot`.
 * Nothing else is a pattern. Refused names get the contract's one-line
 * reasons; more than ten accepted names and the kit holds none.
 *
 * MATCHING HAPPENS HERE, IN THE PAGE. Neither the addresses nor the names are
 * stored anywhere that leaves the tab, and none is ever printed: a refusal
 * names the entry by its POSITION, because a name can carry a secret (a bot
 * token typed where `:token` belongs) and a console is read by error
 * trackers. The reading carries four counts and nothing else.
 *
 * WHAT A DECLARED CALL IS NOT: slow, stalled or hung. Its duration stays out
 * of every reading of calls the page makes. Its FAILURES still count.
 *
 * THE STREAM RULE lives here too, because it is the same question asked of
 * the same calls: a response whose media type is on the contract's closed
 * list is timed only up to its headers, never for its whole life.
 */

/** The most names the kit holds. Small on purpose: this is a declaration
 *  about a handful of calls, never a general "leave this out" switch. */
export const WAIT_NAME_CAP = 10;

/** The longest accepted name, in characters. */
export const WAIT_NAME_MAX = 200;

/** Why a name was refused. Closed; each has its one-line reason. */
export type WaitNameRefusal =
  | "wildcard"
  | "prefix"
  | "pattern"
  | "kit-route"
  | "host-only"
  | "malformed";

/** The one-line reason for each refusal, in the contract's own words (the
 *  server's dashboard prints the same sentences). */
export const WAIT_NAME_REFUSAL_REASON: Readonly<Record<WaitNameRefusal, string>> = {
  wildcard: "a wildcard is not a name — name each route exactly",
  prefix: "a prefix covers routes nobody named — name each route exactly",
  pattern: "a pattern is not a name — write the route as the dashboard shows it",
  "kit-route": "the kit's own routes are not yours to declare",
  "host-only": "a host on its own is not an address — give the full address of the call",
  malformed:
    "not a name this rule accepts — no spaces, query or fragment, and a route starts with /",
};

/** The four counts the network reading carries (docs/held-open-calls.md). */
export interface DeclaredCallCounts {
  /** Names the kit holds (0–10). */
  waitDeclaredNames: number;
  /** Names matched by at least one call in this window. */
  waitDeclaredMatched: number;
  /** Calls kept out of the reading as declared waits. */
  waitDeclaredExcluded: number;
  /** The longest of them, in ms. */
  waitDeclaredWorstMs: number;
}

const PATTERN_CHARS = /[\^$()[\]|+\\]/;
const KIT_ROUTE = /^\/_{1,2}boosthis(?:\/|$)/i;
/** `:name` — stands for one run of characters inside a single segment. */
const PLACEHOLDER = /:[A-Za-z_][A-Za-z0-9_]*/;
const BARE_HOST = /^(?:localhost|[a-z0-9_-]+(?:\.[a-z0-9_-]+)+)(?::\d{1,5})?\/?$/i;
const HOST_NAME = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i;
const HOST_V6 = /^\[[0-9a-f:.]+\]$/i;

interface HeldName {
  /** `scheme://host[:port]` as the page's own URLs spell an origin, or null
   *  for a path on the page's own site. */
  origin: string | null;
  /** Per segment: the literal pieces around its placeholders. */
  segments: string[][];
  matched: boolean;
}

let held: HeldName[] = [];
let keptOut = 0;
let keptOutWorstMs = 0;

type Judged =
  | { refusal: WaitNameRefusal }
  | { refusal: null; origin: string | null; path: string };

const refuse = (refusal: WaitNameRefusal): Judged => ({ refusal });

/** `scheme://host[:port]`, lowercased and with the scheme's default port
 *  dropped — the spelling `URL.origin` uses — or null when it is not one. */
function originOf(scheme: string, authority: string): string | null {
  if (authority.length === 0 || authority.includes("@")) return null;
  let host = authority;
  let port = "";
  const v6 = /^(\[[^\]]*\])(?::(\d{1,5}))?$/.exec(authority);
  if (v6) {
    host = v6[1]!;
    port = v6[2] ?? "";
    if (!HOST_V6.test(host)) return null;
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon !== -1) {
      host = authority.slice(0, colon);
      port = authority.slice(colon + 1);
      if (!/^\d{1,5}$/.test(port)) return null;
    }
    if (!HOST_NAME.test(host)) return null;
  }
  if (port !== "") {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    if ((scheme === "http" && n === 80) || (scheme === "https" && n === 443)) port = "";
    else port = String(n);
  }
  return `${scheme}://${host.toLowerCase()}${port ? `:${port}` : ""}`;
}

/** Judge one name. Null refusal when it is accepted, with its parts. */
function judge(name: unknown): Judged {
  if (typeof name !== "string") return refuse("malformed");
  if (name.length === 0 || name.length > WAIT_NAME_MAX) return refuse("malformed");
  if (/\s/.test(name) || name.includes("#")) return refuse("malformed");
  // A query is not part of an address name; a bare "?" is a wildcard.
  if (name.includes("?")) return refuse(/[?&][^/?&]*=/.test(name) ? "malformed" : "wildcard");
  if (name.endsWith("...") || name.endsWith("…") || name.endsWith("*")) return refuse("prefix");
  if (name.includes("*")) return refuse("wildcard");
  let origin: string | null = null;
  let path: string;
  if (name.startsWith("/")) {
    // `//host/path` would name another site with no scheme: not a path here.
    if (name.startsWith("//")) return refuse("malformed");
    path = name;
  } else {
    const m = /^(https?):\/\/([^/]*)(\/.*)?$/i.exec(name);
    if (!m) return refuse(BARE_HOST.test(name) ? "host-only" : "malformed");
    const o = originOf(m[1]!.toLowerCase(), m[2]!);
    if (o === null) return refuse("malformed");
    if (m[3] === undefined) return refuse("host-only");
    origin = o;
    path = m[3];
  }
  if (path === "/") return refuse("host-only");
  if (PATTERN_CHARS.test(path)) return refuse("pattern");
  if (KIT_ROUTE.test(path)) return refuse("kit-route");
  return { refusal: null, origin, path };
}

/** Why this name would be refused, or null when it is accepted. */
export function waitNameRefusal(name: unknown): WaitNameRefusal | null {
  return judge(name).refusal;
}

/** The base relative addresses resolve against, as the browser resolves a
 *  call's own address: the document's base URL, else the page's. */
function pageBase(): string | undefined {
  try {
    if (typeof document !== "undefined" && typeof document.baseURI === "string" && document.baseURI) {
      return document.baseURI;
    }
  } catch {
    // fall through to the page's own address
  }
  try {
    if (typeof location !== "undefined" && typeof location.href === "string") return location.href;
  } catch {
    // no page address at all
  }
  return undefined;
}

function pageOrigin(): string | null {
  try {
    if (typeof location !== "undefined" && typeof location.origin === "string") return location.origin;
  } catch {
    // no page origin
  }
  return null;
}

/** A name's path, spelled the way the browser spells a call's path (the same
 *  percent-encoding and dot-segment rules), so the two compare as written. */
function normalisedPath(path: string): string {
  try {
    return new URL(path, "http://boosthis.invalid").pathname;
  } catch {
    return path;
  }
}

function segmentsOf(path: string): string[][] {
  return path.split("/").map((seg) => seg.split(PLACEHOLDER));
}

/** Does one call segment fit one named segment? Literal pieces in order, each
 *  placeholder standing for at least one character, never a `/`. */
function segmentFits(pieces: readonly string[], seg: string): boolean {
  if (pieces.length === 1) return seg === pieces[0];
  const first = pieces[0]!;
  const last = pieces[pieces.length - 1]!;
  if (!seg.startsWith(first)) return false;
  let pos = first.length;
  for (let i = 1; i < pieces.length - 1; i++) {
    const at = seg.indexOf(pieces[i]!, pos + 1);
    if (at === -1) return false;
    pos = at + pieces[i]!.length;
  }
  return seg.length - last.length >= pos + 1 && seg.endsWith(last);
}

function pathFits(name: HeldName, path: string): boolean {
  const segs = path.split("/");
  if (segs.length !== name.segments.length) return false;
  for (let i = 0; i < segs.length; i++) {
    if (!segmentFits(name.segments[i]!, segs[i]!)) return false;
  }
  return true;
}

/**
 * Take the developer's names. Returns the console lines to print — one per
 * refused entry, naming it by position and reason, or one line for a list
 * over the cap. Replaces any earlier declaration, and starts the counts
 * afresh with it. Never throws.
 */
export function declareWaitsOnPurpose(raw: unknown): string[] {
  const lines: string[] = [];
  try {
    held = [];
    resetDeclaredCallCounts();
    if (raw === undefined || raw === null) return lines;
    const list: unknown[] =
      typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [raw];
    const accepted: HeldName[] = [];
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      const verdict = judge(entry);
      if (verdict.refusal !== null) {
        lines.push(
          `Boosthis: waitsOnPurpose entry ${i + 1} was not accepted — ${WAIT_NAME_REFUSAL_REASON[verdict.refusal]}.`,
        );
        return;
      }
      const path = normalisedPath(verdict.path);
      const key = `${verdict.origin ?? ""} ${path}`;
      if (seen.has(key)) return;
      seen.add(key);
      accepted.push({ origin: verdict.origin, segments: segmentsOf(path), matched: false });
    });
    if (accepted.length > WAIT_NAME_CAP) {
      lines.push(
        `Boosthis: waitsOnPurpose holds at most ${WAIT_NAME_CAP} names and was given ${accepted.length}, so none are held — declare at most ${WAIT_NAME_CAP}.`,
      );
      return lines;
    }
    held = accepted;
  } catch {
    held = [];
  }
  return lines;
}

/** How many names the kit holds. */
export function heldWaitNameCount(): number {
  return held.length;
}

/** The address a call was given, resolved the way the browser resolves it.
 *  Read on the caller's stack for one decision and dropped. */
function addressOf(target: unknown): URL | null {
  let raw: string | null = null;
  if (typeof target === "string") raw = target;
  else if (target !== null && typeof target === "object") {
    const t = target as { href?: unknown; url?: unknown };
    if (typeof t.href === "string") raw = t.href;
    else if (typeof t.url === "string") raw = t.url;
  }
  if (raw === null) return null;
  const url = new URL(raw, pageBase());
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/**
 * Which held name this call's address matches: its position, or -1. Pure —
 * nothing is counted here. Costs nothing when no names are held, which is
 * every page that never declared one. Never throws.
 */
export function matchWaitName(target: unknown): number {
  if (held.length === 0) return -1;
  try {
    const url = addressOf(target);
    if (url === null) return -1;
    const own = pageOrigin();
    for (let i = 0; i < held.length; i++) {
      const name = held[i]!;
      const origin = name.origin ?? own;
      if (origin === null || origin !== url.origin) continue;
      if (pathFits(name, url.pathname)) return i;
    }
  } catch {
    // An address the page cannot parse matches nothing.
  }
  return -1;
}

/** A call matched this name (counted once per name, per window). */
export function noteDeclaredMatched(index: number): void {
  const name = held[index];
  if (name) name.matched = true;
}

/** A declared call ended with an answer: kept out of every reading, counted,
 *  and its wait remembered if it is the longest. */
export function noteDeclaredKeptOut(index: number, durationMs: number): void {
  const name = held[index];
  if (!name) return;
  name.matched = true;
  keptOut++;
  const ms = Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0));
  if (ms > keptOutWorstMs) keptOutWorstMs = ms;
}

/** The four counts, as they ride the network reading. Holding no names is
 *  four zeros — an answer — never an absent field. */
export function declaredCallCounts(): DeclaredCallCounts {
  let matched = 0;
  for (const name of held) if (name.matched) matched++;
  return {
    waitDeclaredNames: held.length,
    waitDeclaredMatched: matched,
    waitDeclaredExcluded: keptOut,
    waitDeclaredWorstMs: keptOut > 0 ? keptOutWorstMs : 0,
  };
}

/** Start a new counting window. The names are kept: they were typed against
 *  the running code, and only a new declaration replaces them. */
export function resetDeclaredCallCounts(): void {
  keptOut = 0;
  keptOutWorstMs = 0;
  for (const name of held) name.matched = false;
}

/** @internal test hook — forget the names and the counts. */
export function _resetDeclaredCallsForTests(): void {
  held = [];
  keptOut = 0;
  keptOutWorstMs = 0;
  streamAddresses = [];
}

/* ─── The calling-side stream rule ─────────────────────────────────────── */

/**
 * Is this a response the contract calls a stream? The media type is
 * COMPARED, never searched for: everything before the first `;`, trimmed and
 * lowercased, against the closed list — `text/event-stream` and
 * `multipart/x-mixed-replace`. Types used for streams AND for ordinary bounded
 * answers stay off the list (leaving them out of the readings would drop real
 * latency with nothing said), and there is no duration threshold here.
 */
export function isStreamMediaType(contentType: unknown): boolean {
  if (typeof contentType !== "string") return false;
  const type = contentType.split(";", 1)[0]!.trim().toLowerCase();
  return type === "text/event-stream" || type === "multipart/x-mixed-replace";
}

/** How many stream addresses are remembered for the resource observer. */
const STREAM_ADDRESSES_MAX = 16;
/** Addresses of calls the wrappers saw answer as a stream, so the passive
 *  observer — which learns of a call only when it CLOSES — times the same call
 *  to its headers. Kept in the tab, bounded, and taken when used. */
let streamAddresses: string[] = [];

/** Remember that a call to this address answered as a stream. */
export function noteStreamAddress(target: unknown): void {
  try {
    const url = addressOf(target);
    if (url === null) return;
    streamAddresses.push(url.href);
    if (streamAddresses.length > STREAM_ADDRESSES_MAX) streamAddresses.shift();
  } catch {
    // an address the page cannot parse is simply not remembered
  }
}

/** Was this address remembered as a stream? Taken when it is — one answer per
 *  stream the wrappers saw. */
export function takeStreamAddress(name: unknown): boolean {
  if (streamAddresses.length === 0 || typeof name !== "string") return false;
  const at = streamAddresses.indexOf(name);
  if (at === -1) return false;
  streamAddresses.splice(at, 1);
  return true;
}
