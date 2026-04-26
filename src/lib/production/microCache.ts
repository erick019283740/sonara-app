/**
 * Local in-memory micro cache for fast path optimization
 * 
 * This reduces Redis hits for frequently accessed data like rate limiting timestamps.
 * Not persistent - cleared on server restart.
 */

interface MicroCacheEntry<T> {
  value: T;
  expiry: number;
}

class MicroCache<T> {
  private cache: Map<string, MicroCacheEntry<T>> = new Map();
  private defaultTTL: number;

  constructor(defaultTTL: number = 1000) {
    this.defaultTTL = defaultTTL;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    const expiry = Date.now() + (ttl ?? this.defaultTTL);
    this.cache.set(key, { value, expiry });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instances with different TTLs
export const rateLimitCache = new MicroCache<number>(60000); // 1 minute
export const sessionCache = new MicroCache<string>(300000); // 5 minutes
export const metadataCache = new MicroCache<Record<string, unknown>>(10000); // 10 seconds

// Cleanup expired entries every minute
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    rateLimitCache.cleanup();
    sessionCache.cleanup();
    metadataCache.cleanup();
  }, 60000);
}
