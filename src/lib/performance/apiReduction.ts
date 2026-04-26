import { getRedisClient } from "@/lib/redis/client";

interface CachedRequest {
  data: unknown;
  timestamp: number;
}

const REQUEST_CACHE = new Map<string, CachedRequest>();
const DEFAULT_TTL = 30000; // 30 seconds

/**
 * Deduplicate in-flight requests
 * If the same request is already pending, return the existing promise
 */
const pendingRequests = new Map<string, Promise<unknown>>();

export async function deduplicateRequest<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  // Check if request is already pending
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key) as Promise<T>;
  }

  // Create new request
  const promise = fn().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

/**
 * Cache API response in memory
 */
export function cacheResponse(key: string, data: unknown, ttl: number = DEFAULT_TTL): void {
  REQUEST_CACHE.set(key, {
    data,
    timestamp: Date.now(),
  });

  // Auto-expire after TTL
  setTimeout(() => {
    REQUEST_CACHE.delete(key);
  }, ttl);
}

/**
 * Get cached response
 */
export function getCachedResponse<T>(key: string): T | null {
  const cached = REQUEST_CACHE.get(key);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > DEFAULT_TTL) {
    REQUEST_CACHE.delete(key);
    return null;
  }

  return cached.data as T;
}

/**
 * Cache API response in Redis
 */
export async function cacheResponseRedis(
  key: string,
  data: unknown,
  ttl: number = 60
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(key, JSON.stringify(data), "EX", ttl);
  } catch (error) {
    console.error("[API Reduction] Redis cache error:", error);
  }
}

/**
 * Get cached response from Redis
 */
export async function getCachedResponseRedis<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    console.error("[API Reduction] Redis get error:", error);
    return null;
  }
}

/**
 * Combined cache strategy (memory + Redis)
 */
export async function getOrFetch<T>(
  key: string,
  fn: () => Promise<T>,
  options: {
    memoryTTL?: number;
    redisTTL?: number;
  } = {}
): Promise<T> {
  // Check memory cache first
  const memoryCached = getCachedResponse<T>(key);
  if (memoryCached) {
    return memoryCached;
  }

  // Check Redis cache
  const redisCached = await getCachedResponseRedis<T>(key);
  if (redisCached) {
    cacheResponse(key, redisCached, options.memoryTTL);
    return redisCached;
  }

  // Deduplicate in-flight requests
  return deduplicateRequest(key, async () => {
    const data = await fn();

    // Cache in both memory and Redis
    cacheResponse(key, data, options.memoryTTL);
    await cacheResponseRedis(key, data, options.redisTTL);

    return data;
  });
}
