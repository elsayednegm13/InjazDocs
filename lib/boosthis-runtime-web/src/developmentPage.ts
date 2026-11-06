/* ─── Boosthis: is this page the developer's own, not the live site? ─────
 *
 * The browser kit's install id is baked into the page by the host, and the
 * server hands any browser that presents it that install's credentials. A page
 * built from the same code and opened on the developer's own machine therefore
 * presented itself as the LIVE site's install: mid-edit crashes landed in the
 * live crash record and could send crash alerts, the dashboard's current
 * snapshot could be the developer's localhost page, and reload bursts spent the
 * live site's upload allowance.
 *
 * So a page the kit can RECOGNISE as development reports as a separate
 * development install of the same project (same project key), derived from the
 * baked id. Recognition is two positive facts and nothing else:
 *
 *   • a development build — the bundler-inlined `process.env.NODE_ENV` reads
 *     exactly "development". The dev-posture check reads the same variable but
 *     flags anything that is not "production"; that is right for a posture
 *     flag and wrong here, where a "test" run, an erased `process`, or a
 *     `process.env = {}` shim would silently move a LIVE site's crashes out of
 *     its own record. Only the positive word counts.
 *   • a loopback address — localhost, 127.0.0.1, ::1, or a name ending in
 *     ".localhost" (which browsers resolve to loopback by rule).
 *
 * NOTHING ELSE. A local-network address may be a shop's till; a `.local` name,
 * a preview address or a hosting provider's dev domain is somebody's real
 * traffic as far as the kit can know. An environment the kit cannot recognise
 * stays unknown and keeps the baked id.
 *
 * WHAT LEAVES THE PAGE: the word "development" at registration, and an install
 * id derived from the baked one. Never the address, never the port.
 *
 * WHY DERIVED, NOT MINTED: the derivation is deterministic, so every developer
 * on a team, every reload and every cleared browser lands on the SAME
 * development install — one fresh registration for the project, ever, rather
 * than one per developer per cleared store. Nothing new is stored to remember
 * it, so the end user's storage permission (endUserConsent.ts) governs nothing
 * extra here: what the kit stores per install (the read token) keys off this id
 * exactly as it keys off the baked one, behind the same gate.
 */

import { readBuildEnv } from "./buildEnv";

/** The one environment word this module can return. Anything it cannot
 *  recognise is `null`: unknown, and the baked id is kept. */
export type RecognisedPageEnvironment = "development";

let testEnvironment: RecognisedPageEnvironment | null | undefined;

/** Loopback by rule. `location.hostname` brackets an IPv6 literal. */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (h === "") return false;
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}

/** True only when the build's NODE_ENV — the flag the kit already reads for
 *  its debug-build reading (devPosture.ts, through the same reader in
 *  buildEnv.ts) — is exactly "development". */
function isDevelopmentBuild(): boolean {
  return readBuildEnv().nodeEnv === "development";
}

function currentHostname(): string {
  try {
    if (typeof location === "undefined" || !location) return "";
    return typeof location.hostname === "string" ? location.hostname : "";
  } catch {
    return "";
  }
}

/** "development" when this page is recognisably the developer's own, else
 *  null. Read once per start; never throws. */
export function pageEnvironmentNow(): RecognisedPageEnvironment | null {
  if (testEnvironment !== undefined) return testEnvironment;
  if (isDevelopmentBuild()) return "development";
  return isLoopbackHostname(currentHostname()) ? "development" : null;
}

/** cyrb128 — a small, public-domain, non-cryptographic 128-bit string hash.
 *  Secrecy is not the point (the baked id is in the page for anyone to read);
 *  stability and spread are. */
function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const hex8 = (n: number): string => n.toString(16).padStart(8, "0");

/**
 * The development install id for a baked install id: a UUID (version 8, the
 * RFC 9562 "custom" version, RFC variant) derived deterministically, so the
 * server's registration shape check accepts it and the same baked id always
 * yields the same development install. Never equal to the baked id.
 */
export function developmentInstallIdFor(bakedInstallId: string): string {
  const baked = bakedInstallId.trim().toLowerCase();
  for (let salt = 0; ; salt++) {
    const [a, b, c, d] = hash128(
      `boosthis:development-install:v1:${salt}:${baked}`,
    ).map(hex8);
    const variant = ((parseInt(c![0]!, 16) & 0x3) | 0x8).toString(16);
    const id = `${a}-${b!.slice(0, 4)}-8${b!.slice(5, 8)}-${variant}${c!.slice(1, 4)}-${c!.slice(4, 8)}${d}`;
    if (id !== baked) return id;
  }
}

/** Test seam: pin the recognised environment (`undefined` restores the real
 *  reading). */
export function _setPageEnvironmentForTests(
  env: RecognisedPageEnvironment | null | undefined,
): void {
  testEnvironment = env;
}
