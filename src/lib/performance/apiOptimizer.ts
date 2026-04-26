/**
 * API Performance Hardening
 * Unified cache, batch writes, request deduplication, request coalescing
 */

import { getRedisClient } from "@/lib/redis/client";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
  key: string;
}

class ApiOptimizer {
  private memoryCache = new Map<string, CacheEntry<unknown>>();
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private batchQueue: Array<{ key: string; data: unknown; timestamp: number }> = [];
  private batchInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 25;
  private readonly BATCH_INTERVAL_MS = 5000;
  private readonly REQUEST_TIMEOUT_MS = 10000;
  private readonly DEDUP_WINDOW_MS = 500;

  constructor() {
    this.startBatchProcessing();
  }

  /**
   * Unified get with cache layers (memory -> redis)
   */
  async get<T>(key: string, fetchFn: () => Promise<T>, ttlMs: number = 30000): Promise<T> {
    // Layer 1: Memory cache
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && Date.now() - memoryEntry.timestamp < memoryEntry.ttl) {
      return memoryEntry.data as T;
    }

    // Layer 2: Redis cache
    const redis = getRedisClient();
    if (redis) {
      const redisData = await redis.get(`api_cache:${key}`);
      if (redisData) {
        try {
          const parsed = JSON.parse(redisData) as T;
          this.memoryCache.set(key, { data: parsed, timestamp: Date.now(), ttl: ttlMs });
          return parsed;
        } catch {
          // Invalid cache data
        }
      }
    }

    // Layer 3: Request coalescing (deduplication)
    const coalesced = await this.coalesceRequest(key, fetchFn);

    // Cache result
    this.memoryCache.set(key, { data: coalesced, timestamp: Date.now(), ttl: ttlMs });

    if (redis) {
      await redis.setex(`api_cache:${key}`, Math.ceil(ttlMs / 1000), JSON.stringify(coalesced));
    }

    return coalesced;
  }

  /**
   * Request coalescing - deduplicate in-flight requests
   */
  private async coalesceRequest<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    // Check if request is already in flight
    const pending = this.pendingRequests.get(key);
    if (pending && Date.now() - pending.timestamp < this.DEDUP_WINDOW_MS) {
      return pending.promise as Promise<T>;
    }

    // Create new request
    const promise = fetchFn().finally(() => {
      // Clean up after completion
      setTimeout(() => {
        this.pendingRequests.delete(key);
      }, this.DEDUP_WINDOW_MS);
    });

    this.pendingRequests.set(key, {
      promise: promise as Promise<unknown>,
      timestamp: Date.now(),
      key,
    });

    return promise;
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(key: string): Promise<void> {
    this.memoryCache.delete(key);

    const redis = getRedisClient();
    if (redis) {
      await redis.del(`api_cache:${key}`);
    }
  }

  /**
   * Batch write operation
   */
  queueBatchWrite(key: string, data: unknown): void {
    this.batchQueue.push({
      key,
      data,
      timestamp: Date.now(),
    });

    if (this.batchQueue.length >= this.BATCH_SIZE) {
      void this.flushBatch();
    }
  }

  /**
   * Start batch processing
   */
  private startBatchProcessing(): void {
    this.batchInterval = setInterval(() => {
      if (this.batchQueue.length > 0) {
        void this.flushBatch();
      }
    }, this.BATCH_INTERVAL_MS);
  }

  /**
   * Flush batch queue to database
   */
  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const batch = this.batchQueue.splice(0, this.BATCH_SIZE);

    try {
      // Group by table/key pattern
      const grouped = this.groupBatchByTable(batch);

      for (const [table, items] of grouped.entries()) {
        await this.writeBatchToDatabase(table, items);
      }
    } catch (error) {
      console.error("[ApiOptimizer] Batch write failed:", error);
      // Re-queue failed items
      this.batchQueue.unshift(...batch);
    }
  }

  /**
   * Group batch items by table
   */
  private groupBatchByTable(
    batch: Array<{ key: string; data: unknown; timestamp: number }>
  ): Map<string, unknown[]> {
    const grouped = new Map<string, unknown[]>();

    for (const item of batch) {
      const table = item.key.split(":")[0] || "default";
      const existing = grouped.get(table) || [];
      existing.push(item.data);
      grouped.set(table, existing);
    }

    return grouped;
  }

  /**
   * Write batch to database
   */
  private async writeBatchToDatabase(table: string, items: unknown[]): Promise<void> {
    // Placeholder for actual DB batch write
    // Would use Supabase bulk insert
    console.log(`[ApiOptimizer] Writing ${items.length} items to ${table}`);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    memoryEntries: number;
    pendingRequests: number;
    batchQueueSize: number;
  } {
    return {
      memoryEntries: this.memoryCache.size,
      pendingRequests: this.pendingRequests.size,
      batchQueueSize: this.batchQueue.length,
    };
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.memoryCache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Stop batch processing
   */
  stop(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
  }
}

let apiOptimizer: ApiOptimizer | null = null;

export function getApiOptimizer(): ApiOptimizer {
  if (!apiOptimizer) {
    apiOptimizer = new ApiOptimizer();
  }
  return apiOptimizer;
}
