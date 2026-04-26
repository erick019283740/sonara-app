/**
 * Multi-Layer Cache Strategy
 * Memory (10-30s) → Redis (30-120s) → Edge (60-300s)
 */

import { cacheGet as redisGet, cacheSet as redisSet } from "@/lib/production/cache";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class MultiLayerCache<T> {
  private memoryCache = new Map<string, CacheEntry<T>>();
  private defaultMemoryTTL = 20000; // 20 seconds
  private defaultRedisTTL = 60000; // 60 seconds
  private defaultEdgeTTL = 180000; // 3 minutes

  /**
   * Get from cache (tries memory → Redis → edge)
   */
  async get(key: string): Promise<T | null> {
    // Layer 1: Memory cache
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && Date.now() - memoryEntry.timestamp < memoryEntry.ttl) {
      return memoryEntry.data;
    }

    // Layer 2: Redis cache
    try {
      const redisData = await redisGet<T>(key);
      if (redisData) {
        // Promote to memory cache
        this.setMemory(key, redisData, this.defaultMemoryTTL);
        return redisData;
      }
    } catch (error) {
      console.error("[MultiLayerCache] Redis get failed:", error);
    }

    // Layer 3: Edge cache (would be CDN in production)
    // For now, return null - edge cache would be via CDN headers

    // Clean expired memory entry
    if (memoryEntry) {
      this.memoryCache.delete(key);
    }

    return null;
  }

  /**
   * Set in all cache layers
   */
  async set(
    key: string,
    data: T,
    options: {
      memoryTTL?: number;
      redisTTL?: number;
      edgeTTL?: number;
    } = {}
  ): Promise<void> {
    const memoryTTL = options.memoryTTL ?? this.defaultMemoryTTL;
    const redisTTL = options.redisTTL ?? this.defaultRedisTTL;
    const edgeTTL = options.edgeTTL ?? this.defaultEdgeTTL;

    // Layer 1: Memory cache
    this.setMemory(key, data, memoryTTL);

    // Layer 2: Redis cache
    try {
      await redisSet(key, data, { ttl: Math.floor(redisTTL / 1000) });
    } catch (error) {
      console.error("[MultiLayerCache] Redis set failed:", error);
    }

    // Layer 3: Edge cache (CDN headers in production)
    // This would be handled via HTTP cache headers
  }

  /**
   * Set in memory cache only
   */
  setMemory(key: string, data: T, ttl: number): void {
    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });

    // Auto-expire
    setTimeout(() => {
      this.memoryCache.delete(key);
    }, ttl);
  }

  /**
   * Invalidate key from all layers
   */
  async invalidate(key: string): Promise<void> {
    // Remove from memory
    this.memoryCache.delete(key);

    // Remove from Redis
    try {
      const redis = await import("@/lib/redis/client").then((m) => m.getRedisClient());
      if (redis) {
        await redis.del(key);
      }
    } catch (error) {
      console.error("[MultiLayerCache] Redis invalidate failed:", error);
    }

    // Edge cache invalidation would be via CDN purge API
  }

  /**
   * Clear all memory cache
   */
  clearMemory(): void {
    this.memoryCache.clear();
  }

  /**
   * Clean expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(key);
      }
    }
  }
}

// Cleanup expired entries every minute
if (typeof setInterval !== "undefined") {
  const cacheInstance = new MultiLayerCache<Record<string, unknown>>();
  setInterval(() => {
    cacheInstance.cleanup();
  }, 60000);
}

// Singleton instances with different TTLs
export const fastCache = new MultiLayerCache<Record<string, unknown>>(); // 20s memory, 60s Redis
export const mediumCache = new MultiLayerCache<Record<string, unknown>>(); // 20s memory, 120s Redis
export const slowCache = new MultiLayerCache<Record<string, unknown>>(); // 30s memory, 300s Redis

// Configure different TTLs
mediumCache["defaultRedisTTL"] = 120000; // 2 minutes
slowCache["defaultMemoryTTL"] = 30000; // 30 seconds
slowCache["defaultRedisTTL"] = 300000; // 5 minutes
