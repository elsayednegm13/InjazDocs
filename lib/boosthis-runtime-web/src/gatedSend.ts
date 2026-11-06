/* ─── One door for everything this kit sends ───────────────────────────────
 *
 * The browser runtime runs on a device that belongs to a member of the public.
 * When that person's permission is withheld, NOTHING may leave the page — and
 * "nothing" has to mean every sender, including the one somebody adds next
 * year, not the seven that existed when the gate was written.
 *
 * So the gate is a door rather than a rule: every internal upload goes through
 * `_gatedTransmitInternal`, and `__tests__/gatedSend.test.ts` fails the build if any
 * module other than this one imports `_safeTransmitInternal` directly. A new
 * sender therefore cannot bypass the gate by not knowing about it.
 *
 * WHY IT IS NOT INSIDE `transmit.ts`
 * ----------------------------------
 * `transmit.ts` is byte-identical to the Node runtime's copy, and that parity
 * is itself a guard (`__tests__/parity.test.ts`): the PII screen and the
 * kill-switch must behave the same in both. The Node runtime writes on a
 * server the customer operates, never on an end user's device, so it has no
 * end-user consent gate — putting one in the shared file would either break
 * the parity contract or ship a control to a kit that has nothing to gate.
 *
 * THE ONE SEND THAT IS NOT GATED
 * ------------------------------
 * Erasure. `_safeTransmitTrustedPayload` carries `/installs/forget`, and a
 * visitor who has just withdrawn permission needs that request to arrive:
 * refusing to send it would strand their data with us and call it privacy.
 * That helper is deliberately not routed through this door.
 *
 * NOT the registration handshake. `client.consent()` and `/installs/consent`
 * are the handshake that registers an install with the Boosthis server; they
 * go through this door like everything else, because registering is the first
 * thing a site whose visitor said no must not do.
 */

import { maySendToServer } from "./endUserConsent";
import { isRuntimeInert, isRegistrationStopped } from "./killSwitch";
import { isBoosthisDisabled } from "./runtimeFlags";
import { LOCAL_PAUSE_STATUS_TEXT, pausedUntil } from "./uploadPacing";
import {
  _noSendAnswer,
  _safeTransmitInternal,
  type InternalPostOptions,
} from "./transmit";
import { VISIT_HEADER, visitHeaderValue } from "./visitTag";
import { outsideAngular } from "./zoneSafe";

/**
 * @internal
 *
 * {@link _safeTransmitInternal}, behind the end user's permission.
 *
 * Same parameters, same return. When permission is withheld this makes no
 * request at all and hands back a 204 stamped `Boosthis consent withheld` —
 * a THIRD answer, distinct from the kill-switch's "disabled" and the
 * entitlement lock's "inert", so a caller can tell which of the three it is
 * looking at. `isNoSendResponse()` recognises it exactly, so no caller can
 * mistake it for a confirmation from the server.
 */
export async function _gatedTransmitInternal(
  url: string,
  payload: unknown,
  opts: InternalPostOptions = {},
  authHeader?: string,
  internalHeaders?: Record<string, string>,
): Promise<Response> {
  if (!maySendToServer()) {
    return _noSendAnswer("Boosthis consent withheld");
  }
  const heldUntil = heldByStatedWait(url);
  if (heldUntil !== null) {
    // A LOCAL answer, never a request: a 429 carrying the wait that remains.
    // Every sender already treats a 429 as "asked to wait" — it holds its
    // batch and resumes when the wait is over — so a path that forgot to
    // check the pause itself still cannot spend the allowance under it.
    const seconds = Math.max(1, Math.ceil((heldUntil - Date.now()) / 1000));
    return new Response(null, {
      status: 429,
      statusText: LOCAL_PAUSE_STATUS_TEXT,
      headers: { "Retry-After": String(seconds) },
    });
  }
  // Every one of the kit's own uploads leaves through here, so this is where
  // it is sent outside an Angular app's zone (zoneSafe.ts): the app never
  // waits on the kit's request to become stable. The shared transport stays
  // byte-identical with the server kit's copy, so the zone is entered here.
  return outsideAngular(() =>
    _safeTransmitInternal(
      url,
      payload,
      opts,
      authHeader,
      withVisitTag(url, payload, opts, internalHeaders),
    ),
  );
}

/**
 * THE DAILY VISIT TAG, on the install's own uploads and its registration —
 * the same paths a stated wait holds back, and no others (visitTag.ts).
 *
 * It rides as a Boosthis-controlled header beside the install token, so it
 * adds no request, and it is minted only for a send that will really be made:
 * a kit the kill switch or the activation lock has silenced writes no tag to
 * the device for an upload that never leaves it. Any failure sends the upload
 * untagged — the tag is never a reason for an upload not to happen.
 */
function withVisitTag(
  url: string,
  payload: unknown,
  opts: InternalPostOptions,
  internalHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
  try {
    if (!isInstallPath(url)) return internalHeaders;
    const silenced =
      isBoosthisDisabled() ||
      (opts.allowWhenLocked ? isRegistrationStopped() : isRuntimeInert());
    if (silenced) return internalHeaders;
    const installId =
      payload !== null && typeof payload === "object"
        ? (payload as { installId?: unknown }).installId
        : undefined;
    const value = visitHeaderValue(installId);
    if (value === null) return internalHeaders;
    return { ...(internalHeaders ?? {}), [VISIT_HEADER]: value };
  } catch {
    return internalHeaders;
  }
}

/** The install's uploads and its registration handshake: what a wait
 *  Boosthis stated holds back (uploadPacing.ts), and what carries the daily
 *  visit tag (visitTag.ts). A developer's own rule proposal is not an install
 *  upload: it is not held and carries no tag. Written as the last path
 *  segments, matched after a slash: this list names what is held, it is not
 *  where anything is sent from. */
const HELD_BY_A_WAIT = [
  "installs/consent",
  "samples",
  "snapshots",
  "spans",
  "crashes",
  "candidates",
  "resolutions",
];

/** Is this one of the install's uploads or its registration? */
function isInstallPath(url: string): boolean {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* a relative endpoint is matched as written */
  }
  return HELD_BY_A_WAIT.some((p) => path.endsWith(`/${p}`));
}

function heldByStatedWait(url: string): number | null {
  try {
    const until = pausedUntil();
    if (until === null) return null;
    return isInstallPath(url) ? until : null;
  } catch {
    return null;
  }
}
