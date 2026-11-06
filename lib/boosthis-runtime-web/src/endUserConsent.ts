/* ─── Boosthis: the switch an end user's consent drives ────────────────────
 *
 * This kit writes on a device that belongs to a member of the public, not to
 * the customer who installed it. Storing information on — or reading it back
 * out of — someone's terminal equipment is regulated in its own right, and
 * the rule is the same shape in the UK (PECR reg. 6) and across the EU
 * (ePrivacy Art. 5(3)): consent is needed unless the storage is strictly
 * necessary for a service THAT person asked for.
 *
 * `docs/decisions/end-user-device-storage-consent.md` holds the item-by-item
 * reading. Its conclusion, which this module implements: nothing this kit
 * stores on an end user's device is strictly necessary for a service the end
 * user requested, so the gate below has no carve-outs — no key keeps being
 * written after a customer switches it off.
 *
 * WHOSE DECISION THIS IS
 * ----------------------
 * The customer owns the banner; we own the switch it drives. This module
 * decides nothing about whether a given site needs consent — that is a
 * conclusion about their visitors and their jurisdiction, and it is not ours
 * to reach. The default is `granted`, an unchanged install behaves exactly as
 * it did, and the install guide says so plainly next to the recipe.
 *
 * NOT TO BE CONFUSED WITH `client.consent()`
 * ------------------------------------------
 * The kit's `consent()` method and the `/installs/consent` endpoint are the
 * handshake that REGISTERS this install with the Boosthis server. They have
 * nothing to do with the end user's permission. Customer-facing text calls
 * that handshake "registration" for exactly this reason; the code keeps the
 * old name because renaming a live wire path to fix a wording problem would
 * break every install in the field.
 *
 * A LEAF, ON PURPOSE
 * ------------------
 * This module imports `storage.ts` and nothing else. Everything that has to
 * REACT to a change — stopping timers, erasing in-memory state, asking the
 * server to delete an install — subscribes through
 * `_onEndUserConsentChange()` instead of being imported from here. A module
 * that both drives the gate and is imported by the gate is a cycle, and the
 * cycle guard would (rightly) fail it.
 */

import { clearDeviceStorage, setPersistenceAllowed } from "./storage";

/**
 * The three states, and there are exactly three.
 *
 * Two would not do it. "On" and "off" cannot express the customer who knows
 * they will never obtain consent and still wants to see how their site
 * performs — they need measurement without storage, which is neither of the
 * other two answers.
 */
export const END_USER_CONSENT_STATES = [
  /** Permission held. Device storage allowed; the kit behaves as it always
   *  has. The default. */
  "granted",
  /** No permission. Nothing is stored on the device and nothing is sent. */
  "withheld",
  /** Measure, but store nothing durable. Uploads continue; every reading that
   *  needs state across a page load is ABSENT rather than estimated. */
  "memory-only",
] as const;

export type EndUserConsent = (typeof END_USER_CONSENT_STATES)[number];

/** What an install that says nothing runs as. See the decision record for why
 *  this is `granted` and not `withheld`. */
export const DEFAULT_END_USER_CONSENT: EndUserConsent = "granted";

/** What a listener is told. `previous` matters: leaving `granted` is the
 *  transition that erases, and a listener that only sees the new state cannot
 *  tell an erase-and-stop from a start-up in the same state. */
export interface EndUserConsentChange {
  state: EndUserConsent;
  previous: EndUserConsent;
  /** True when this change left `granted`, i.e. the device was just cleared. */
  erased: boolean;
}

type ConsentListener = (change: EndUserConsentChange) => void;

let state: EndUserConsent = DEFAULT_END_USER_CONSENT;
const listeners = new Set<ConsentListener>();

/** Is this one of the three words? A value outside the set is REFUSED, never
 *  coerced to the nearest one — guessing at "off" or "no" would make the kit's
 *  behaviour depend on a customer's spelling. */
export function isEndUserConsentState(v: unknown): v is EndUserConsent {
  return (
    typeof v === "string" &&
    (END_USER_CONSENT_STATES as readonly string[]).includes(v)
  );
}

/** The state now. */
export function getEndUserConsent(): EndUserConsent {
  return state;
}

/** May anything be written to the end user's device? */
export function mayStoreOnDevice(): boolean {
  return state === "granted";
}

