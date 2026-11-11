/**
 * Redis-like Scoped Edge Memory Cache for D1 & Worker Isolates.
 *
 * Scoped per `D1Database` instance via WeakMap so isolated test databases never
 * share cached state, while production requests within a warm Worker isolate
 * reuse hot reference data and resolved actor entitlements with 0ms D1 latency
 * and instant targeted invalidation on writes.
 */

type CacheEntry<T = unknown> = {
  value: T;
  expiresAt: number;
  storedAt: number;
};

type CacheStats = {
  hits: number;
  misses: number;
  invalidations: number;
};

type ScopedStore = {
  entries: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<unknown>>;
  stats: CacheStats;
};

const DEFAULT_TTL_MS = 60_000;
const stores = new WeakMap<D1Database, ScopedStore>();

function getStore(db: D1Database): ScopedStore {
  let store = stores.get(db);
  if (!store) {
    store = {
      entries: new Map(),
      inFlight: new Map(),
      stats: { hits: 0, misses: 0, invalidations: 0 },
    };
    stores.set(db, store);
  }
  return store;
}

export const edgeCache = {
  /**
   * Read a value from the scoped cache if present and not expired.
   */
  get<T>(db: D1Database, key: string): T | undefined {
    const store = getStore(db);
    const entry = store.entries.get(key);
    if (!entry) {
      store.stats.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      store.entries.delete(key);
      store.stats.misses += 1;
      return undefined;
    }
    store.stats.hits += 1;
    return entry.value as T;
  },

  /**
   * Store a value with a TTL in milliseconds (defaults to 60s).
   */
  set<T>(db: D1Database, key: string, value: T, ttlMs = DEFAULT_TTL_MS): T {
    const store = getStore(db);
    const now = Date.now();
    store.entries.set(key, {
      value,
      storedAt: now,
      expiresAt: now + Math.max(1, ttlMs),
    });
    return value;
  },

  /**
   * Cache-Aside loader with concurrent stampede protection (single-flight).
   */
  async getOrLoad<T>(
    db: D1Database,
    key: string,
    loader: () => Promise<T>,
    ttlMs = DEFAULT_TTL_MS,
  ): Promise<T> {
    const cached = this.get<T>(db, key);
    if (cached !== undefined) return cached;

    const store = getStore(db);
    const pending = store.inFlight.get(key);
    if (pending) {
      store.stats.hits += 1;
      return pending as Promise<T>;
    }

    const promise = (async () => {
      try {
        const loaded = await loader();
        if (loaded !== undefined && loaded !== null) {
          this.set(db, key, loaded, ttlMs);
        }
        return loaded;
      } finally {
        store.inFlight.delete(key);
      }
    })();

    store.inFlight.set(key, promise);
    return promise;
  },

  /**
   * Immediately purge a specific key.
   */
  del(db: D1Database, key: string): void {
    const store = getStore(db);
    if (store.entries.delete(key)) {
      store.stats.invalidations += 1;
    }
    store.inFlight.delete(key);
  },

  /**
   * Immediately purge all keys matching a given prefix (e.g. `actor:`, `catalog:`).
   */
  invalidatePrefix(db: D1Database, prefix: string): void {
    const store = getStore(db);
    for (const key of store.entries.keys()) {
      if (key.startsWith(prefix)) {
        store.entries.delete(key);
        store.stats.invalidations += 1;
      }
    }
    for (const key of store.inFlight.keys()) {
      if (key.startsWith(prefix)) {
        store.inFlight.delete(key);
      }
    }
  },

  /**
   * Purge the entire cache for the given database binding.
   */
  clearAll(db: D1Database): void {
    const store = getStore(db);
    store.stats.invalidations += store.entries.size;
    store.entries.clear();
    store.inFlight.clear();
  },

  /**
   * Return cache hit/miss/invalidation metrics for diagnostics and unit tests.
   */
  stats(db: D1Database): CacheStats & { size: number } {
    const store = getStore(db);
    return {
      ...store.stats,
      size: store.entries.size,
    };
  },
};

