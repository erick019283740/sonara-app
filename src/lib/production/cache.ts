import { getRedisClient } from "@/lib/redis/client";

interface CacheOptions {
  ttl?: number; // Time to live in seconds
}

const DEFAULT_TTL = 30; // 30 seconds default

/**
 * Get cached value
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    console.error("[Cache] Get error:", error);
    return null;
  }
}

/**
 * Set cached value
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  options: CacheOptions = {}
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    console.warn("[Cache] Redis not available - cache set skipped");
    return;
  }

  try {
    const ttl = options.ttl ?? DEFAULT_TTL;
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch (error) {
    console.error("[Cache] Set error:", error);
  }
}

/**
 * Delete cached value
 */
export async function cacheDelete(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(key);
  } catch (error) {
    console.error("[Cache] Delete error:", error);
  }
}

/**
 * Clear all cache keys matching pattern
 */
export async function cacheClearPattern(pattern: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error("[Cache] Clear pattern error:", error);
  }
}

/**
 * Cache keys helpers
 */
export const CacheKeys = {
  artistStats: (artistId: string) => `artist:stats:${artistId}`,
  artistSongs: (artistId: string) => `artist:songs:${artistId}`,
  feed: (userId: string, page: number) => `feed:${userId}:${page}`,
  trending: () => `trending:latest`,
  songMetrics: (songId: string) => `song:metrics:${songId}`,
  userStats: (userId: string) => `user:stats:${userId}`,
};
