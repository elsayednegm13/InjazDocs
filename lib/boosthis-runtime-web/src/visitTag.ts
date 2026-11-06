/* ─── An anonymous tag that tells today's visitors apart ───────────────────
 *
 * A website measured through this kit is ONE install, shared by every
 * visitor's browser. Without something on each upload that tells two browsers
 * apart, the server can only keep the last arrival: one working visitor hides
 * any number of refused ones, and the kit version shown for the site is
 * whichever browser happened to report last.
 *
 * So every install upload and the registration handshake carry one short
 * header, `X-Boosthis-Visit`, holding a random value that changes every day.
 * The server folds it into an estimate of how many browsers sent readings and
 * how many were refused, and then drops it. This is the React Native kit's
 * daily reach tag (`reachTag.ts` there), with the day taken in UTC so it
 * changes on the same day the server counts by.
 *
 * PRIVACY CONTRACT — must never weaken
 * ------------------------------------
 *   • Pure random noise. Never derived from anything about the browser, the
 *     visitor, the page or the install.
 *   • A new value every UTC day, so it cannot link a browser across days.
 *   • Kept in the kit's existing consented storage (`storage.ts`), behind the
 *     same device-storage gate as everything else this kit keeps. Switching
 *     the gate off erases it with the rest (`clearDeviceStorage()` sweeps
 *     every `boosthis:` key), and `forget()` removes it.
 *   • When nothing durable may be kept — the visitor's site runs this kit in
 *     `memory-only`, or the browser blocks or fills its store — the value lives
 *     only as long as this page and is sent marked as a PAGE LOAD. The server
 *     counts those apart and never adds them to the browser count: one browser
 *     that keeps nothing can load a hundred pages.
 *   • The server never stores or logs the value itself, only its effect on an
 *     estimate (see `docs/decisions/end-user-device-storage-consent.md`).
 *   • Fail-safe: any error means no header, and the upload goes untagged.
 *
 * No request is added for it: the header rides the uploads the kit already
 * makes, and those already ask the browser's permission check (they send JSON
 * and a credential), so a page-exit send with `keepalive` is unchanged.
 */

import { storage } from "./storage";
import { RUNTIME_VERSION } from "./thresholds";

/** Where the day's value is kept, under the kit's `boosthis:` namespace. */
export const VISIT_TAG_STORE_KEY = "visit-tag:v1";

/** The one header that carries it. */
export const VISIT_HEADER = "X-Boosthis-Visit";

/** What a tag stands for: a browser that keeps the day's value, or one page
 *  load of a browser that keeps nothing. Never added together. */
export type VisitTagKind = "browser" | "page-load";

export interface VisitTag {
  kind: VisitTagKind;
  /** 16 lowercase hex characters of randomness. */
  tag: string;
}

const TAG_RE = /^[0-9a-f]{16}$/;

/** An install id the header may carry. Ids are minted by this kit as UUIDs;
 *  anything else is left off rather than sent. */
const INSTALL_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** This page's own value when nothing durable may be kept. Module state on
 *  purpose: it dies with the document, which is exactly its lifetime. */
let pageLoad: { d: string; t: string } | null = null;

/** The UTC calendar day, YYYY-MM-DD — the day the server counts by. */
export function utcDayStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** 16 hex characters from the browser's random source, or from Math.random
 *  where there is none. Never from anything about this browser. */
function randomTag(): string {
  try {
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (c && typeof c.getRandomValues === "function") {
      const bytes = new Uint8Array(8);
      c.getRandomValues(bytes);
      let out = "";
      for (const b of bytes) out += b.toString(16).padStart(2, "0");
      return out;
    }
  } catch {
    // fall through to Math.random
  }
  let out = "";
  for (let i = 0; i < 16; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function heldFor(day: string): string | null {
  const raw = storage.get(VISIT_TAG_STORE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { d?: unknown; t?: unknown };
    if (parsed && parsed.d === day && typeof parsed.t === "string" && TAG_RE.test(parsed.t)) {
      return parsed.t;
    }
  } catch {
    // A damaged entry is replaced below.
  }
  return null;
}

/**
 * Today's tag, minting a new one when the UTC day has changed. Returns null on
 * any failure — the caller sends the upload without it.
 */
export function currentVisitTag(nowMs: number = Date.now()): VisitTag | null {
  try {
    const day = utcDayStamp(nowMs);
    if (storage.isPersistent()) {
      const held = heldFor(day);
      if (held !== null) return { kind: "browser", tag: held };
      const fresh = randomTag();
      if (storage.set(VISIT_TAG_STORE_KEY, JSON.stringify({ d: day, t: fresh }))) {
        // Another tab of the same site may have written its own value in the
        // same moment. Adopt whatever the store holds now, so the two tabs go
        // on as one browser rather than two.
        return { kind: "browser", tag: heldFor(day) ?? fresh };
      }
      // The store refused the write (full, or blocked part-way through the
      // page), so the value only reached the in-memory fallback. Take it back
      // out: a later read must never mistake it for a durable one.
      storage.remove(VISIT_TAG_STORE_KEY);
    }
    if (pageLoad === null || pageLoad.d !== day) {
      pageLoad = { d: day, t: randomTag() };
    }
    return { kind: "page-load", tag: pageLoad.t };
  } catch {
    return null;
  }
}

/**
 * The header's value for one upload: the tag (`b=` for a browser, `p=` for a
 * page load), the install id the upload is filed under (so a refusal decided
 * before the server reads the body can still be counted against the right
 * site) and this kit's version. Null when there is no tag to send.
 */
export function visitHeaderValue(installId: unknown, nowMs: number = Date.now()): string | null {
  const t = currentVisitTag(nowMs);
  if (t === null) return null;
  const parts = [`${t.kind === "browser" ? "b" : "p"}=${t.tag}`];
  if (typeof installId === "string" && INSTALL_ID_RE.test(installId)) {
    parts.push(`i=${installId}`);
  }
  parts.push(`v=${RUNTIME_VERSION}`);
  return parts.join("; ");
}

/** Erase the day's value and this page's own — `forget()` leaves nothing
 *  Boosthis-shaped behind. Never throws. */
export function clearVisitTag(): void {
  pageLoad = null;
  try {
    storage.remove(VISIT_TAG_STORE_KEY);
  } catch {
    // best-effort
  }
}

/** Test-only: drop this page's own value so each test starts clean. */
export function _resetVisitTagForTests(): void {
  pageLoad = null;
}
