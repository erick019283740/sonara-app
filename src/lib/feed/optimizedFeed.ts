/**
 * Optimized Feed Engine
 * Cursor-based pagination, prefetch, debounce, engagement ranking
 */

import { getRedisClient } from "@/lib/redis/client";

interface FeedCursor {
  lastScore: number;
  lastId: string;
  direction: "next" | "prev";
}

interface FeedItem {
  id: string;
  score: number;
  engagementScore: number;
  data: Record<string, unknown>;
}

interface FeedCache {
  items: FeedItem[];
  cursor: FeedCursor | null;
  timestamp: number;
  userId: string;
}

const CACHE_TTL_MS = 30000; // 30 seconds
const PREFETCH_PAGES = 2;
const DEBOUNCE_MS = 150;

class OptimizedFeedEngine {
  private feedCache = new Map<string, FeedCache>();
  private prefetchQueue = new Map<string, Promise<FeedItem[]>>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Fetch feed page with cursor-based pagination
   */
  async fetchFeedPage(
    userId: string,
    cursor: FeedCursor | null,
    limit: number = 20,
    options: {
      genre?: string;
      trending?: boolean;
    } = {}
  ): Promise<{
    items: FeedItem[];
    nextCursor: FeedCursor | null;
    fromCache: boolean;
  }> {
    const cacheKey = `feed:${userId}:${cursor?.lastId || "first"}`;

    // Check memory cache
    const cached = this.feedCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return {
        items: cached.items,
        nextCursor: cached.cursor,
        fromCache: true,
      };
    }

    // Check Redis cache
    const redis = getRedisClient();
    if (redis) {
      const redisCached = await redis.get(`feed_cache:${cacheKey}`);
      if (redisCached) {
        try {
          const parsed = JSON.parse(redisCached) as FeedCache;
          this.feedCache.set(cacheKey, parsed);
          return {
            items: parsed.items,
            nextCursor: parsed.cursor,
            fromCache: true,
          };
        } catch {
          // Invalid cache, continue
        }
      }
    }

    // Fetch from API
    const items = await this.fetchFromAPI(userId, cursor, limit, options);

    // Calculate engagement-based ranking
    const rankedItems = this.rankByEngagement(items);

    // Generate next cursor
    const nextCursor = items.length >= limit
      ? {
          lastScore: rankedItems[rankedItems.length - 1]?.score || 0,
          lastId: rankedItems[rankedItems.length - 1]?.id || "",
          direction: "next" as const,
        }
      : null;

    // Cache result
    const cacheEntry: FeedCache = {
      items: rankedItems,
      cursor: nextCursor,
      timestamp: Date.now(),
      userId,
    };

    this.feedCache.set(cacheKey, cacheEntry);

    if (redis) {
      await redis.setex(`feed_cache:${cacheKey}`, 60, JSON.stringify(cacheEntry));
    }

    // Prefetch next pages
    if (nextCursor) {
      this.prefetchNextPages(userId, nextCursor, limit, options);
    }

    return {
      items: rankedItems,
      nextCursor,
      fromCache: false,
    };
  }

  /**
   * Debounced scroll handler
   */
  debouncedScroll(
    userId: string,
    callback: () => void
  ): void {
    const key = `scroll:${userId}`;

    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      callback();
      this.debounceTimers.delete(key);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Prefetch next pages in background
   */
  private async prefetchNextPages(
    userId: string,
    cursor: FeedCursor,
    limit: number,
    options: Record<string, unknown>
  ): Promise<void> {
    let currentCursor = cursor;

    for (let i = 0; i < PREFETCH_PAGES; i++) {
      const key = `prefetch:${userId}:${currentCursor.lastId}`;

      if (this.prefetchQueue.has(key)) continue;

      const promise = this.fetchFromAPI(userId, currentCursor, limit, options)
        .then((items) => {
          this.prefetchQueue.delete(key);
          return items;
        })
        .catch(() => {
          this.prefetchQueue.delete(key);
          return [];
        });

      this.prefetchQueue.set(key, promise);

      // Don't await, let it run in background
      promise.then((items) => {
        if (items.length >= limit) {
          currentCursor = {
            lastScore: items[items.length - 1].score || 0,
            lastId: items[items.length - 1].id,
            direction: "next",
          };
        }
      });
    }
  }

  /**
   * Rank items by engagement
   */
  private rankByEngagement(items: FeedItem[]): FeedItem[] {
    return items
      .map((item) => ({
        ...item,
        engagementScore: this.calculateEngagementScore(item),
      }))
      .sort((a, b) => b.engagementScore - a.engagementScore);
  }

  /**
   * Calculate engagement score
   */
  private calculateEngagementScore(item: FeedItem): number {
    const data = item.data;
    const likes = (data.likes_count as number) || 0;
    const streams = (data.stream_count as number) || 0;
    const completions = (data.completion_rate as number) || 0;
    const skips = (data.skip_rate as number) || 0;

    // Weighted engagement score
    return (
      likes * 2 + streams * 1 + completions * 3 - skips * 2
    );
  }

  /**
   * Fetch from API (placeholder)
   */
  private async fetchFromAPI(
    _userId: string,
    _cursor: FeedCursor | null,
    _limit: number,
    _options: Record<string, unknown>
  ): Promise<FeedItem[]> {
    // In production, this calls the actual feed API
    // For now, return empty - integration point
    return [];
  }

  /**
   * Clear cache for user
   */
  clearUserCache(userId: string): void {
    for (const key of this.feedCache.keys()) {
      if (key.startsWith(`feed:${userId}:`)) {
        this.feedCache.delete(key);
      }
    }
  }

  /**
   * Get cache stats
   */
  getCacheStats(): {
    memoryEntries: number;
    prefetchPending: number;
    debounceActive: number;
  } {
    return {
      memoryEntries: this.feedCache.size,
      prefetchPending: this.prefetchQueue.size,
      debounceActive: this.debounceTimers.size,
    };
  }
}

let optimizedFeedEngine: OptimizedFeedEngine | null = null;

export function getOptimizedFeedEngine(): OptimizedFeedEngine {
  if (!optimizedFeedEngine) {
    optimizedFeedEngine = new OptimizedFeedEngine();
  }
  return optimizedFeedEngine;
}
