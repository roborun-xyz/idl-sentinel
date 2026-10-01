/**
 * Simple in-memory cache with TTL (Time To Live)
 * For production with multiple instances, consider using Redis
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class SimpleCache {
  private pending = new Map<string, Promise<unknown>>();
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  /**
   * Get a value from cache
   * Returns null if not found or expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache with TTL in seconds
   */
  set<T>(key: string, value: T, ttlSeconds: number): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Clear a specific key
   */
  delete(key: string): void {
    this.cache.delete(key);
    this.pending.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  /**
   * Remove expired entries (garbage collection)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get or compute a cached value
   * If the key exists and is not expired, return cached value
   * Otherwise, compute the value, cache it, and return it
   */
  async getOrCompute<T>(key: string, computeFn: () => Promise<T>, ttlSeconds: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    const task = computeFn()
      .then((value) => {
        if (this.pending.get(key) === task) this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key);
      });
    this.pending.set(key, task);
    return task;
  }
}

// Singleton instance
export const cache = new SimpleCache();

// Run cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      cache.cleanup();
    },
    5 * 60 * 1000
  ).unref?.();
}

// Cache invalidation helpers
export const CacheKeys = {
  DASHBOARD_STATS: "dashboard:stats",
  CHANGE_STATISTICS: "change:statistics",
  ALL_PROGRAMS: "programs:all",
} as const;

// Cache TTLs in seconds
export const CacheTTL = {
  DASHBOARD_STATS: 60, // 1 minute
  CHANGE_STATISTICS: 60, // 1 minute
  ALL_PROGRAMS: 30, // 30 seconds
} as const;
