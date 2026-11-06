/** What this isolate observed about its hosting PLATFORM — not about the app.
 *
 * An isolate learns one thing about its platform that nothing else can tell us
 * reliably: whether work handed to the after-the-reply mechanism REALLY RAN.
 * That question cannot be answered by looking. Vercel's `waitUntil()` is
 * importable, callable, and off-platform it silently discards the promise
 * without throwing; a helper being present proves nothing. The only honest
 * answer comes from the work itself finishing, which is what this counts.
 *
 * It rides the snapshot the kit already sends. There is no new call, no new
 * timer and no new mechanism — the flush already had to tell us it finished so
 * a second one is not started on top of it.
 *
 * ## Two rules
 *
 * **A key we omit is not a "no".** An isolate that never deferred anything, or
 * whose deferred work was swallowed by a frozen platform, both look the same
 * from inside: nothing came back. Reporting that as "this platform does not run
 * work after the reply" would be reporting our own deafness as a finding, so
 * nothing is reported at all. This fact is only ever knowable in the positive
 * direction, which is fine — the failure that matters is a platform quietly
 * GAINING an ability we recorded as absent.
 *
 * **A floating promise is not the platform doing anything.** A plain
 * `Deno.serve` process is a long-lived server: an unawaited promise keeps
 * running because nothing tears the process down, not because the platform
 * offers a hook. Counting that as an after-response mechanism would file a fact
 * about Deno the language against Deno Deploy the platform. Only `ctx` and
 * `runtime` handoffs are counted.
 *
 * Nothing here is about the customer: one number, identical for every install
 * on the platform, and the platform's own name is not even in it — the install
 * declared where it runs when it registered.
 */

import type { AfterResponseKind } from "./platform";

let afterResponseCompleted = 0;

/**
 * Deferred work finished. Called by the flush's own completion path, with the
 * mechanism that carried it, so a long-lived process's floating promise is not
 * mistaken for a platform hook.
 */
export function noteAfterResponseCompleted(kind: AfterResponseKind): void {
  if (kind !== "ctx" && kind !== "runtime") return;
  afterResponseCompleted += 1;
}

/** The facts this isolate can honestly report. Empty when it has observed
 *  nothing, and an empty block is left out of the snapshot entirely. */
export function edgeHostFacts(): Record<string, number> {
  return afterResponseCompleted > 0 ? { afterResponseWork: 1 } : {};
}

/** THE LOCK RULE (docs/kit-lock-rule.md): forget what this isolate observed
 *  about its platform, with every other held reading. */
export function clearHostFacts(): void {
  afterResponseCompleted = 0;
}

/** Test seam: reset the per-isolate state a real isolate gets for free. */
export function _resetHostFactsForTests(): void {
  clearHostFacts();
}