/** May anything leave this page? False only in `withheld` — `memory-only` is
 *  about the device, not the network. Erasure is the one exception and it
 *  goes out through `_safeTransmitTrustedPayload`, which this does not gate:
 *  a visitor who has just withdrawn permission needs the delete request to
 *  reach us, and refusing to send it would trap their data here. */
export function maySendToServer(): boolean {
  return state !== "withheld";
}

/**
 * Apply a state.
 *
 * Synchronous and never throws — a banner callback is not a place to handle
 * an exception. Any move OUT of `granted` clears the device before listeners
 * run: switching off is not "stop writing", and a customer whose visitor just
 * withdrew permission needs what was already stored to be gone.
 *
 * Returns the state now in force, which is the previous one when the value
 * was not one of the three words.
 */
export function setEndUserConsent(next: unknown): EndUserConsent {
  if (!isEndUserConsentState(next)) return state;
  const previous = state;
  if (next === previous) return state;
  state = next;

  // Close (or open) the durable half FIRST, so nothing can land on the device
  // between here and the sweep below.
  try {
    setPersistenceAllowed(next === "granted");
  } catch {
    /* a switch must never throw */
  }

  const erased = previous === "granted";
  if (erased) {
    try {
      clearDeviceStorage();
    } catch {
      /* best-effort: the gate is shut either way */
    }
  }

  const change: EndUserConsentChange = { state: next, previous, erased };
  for (const fn of Array.from(listeners)) {
    try {
      fn(change);
    } catch {
      // One listener's failure must not stop the others, and must not turn a
      // consent change into a page error.
    }
  }
  return state;
}

/**
 * @internal Subscribe to changes. Returns an unsubscribe function.
 *
 * Not re-exported from `index.ts`: this is how the runtime's own modules
 * react, not a customer-facing hook. A customer who wants to know what state
 * the kit is in calls `getEndUserConsent()`.
 */
export function _onEndUserConsentChange(fn: ConsentListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/* ─── Do Not Track / Global Privacy Control ───────────────────────────────
 *
 * Off by default, and read only when the customer opts in with
 * `respectDoNotTrack: true`. Turning a browser preference into a consent
 * decision is itself a legal conclusion, and DNT in particular is not one —
 * it is a statement about tracking, not a permission about storage. A
 * customer who has decided it means "no" for their site can say so; we do not
 * decide it for them.
 */

/** True when this browser is asking not to be tracked, by either signal.
 *  Never throws: an exotic or partial `navigator` simply reads as "no signal",
 *  which is the direction that does not invent a refusal. */
export function browserSignalsDoNotTrack(): boolean {
  try {
    const nav = (
      globalThis as unknown as {
        navigator?: {
          doNotTrack?: unknown;
          globalPrivacyControl?: unknown;
          msDoNotTrack?: unknown;
        };
      }
    ).navigator;
    if (!nav) return false;
    if (nav.globalPrivacyControl === true) return true;
    const dnt = nav.doNotTrack ?? nav.msDoNotTrack;
    return dnt === "1" || dnt === 1 || dnt === true || dnt === "yes";
  } catch {
    return false;
  }
}

/**
 * What state a start call asks for, or `null` when it asks for nothing.
 *
 * `null` is not the same as `granted`, and the difference is the whole point.
 * Setting the state and then starting the kit is a natural order for a
 * customer whose banner has already been answered:
 *
 *     setEndUserConsent(banner.answered ? "granted" : "withheld");
 *     enableTelemetry({ installId, inviteKey });
 *
 * If a start call that named nothing returned `granted`, that second line
 * would silently overrule the first. So a call that says nothing leaves the
 * state alone, whatever it is.
 *
 * An explicit `endUserConsent` always wins over `respectDoNotTrack`: a
 * customer who names a state has made the decision, and a browser signal must
 * not overrule them.
 */
export function resolveStartConsent(opts?: {
  endUserConsent?: unknown;
  respectDoNotTrack?: boolean;
}): EndUserConsent | null {
  if (isEndUserConsentState(opts?.endUserConsent)) {
    return opts.endUserConsent;
  }
  if (opts?.respectDoNotTrack === true && browserSignalsDoNotTrack()) {
    return "withheld";
  }
  return null;
}

/** Test-only: back to the shipped default, with no listeners attached. */
export function _resetEndUserConsentForTests(): void {
  state = DEFAULT_END_USER_CONSENT;
  listeners.clear();
  try {
    setPersistenceAllowed(true);
  } catch {
    /* ignore */
  }
}
