import { cacheSet, cacheGet, cacheDelete, cacheClearPattern, CacheKeys } from "@/lib/production/cache";

/**
 * Edge Cache Strategy
 * Caches frequently accessed data with appropriate TTLs
 */

export const EdgeCacheTTL = {
  FEED: 60, // 1 minute
  TRENDING: 120, // 2 minutes
  ARTIST_PROFILE: 300, // 5 minutes
  ARTIST_SONGS: 180, // 3 minutes
  SONG_METRICS: 60, // 1 minute
  USER_STATS: 300, // 5 minutes
};

/**
 * Cache feed response
 */
export async function cacheFeed(userId: string, page: number, data: unknown): Promise<void> {
  await cacheSet(CacheKeys.feed(userId, page), data, { ttl: EdgeCacheTTL.FEED });
}

/**
 * Get cached feed
 */
export async function getCachedFeed(userId: string, page: number): Promise<unknown | null> {
  return await cacheGet(CacheKeys.feed(userId, page));
}

/**
 * Cache trending songs
 */
export async function cacheTrending(data: unknown): Promise<void> {
  await cacheSet(CacheKeys.trending(), data, { ttl: EdgeCacheTTL.TRENDING });
}

/**
 * Get cached trending
 */
export async function getCachedTrending(): Promise<unknown | null> {
  return await cacheGet(CacheKeys.trending());
}

/**
 * Cache artist profile
 */
export async function cacheArtistProfile(artistId: string, data: unknown): Promise<void> {
  await cacheSet(CacheKeys.artistStats(artistId), data, { ttl: EdgeCacheTTL.ARTIST_PROFILE });
}

/**
 * Get cached artist profile
 */
export async function getCachedArtistProfile(artistId: string): Promise<unknown | null> {
  return await cacheGet(CacheKeys.artistStats(artistId));
}

/**
 * Cache artist songs
 */
export async function cacheArtistSongs(artistId: string, data: unknown): Promise<void> {
  await cacheSet(CacheKeys.artistSongs(artistId), data, { ttl: EdgeCacheTTL.ARTIST_SONGS });
}

/**
 * Get cached artist songs
 */
export async function getCachedArtistSongs(artistId: string): Promise<unknown | null> {
  return await cacheGet(CacheKeys.artistSongs(artistId));
}

/**
 * Invalidate artist cache
 */
export async function invalidateArtistCache(artistId: string): Promise<void> {
  await cacheDelete(CacheKeys.artistStats(artistId));
  await cacheDelete(CacheKeys.artistSongs(artistId));
}

/**
 * Invalidate all feed caches
 */
export async function invalidateAllFeeds(): Promise<void> {
  await cacheClearPattern("feed:*");
}

/**
 * Invalidate trending cache
 */
export async function invalidateTrending(): Promise<void> {
  await cacheDelete(CacheKeys.trending());
}
