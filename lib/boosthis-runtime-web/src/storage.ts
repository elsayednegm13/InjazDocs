/** Tiny persistent key/value store for the web runtime.
 *
 * Uses `localStorage` when available (a real browser) and falls back to an
 * in-memory Map everywhere else (SSR, tests, the Node-side MCP entrypoint),
 * so callers never have to feature-detect. Every access is wrapped in
 * try/catch because `localStorage` can THROW on access in some environments
 * (Safari private mode, sandboxed iframes, storage-disabled embeds) — a
 * blocked store must degrade to memory, never crash the host page.
 *
 * All keys are namespaced under `boosthis:` so the runtime never collides
 * with (or enumerates) the host app's own storage.
 *
 * THE DURABLE HALF IS GATED.
 * --------------------------
 * `localStorage` on a visitor's browser is the visitor's own device, and
 * whether anything may be written there is the site owner's call to make on
 * their behalf — see `docs/decisions/end-user-device-storage-consent.md`.
 * `setPersistenceAllowed(false)` makes every write land in the in-memory map
 * instead, which is the SAME path a blocked store already takes, so callers
 * need no new branch: `isPersistent()` goes false and the honesty surfaces
 * that already read it say what they always said.
 *
 * The gate lives here, in the leaf, rather than in the module that owns the
 * consent state — a store that has to import the state machine could not be
 * imported BY it.
 */

const PREFIX = "boosthis:";

const mem = new Map<string, string>();

/** May the durable store be written/read? Flipped by `endUserConsent.ts`.
 *  Default TRUE: an unchanged install behaves exactly as it did. */
let persistenceAllowed = true;
let sealed = false;
/** A dissolved copy must not recreate records before the next page load. */
export function sealDeviceStorage(): void { sealed = true; }
export function deviceStorageSealed(): boolean { return sealed; }
const eraseListeners = new Set<() => void>();
/** Memory mirrors register locally, without importing the answer file. */
export function onDeviceErase(listener: () => void): void { eraseListeners.add(listener); }

function ls(): Storage | null {
  if (!persistenceAllowed) return null;
  try {
    if (typeof localStorage !== "undefined" && localStorage !== null) {
      return localStorage;
    }
  } catch {
    // Access itself can throw (storage disabled) — fall back to memory.
  }
  return null;
}

/** The durable store, ignoring the consent gate. Used ONLY by
 *  `clearDeviceStorage()`, which has to be able to delete what was written
 *  BEFORE the gate closed — a gate that hid the very rows it was asked to
 *  erase would leave them on the device for ever. */
function rawLs(): Storage | null {
  try {
    if (typeof localStorage !== "undefined" && localStorage !== null) {
      return localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

export const storage = {
  /** True when a real, durable store backs this wrapper (a browser with
   *  localStorage reachable, and the end-user consent gate open). False means
   *  every write lands in the in-memory fallback and dies with the page —
   *  callers that accumulate state across reloads need to be able to SAY that
   *  rather than imply a saved map. */
  isPersistent(): boolean {
    return ls() !== null;
  },

  /** Read a value, or null when absent/unreadable. Never throws. */
  get(key: string): string | null {
    const k = PREFIX + key;
    const s = ls();
    if (s) {
      try {
        const v = mem.get(k) ?? s.getItem(k);
        if (v !== null) return v;
      } catch {
        // fall through to memory
      }
    }
    return mem.get(k) ?? null;
  },

  /** Persist a value. Best-effort — a full/blocked store degrades to the
   *  in-memory fallback (survives the session, not the reload).
   *
   *  Returns TRUE only when the value reached the durable store. Existing
   *  callers ignore the result; callers that accumulate state across reloads
   *  use it to tell a saved map from one that only looks saved. */
  set(key: string, value: string): boolean {
    if (sealed) return false;
    const k = PREFIX + key;
    const s = ls();
    if (s) {
      try {
        s.setItem(k, value);
        mem.delete(k);
        return true;
      } catch {
        // Quota exceeded / blocked — degrade to memory.
      }
    }
    mem.set(k, value);
    return false;
  },

  /** Remove a value from BOTH layers (used by forget()). Never throws. */
  remove(key: string): void {
    if (sealed) return;
    const k = PREFIX + key;
    const s = rawLs();
    if (s) {
      try {
        s.removeItem(k);
      } catch {
        // ignore
      }
    }
    mem.delete(k);
  },
};

/**
 * Open or close the durable half of the store.
 *
 * Returns nothing and never throws: this is a switch, not a request. Closing
 * it does NOT erase — that is `clearDeviceStorage()`, kept separate so a
 * caller that only wants to stop writing cannot delete by accident and a
 * caller that wants both has to say both.
 */
export function setPersistenceAllowed(allowed: boolean): void {
  persistenceAllowed = allowed === true;
}

/** Is the durable half open? Reads the gate only — a browser with no
 *  `localStorage` at all still reports the gate's own answer, because the two
 *  facts are different and callers that conflate them cannot tell a visitor
 *  who refused from a browser that has no store. */
export function isPersistenceAllowed(): boolean {
  return persistenceAllowed;
}

/**
 * Delete EVERY `boosthis:`-namespaced entry from the end user's device.
 *
 * Enumerates the durable store rather than removing a list of known keys, for
 * two reasons. A list is hand-kept, and a module that adds a key without
 * adding it to the list leaves that key on a device whose owner asked for it
 * to be gone. And the script-tag entry point writes one already-prefixed key
 * (`boosthis:boosthis:tag:deleteToken:…`) that no list built from logical
 * names would ever match — a prefix sweep catches it, a roll-call does not.
 *
 * Returns the number of durable entries removed. Never throws: a store that
 * cannot be enumerated (blocked, disabled) has nothing of ours in it anyway,
 * and the in-memory half is cleared either way.
 */
export function clearDeviceStorage(): number {
  if (sealed) return 0;
  for (const listener of eraseListeners) {
    try { listener(); } catch { /* one mirror cannot prevent the sweep */ }
  }
  let removed = 0;
  const s = rawLs();
  if (s) {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (typeof k === "string" && k.startsWith(PREFIX)) doomed.push(k);
      }
      for (const k of doomed) {
        try {
          s.removeItem(k);
          removed++;
        } catch {
          // A key we cannot remove is reported by not being counted.
        }
      }
    } catch {
      // Enumeration itself can throw in a sandboxed frame.
    }
  }
  mem.clear();
  return removed;
}

/** Test-only: clear the in-memory fallback so each test starts hermetic. */
export function _resetStorageForTests(): void {
  sealed = false;
  mem.clear();
  persistenceAllowed = true;
}
