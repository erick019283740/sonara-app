/**
 * Feed Diversity Algorithm
 * Mix content: trending, new artists, local artists, personalized recommendations, genre variation
 * Rule: No 2 similar songs in a row
 */

interface Song {
  id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  genre: string;
  created_at: string;
  streams_count: number;
  [key: string]: unknown;
}

interface FeedConfig {
  trendingWeight: number;
  newArtistsWeight: number;
  localArtistsWeight: number;
  personalizedWeight: number;
  genreVariation: boolean;
}

const DEFAULT_CONFIG: FeedConfig = {
  trendingWeight: 0.4,
  newArtistsWeight: 0.2,
  localArtistsWeight: 0.2,
  personalizedWeight: 0.2,
  genreVariation: true,
};

class FeedDiversityEngine {
  private config: FeedConfig;
  private lastGenre: string | null = null;
  private lastArtistId: string | null = null;

  constructor(config: FeedConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Generate diverse feed
   */
  async generateDiverseFeed(
    allSongs: Song[],
    userId?: string,
    userLocation?: { country: string; city: string }
  ): Promise<Song[]> {
    const feed: Song[] = [];
    const usedIds = new Set<string>();

    // Categorize songs
    const trending = this.filterByCategory(allSongs, "trending");
    const newArtists = this.filterByCategory(allSongs, "new_artists");
    const localArtists = userLocation 
      ? this.filterByLocalArtists(allSongs, userLocation.country)
      : [];
    const personalized = userId 
      ? await this.getPersonalizedRecommendations(userId, allSongs)
      : [];

    // Calculate how many songs from each category
    const totalSongs = Math.min(50, allSongs.length);
    const trendingCount = Math.floor(totalSongs * this.config.trendingWeight);
    const newArtistsCount = Math.floor(totalSongs * this.config.newArtistsWeight);
    const localArtistsCount = Math.floor(totalSongs * this.config.localArtistsWeight);
    const personalizedCount = totalSongs - trendingCount - newArtistsCount - localArtistsCount;

    // Add songs with diversity rules
    feed.push(...this.selectWithDiversity(trending, trendingCount, usedIds));
    feed.push(...this.selectWithDiversity(newArtists, newArtistsCount, usedIds));
    feed.push(...this.selectWithDiversity(localArtists, localArtistsCount, usedIds));
    feed.push(...this.selectWithDiversity(personalized, personalizedCount, usedIds));

    // Shuffle the feed (but keep some order logic)
    return this.smartShuffle(feed);
  }

  /**
   * Filter songs by category
   */
  private filterByCategory(songs: Song[], category: string): Song[] {
    switch (category) {
      case "trending":
        return songs
          .sort((a, b) => (b.streams_count as number) - (a.streams_count as number))
          .slice(0, 50);
      case "new_artists":
        return songs
          .filter((s) => s.streams_count === 0 || (s.streams_count as number) < 100)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 50);
      default:
        return songs;
    }
  }

  /**
   * Filter by local artists
   */
  private filterByLocalArtists(songs: Song[], country: string): Song[] {
    // This would need artist location data
    // For now, return empty - would need to join with artist location
    return songs.slice(0, 20);
  }

  /**
   * Get personalized recommendations
   */
  private async getPersonalizedRecommendations(
    userId: string,
    allSongs: Song[]
  ): Promise<Song[]> {
    // This would use user's listening history, likes, follows
    // For now, return random subset
    return this.shuffleArray(allSongs).slice(0, 30);
  }

  /**
   * Select songs with diversity rules
   */
  private selectWithDiversity(
    songs: Song[],
    count: number,
    usedIds: Set<string>
  ): Song[] {
    const selected: Song[] = [];
    const available = songs.filter((s) => !usedIds.has(s.id));

    for (const song of available) {
      if (selected.length >= count) break;

      // Check diversity rules
      if (this.config.genreVariation && this.lastGenre === song.genre) {
        continue; // Skip same genre in a row
      }

      if (this.lastArtistId === song.artist_id) {
        continue; // Skip same artist in a row
      }

      selected.push(song);
      usedIds.add(song.id);
      this.lastGenre = song.genre;
      this.lastArtistId = song.artist_id;
    }

    return selected;
  }

  /**
   * Smart shuffle - maintains some order logic
   */
  private smartShuffle(songs: Song[]): Song[] {
    // Shuffle in chunks to maintain some categorization
    const chunkSize = 5;
    const shuffled: Song[] = [];

    for (let i = 0; i < songs.length; i += chunkSize) {
      const chunk = songs.slice(i, i + chunkSize);
      const shuffledChunk = this.shuffleArray(chunk);
      shuffled.push(...shuffledChunk);
    }

    return shuffled;
  }

  /**
   * Shuffle array
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Reset diversity state
   */
  resetState(): void {
    this.lastGenre = null;
    this.lastArtistId = null;
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<FeedConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
let feedDiversityEngine: FeedDiversityEngine | null = null;

export function getFeedDiversityEngine(config?: FeedConfig): FeedDiversityEngine {
  if (!feedDiversityEngine) {
    feedDiversityEngine = new FeedDiversityEngine(config);
  }
  return feedDiversityEngine;
}
