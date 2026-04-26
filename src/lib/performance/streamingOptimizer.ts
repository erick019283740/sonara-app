/**
 * Streaming Optimization
 * Preloads next song, caches audio metadata, avoids re-fetching URLs
 */

interface SongMetadata {
  id: string;
  title: string;
  file_url: string;
  cover_url: string | null;
  duration: number;
}

class StreamingOptimizer {
  private metadataCache: Map<string, SongMetadata> = new Map();
  private preloadCache: Map<string, HTMLAudioElement> = new Map();
  private maxCacheSize = 10;

  /**
   * Get song metadata with caching
   */
  getMetadata(songId: string): SongMetadata | null {
    return this.metadataCache.get(songId) || null;
  }

  /**
   * Cache song metadata
   */
  cacheMetadata(songId: string, metadata: SongMetadata): void {
    // Limit cache size
    if (this.metadataCache.size >= this.maxCacheSize) {
      const firstKey = this.metadataCache.keys().next().value;
      if (firstKey) {
        this.metadataCache.delete(firstKey);
      }
    }
    this.metadataCache.set(songId, metadata);
  }

  /**
   * Preload next song
   */
  preloadSong(songId: string, fileUrl: string): void {
    if (this.preloadCache.has(songId)) {
      return; // Already preloaded
    }

    const audio = new Audio();
    audio.preload = "auto";
    audio.src = fileUrl;

    // Store in cache
    if (this.preloadCache.size >= this.maxCacheSize) {
      const firstKey = this.preloadCache.keys().next().value;
      if (firstKey) {
        this.preloadCache.delete(firstKey);
      }
    }
    this.preloadCache.set(songId, audio);
  }

  /**
   * Get preloaded audio element
   */
  getPreloaded(songId: string): HTMLAudioElement | null {
    const audio = this.preloadCache.get(songId);
    if (audio) {
      // Clone to avoid reusing the same element
      return audio.cloneNode(true) as HTMLAudioElement;
    }
    return null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.metadataCache.clear();
    this.preloadCache.clear();
  }

  /**
   * Clear specific song from cache
   */
  clearSong(songId: string): void {
    this.metadataCache.delete(songId);
    this.preloadCache.delete(songId);
  }
}

// Singleton instance
let streamingOptimizer: StreamingOptimizer | null = null;

export function getStreamingOptimizer(): StreamingOptimizer {
  if (!streamingOptimizer) {
    streamingOptimizer = new StreamingOptimizer();
  }
  return streamingOptimizer;
}

export function clearStreamingCache(): void {
  if (streamingOptimizer) {
    streamingOptimizer.clearCache();
  }
}
