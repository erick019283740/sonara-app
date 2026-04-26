/**
 * Data Integrity Rules
 * No duplicate stream counting, idempotency keys, append-only ledger
 */

import { getRedisClient } from "@/lib/redis/client";

class DataIntegrityManager {
  private processedIds = new Set<string>();

  /**
   * Check if stream already processed (duplicate prevention)
   */
  async isStreamProcessed(streamId: string): Promise<boolean> {
    // Check memory cache first
    if (this.processedIds.has(streamId)) {
      return true;
    }

    // Check Redis for cross-server duplicate prevention
    const redis = getRedisClient();
    if (redis) {
      const exists = await redis.exists(`processed_stream:${streamId}`);
      if (exists) {
        this.processedIds.add(streamId);
        return true;
      }
    }

    return false;
  }

  /**
   * Mark stream as processed
   */
  async markStreamProcessed(streamId: string): Promise<void> {
    // Add to memory cache
    this.processedIds.add(streamId);

    // Add to Redis with TTL (24 hours)
    const redis = getRedisClient();
    if (redis) {
      await redis.set(`processed_stream:${streamId}`, "1", "EX", 86400);
    }
  }

  /**
   * Generate idempotency key for operations
   */
  generateIdempotencyKey(operation: string, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((k) => `${k}:${params[k]}`)
      .join("|");
    return `idempotent:${operation}:${sortedParams}`;
  }

  /**
   * Check if operation already executed (idempotency)
   */
  async isOperationExecuted(idempotencyKey: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    const exists = await redis.exists(`idempotent:${idempotencyKey}`);
    return exists === 1;
  }

  /**
   * Mark operation as executed with result
   */
  async markOperationExecuted(
    idempotencyKey: string,
    result: unknown,
    ttl: number = 3600
  ): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    await redis.set(
      `idempotent:${idempotencyKey}`,
      JSON.stringify(result),
      "EX",
      ttl
    );
  }

  /**
   * Get cached operation result
   */
  async getOperationResult(idempotencyKey: string): Promise<unknown | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    const result = await redis.get(`idempotent:${idempotencyKey}`);
    if (!result) return null;

    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * Ensure ledger is append-only (no overwrite protection)
   */
  async appendToLedger(
    ledgerType: string,
    entry: Record<string, unknown>
  ): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = `ledger:${ledgerType}`;
    const entryId = entry.id as string;

    // Check if entry already exists
    const exists = await redis.hexists(key, entryId);
    if (exists) {
      console.warn(`[DataIntegrity] Entry ${entryId} already exists in ledger ${ledgerType}`);
      return false;
    }

    // Append to ledger
    await redis.hset(key, entryId, JSON.stringify(entry));
    return true;
  }

  /**
   * Get ledger entry
   */
  async getLedgerEntry(
    ledgerType: string,
    entryId: string
  ): Promise<Record<string, unknown> | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    const entry = await redis.hget(`ledger:${ledgerType}`, entryId);
    if (!entry) return null;

    try {
      return JSON.parse(entry) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Clear memory cache (for testing)
   */
  clearMemoryCache(): void {
    this.processedIds.clear();
  }
}

// Singleton instance
let dataIntegrityManager: DataIntegrityManager | null = null;

export function getDataIntegrityManager(): DataIntegrityManager {
  if (!dataIntegrityManager) {
    dataIntegrityManager = new DataIntegrityManager();
  }
  return dataIntegrityManager;
}
