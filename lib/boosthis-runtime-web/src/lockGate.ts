/**
 * The lock gate, in a module that imports nothing.
 *
 * Every measurement reads the one lock (docs/kit-lock-rule.md) and hands
 * killSwitch.ts the teardown it needs when a project locks. Reaching those two
 * calls by importing killSwitch.ts pulled each collector into this kit's
 * recorded module cycle, which may only shrink (lib/kit-module-cycles.json).
 * killSwitch.ts binds its real gate here while it is evaluated. Before that the
 * gate answers inert — the same fail-closed answer killSwitch gives before it
 * has read anything — and a holder registered that early is handed over the
 * moment the real gate arrives.
 */

/** Holders register here rather than importing collectors into the answer file.
 * Callbacks must only stop kit work, never cancel a host request or timer. */
export interface LockLifecycle {
  uninstall: () => void;
  clear: () => void;
  reinstall?: () => void;
  erase?: () => void;
  dropHandovers?: () => void;
}

export interface LockGate {
  isRuntimeInert(): boolean;
  entitlementGeneration(): number;
  registerLockLifecycle(holder: LockLifecycle): () => void;
}

let gate: LockGate | null = null;
/** Holders registered before the real gate arrived, each with the release the
 *  real gate handed back once it did (null until then). */
const early = new Map<LockLifecycle, (() => void) | null>();

export function bindLockGate(real: LockGate): void {
  gate = real;
  for (const holder of [...early.keys()]) early.set(holder, real.registerLockLifecycle(holder));
}

/** True whenever the kit may not measure. Inert until the real gate is bound. */
export function isRuntimeInert(): boolean {
  return gate ? gate.isRuntimeInert() : true;
}

/** Moves on every lock, so a reading started before one is never kept. */
export function entitlementGeneration(): number {
  return gate ? gate.entitlementGeneration() : 0;
}

export function registerLockLifecycle(holder: LockLifecycle): () => void {
  if (gate) return gate.registerLockLifecycle(holder);
  early.set(holder, null);
  return () => {
    const release = early.get(holder);
    early.delete(holder);
    release?.();
  };
}
