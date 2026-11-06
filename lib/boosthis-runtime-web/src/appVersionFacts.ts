/**
 * THE VERSION OF THE APP THIS KIT IS RUNNING INSIDE — never our own.
 *
 * This kit reports its OWN version, as `packageVersion` on its registration
 * and every upload and as `kitVersion` on its check-in, and that value is
 * built in: a required kit update can only stop the old copies it can place,
 * so nothing an app passes in may change it or blank it.
 *
 * An app that sets the `packageVersion` option was naming ITS release, not
 * ours. That value travels here instead, in the block the server keeps for
 * the app's own version, marked as declared because the app handed it over on
 * purpose. This module never falls back to `RUNTIME_VERSION`: an app that
 * declared nothing sends no block at all, which the server reads as "this kit
 * has never told us", because a wrong answer is worse than a missing one.
 */

/**
 * The one word this kit sends for where the version came from. It must be a
 * word the server holds (`APP_VERSION_SOURCES` in
 * lib/api-zod/src/appVersionFields.ts), or the server keeps the version and
 * records no release from it; `appVersionWireParity.test.ts` holds the two
 * together.
 */
export const DECLARED_APP_VERSION_SOURCE = "declared" as const;

/** The block as it goes on the wire. */
export interface DeclaredAppVersion {
  version: string;
  source: typeof DECLARED_APP_VERSION_SOURCE;
}

/** The longest version string this kit will send. Matches the server's own
 *  ceiling, so a value that leaves here is one a release row can hold. A
 *  longer one is dropped rather than shortened: half a version number is a
 *  different version number. */
export const MAX_APP_VERSION = 60;

/** What the server will accept: starts alphanumeric, then letters, digits,
 *  dot, dash, underscore and plus. Checked here so a value that cannot be
 *  stored is never sent, rather than vanishing on arrival. */
const APP_VERSION_SHAPE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** True for a string this kit is willing to put on the wire as a version. */
export function isSendableAppVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_APP_VERSION &&
    APP_VERSION_SHAPE_RE.test(value.trim())
  );
}

/**
 * The app's declared version as it goes on the wire, or nothing at all.
 *
 * Spread into the registration. A missing, empty or unsendable value adds no
 * `app` key, which is a different thing from sending an empty one. Never
 * throws: no version may cost an app its registration.
 */
export function declaredAppVersionBlock(
  declared: unknown,
): { app: DeclaredAppVersion } | Record<string, never> {
  if (!isSendableAppVersion(declared)) return {};
  return {
    app: { version: declared.trim(), source: DECLARED_APP_VERSION_SOURCE },
  };
}
