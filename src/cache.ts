// Small cache abstraction. In the Worker it is backed by the Cache API (per data centre, with a TTL).
// Where the Cache API does not exist (unit tests, some local setups) an in-memory Map is used instead.

export interface JsonCache {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export class MemoryCache implements JsonCache {
  private store = new Map<string, { value: unknown; expires: number }>();
  constructor(private now: () => number = Date.now) {}

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  async put(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.store.size > 500) this.store.clear(); // crude bound, the isolate is short-lived anyway
    this.store.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
  }
}

const CACHE_ORIGIN = "https://cache.whois.internal/";

/** Cache API implementation. Entries are JSON bodies under a synthetic URL that never leaves the Worker. */
export class EdgeCache implements JsonCache {
  constructor(private cache: Cache) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const res = await this.cache.match(CACHE_ORIGIN + encodeURIComponent(key));
      return res ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  async put(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.cache.put(
        CACHE_ORIGIN + encodeURIComponent(key),
        new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSeconds}` } }),
      );
    } catch {
      // A cache failure must never fail a lookup.
    }
  }
}

/** Cache API when available, memory otherwise. Created once per isolate. */
let shared: JsonCache | null = null;
export function defaultCache(): JsonCache {
  if (shared) return shared;
  const g = globalThis as unknown as { caches?: { default?: Cache } };
  shared = g.caches?.default ? new EdgeCache(g.caches.default) : new MemoryCache();
  return shared;
}
