/**
 * Feed Speed Engine
 * Virtualized list, infinite scroll, prefetch next page
 */

import { prefetchData } from "./zeroLatencyUI";

interface FeedItem {
  id: string;
  [key: string]: unknown;
}

interface FeedState {
  items: FeedItem[];
  loading: boolean;
  hasMore: boolean;
  page: number;
}

class FeedSpeedEngine {
  private feedCache = new Map<string, FeedState>();
  private prefetchCache = new Map<string, FeedItem[]>();

  /**
   * Get feed state
   */
  getFeedState(feedId: string): FeedState | null {
    return this.feedCache.get(feedId) || null;
  }

  /**
   * Set feed state
   */
  setFeedState(feedId: string, state: FeedState): void {
    this.feedCache.set(feedId, state);
  }

  /**
   * Load feed page
   */
  async loadFeedPage(
    feedId: string,
    fetchFn: (page: number) => Promise<FeedItem[]>,
    page: number = 0
  ): Promise<FeedItem[]> {
    const state = this.feedCache.get(feedId) || {
      items: [],
      loading: false,
      hasMore: true,
      page: 0,
    };

    if (state.loading) {
      return state.items;
    }

    state.loading = true;
    this.feedCache.set(feedId, state);

    try {
      const newItems = await fetchFn(page);
      
      // Append items (avoid duplicates)
      const existingIds = new Set(state.items.map((i) => i.id));
      const uniqueNewItems = newItems.filter((i) => !existingIds.has(i.id));
      
      state.items = [...state.items, ...uniqueNewItems];
      state.page = page;
      state.hasMore = newItems.length > 0;
      state.loading = false;
      
      this.feedCache.set(feedId, state);

      // Prefetch next page
      if (state.hasMore) {
        this.prefetchNextPage(feedId, fetchFn, page + 1);
      }

      return state.items;
    } catch (error) {
      state.loading = false;
      this.feedCache.set(feedId, state);
      throw error;
    }
  }

  /**
   * Prefetch next page in background
   */
  private prefetchNextPage(
    feedId: string,
    fetchFn: (page: number) => Promise<FeedItem[]>,
    page: number
  ): void {
    const cacheKey = `${feedId}:page:${page}`;
    
    if (this.prefetchCache.has(cacheKey)) {
      return; // Already prefetched
    }

    prefetchData(async () => {
      const items = await fetchFn(page);
      this.prefetchCache.set(cacheKey, items);
      
      // Clear after 5 minutes
      setTimeout(() => {
        this.prefetchCache.delete(cacheKey);
      }, 300000);
    });
  }

  /**
   * Get prefetched page
   */
  getPrefetchedPage(feedId: string, page: number): FeedItem[] | null {
    const cacheKey = `${feedId}:page:${page}`;
    return this.prefetchCache.get(cacheKey) || null;
  }

  /**
   * Reset feed
   */
  resetFeed(feedId: string): void {
    this.feedCache.delete(feedId);
    // Clear all prefetch cache for this feed
    for (const key of this.prefetchCache.keys()) {
      if (key.startsWith(feedId)) {
        this.prefetchCache.delete(key);
      }
    }
  }

  /**
   * Virtualized list calculation
   * Returns only items that should be rendered
   */
  getVisibleItems(
    allItems: FeedItem[],
    scrollTop: number,
    itemHeight: number,
    viewportHeight: number,
    overscan: number = 3
  ): { startIndex: number; endIndex: number; visibleItems: FeedItem[] } {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      allItems.length,
      Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
    );

    return {
      startIndex,
      endIndex,
      visibleItems: allItems.slice(startIndex, endIndex),
    };
  }
}

// Singleton instance
let feedSpeedEngine: FeedSpeedEngine | null = null;

export function getFeedSpeedEngine(): FeedSpeedEngine {
  if (!feedSpeedEngine) {
    feedSpeedEngine = new FeedSpeedEngine();
  }
  return feedSpeedEngine;
}
