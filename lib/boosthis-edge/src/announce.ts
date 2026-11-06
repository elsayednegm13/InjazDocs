/** One line, said out loud the moment the kit is switched on.
 *
 * Same contract as every other Boosthis kit: exactly one ungated line before
 * any key is read and before anything is registered, so "no line" means the
 * kit never ran and nothing about keys or networks matters yet. It is never
 * silenced by a quiet mode or a privacy setting, and it never prints a key —
 * only its last four characters, which the developer already holds.
 *
 * An isolate has no long-lived process, so this is said once per isolate: on a
 * busy Worker that is rare, on a cold one it is the first thing in the log.
 */

import { safeVoid } from "./safe";
import { EDGE_PLATFORM_LABELS, type EdgePlatform } from "./platform";
import { RUNTIME_VERSION } from "./version";

export type Notice = (line: string) => void;

function defaultNotice(line: string): void {
  safeVoid(() => {
    const c = (globalThis as { console?: { warn?: (s: string) => void } }).console;
    if (typeof c?.warn === "function") c.warn(line);
  });
}

let announced = false;

/** Say the startup line once for this isolate. */
export function announceStart(args: {
  platform: EdgePlatform;
  keyTail: string | null;
  notice?: Notice | undefined;
}): void {
  if (announced) return;
  announced = true;
  const say = args.notice ?? defaultNotice;
  const where = EDGE_PLATFORM_LABELS[args.platform];
  const key = args.keyTail
    ? `project key …${args.keyTail}`
    : "NO PROJECT KEY — nothing will be measured until BOOSTHIS_PROJECT_KEY is set";
  safeVoid(() => say(`[boosthis] edge kit ${RUNTIME_VERSION} started on ${where} · ${key}`));
}

/** Say something once, keyed by a code-defined marker. Used for the honest
 *  "we registered but never saw a request" / "we could not reach Boosthis"
 *  lines — each cause gets its OWN sentence, never a generic failure. */
const saidOnce = new Set<string>();
export function sayOnce(marker: string, line: string, notice?: Notice): void {
  if (saidOnce.has(marker)) return;
  saidOnce.add(marker);
  const say = notice ?? defaultNotice;
  safeVoid(() => say(`[boosthis] ${line}`));
}

export function _resetAnnounceForTests(): void {
  announced = false;
  saidOnce.clear();
}
