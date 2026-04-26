/**
 * Dynamic Playlist Engine
 * Auto-shuffle intelligence, mood-based transitions, genre balancing
 */

interface Song {
  id: string;
  title: string;
  artist_id: string;
  genre: string;
  mood?: string;
  energy?: number; // 0-1 scale
  tempo?: number; // BPM
  duration: number;
}

interface PlaylistConfig {
  shuffle: boolean;
  moodBasedTransitions: boolean;
  genreBalancing: boolean;
  maxSameGenreInRow: number;
}

const DEFAULT_CONFIG: PlaylistConfig = {
  shuffle: true,
  moodBasedTransitions: true,
  genreBalancing: true,
  maxSameGenreInRow: 2,
};

class DynamicPlaylistEngine {
  private config: PlaylistConfig;
  private playlist: Song[] = [];
  private currentIndex = 0;
  private genreHistory: string[] = [];
  private moodHistory: string[] = [];

  constructor(config: PlaylistConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Load playlist
   */
  loadPlaylist(songs: Song[]): void {
    this.playlist = this.config.shuffle ? this.intelligentShuffle(songs) : songs;
    this.currentIndex = 0;
    this.genreHistory = [];
    this.moodHistory = [];
  }

  /**
   * Intelligent shuffle with genre/mood awareness
   */
  private intelligentShuffle(songs: Song[]): Song[] {
    if (!this.config.genreBalancing && !this.config.moodBasedTransitions) {
      return this.simpleShuffle(songs);
    }

    const shuffled: Song[] = [];
    const remaining = [...songs];
    let lastGenre: string | null = null;
    let lastMood: string | null = null;
    let sameGenreCount = 0;

    while (remaining.length > 0) {
      // Find suitable next song
      const suitableIndex = remaining.findIndex((song, index) => {
        // Genre balancing
        if (this.config.genreBalancing && lastGenre) {
          if (song.genre === lastGenre && sameGenreCount >= this.config.maxSameGenreInRow) {
            return false;
          }
        }

        // Mood transitions
        if (this.config.moodBasedTransitions && lastMood && song.mood) {
          if (!this.isMoodTransitionAllowed(lastMood, song.mood)) {
            return false;
          }
        }

        return true;
      });

      // If no suitable song found, pick random
      const index = suitableIndex >= 0 ? suitableIndex : Math.floor(Math.random() * remaining.length);
      const song = remaining.splice(index, 1)[0];

      shuffled.push(song);

      // Update history
      if (song.genre === lastGenre) {
        sameGenreCount++;
      } else {
        sameGenreCount = 0;
        lastGenre = song.genre;
      }

      if (song.mood) {
        lastMood = song.mood;
      }
    }

    return shuffled;
  }

  /**
   * Simple shuffle
   */
  private simpleShuffle(songs: Song[]): Song[] {
    const shuffled = [...songs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Check if mood transition is allowed
   */
  private isMoodTransitionAllowed(from: string, to: string): boolean {
    const moodTransitions: Record<string, string[]> = {
      energetic: ["energetic", "upbeat", "happy"],
      happy: ["happy", "upbeat", "energetic"],
      sad: ["sad", "melancholic", "calm"],
      calm: ["calm", "peaceful", "sad"],
      upbeat: ["upbeat", "energetic", "happy"],
      melancholic: ["melancholic", "sad", "calm"],
      peaceful: ["peaceful", "calm", "happy"],
    };

    const allowed = moodTransitions[from] || [];
    return allowed.includes(to);
  }

  /**
   * Get current song
   */
  getCurrentSong(): Song | null {
    if (this.currentIndex >= this.playlist.length) {
      return null;
    }
    return this.playlist[this.currentIndex];
  }

  /**
   * Get next song
   */
  getNextSong(): Song | null {
    if (this.currentIndex + 1 >= this.playlist.length) {
      // Loop back to start
      this.currentIndex = 0;
    } else {
      this.currentIndex++;
    }
    return this.getCurrentSong();
  }

  /**
   * Get previous song
   */
  getPreviousSong(): Song | null {
    if (this.currentIndex - 1 < 0) {
      // Go to end
      this.currentIndex = this.playlist.length - 1;
    } else {
      this.currentIndex--;
    }
    return this.getCurrentSong();
  }

  /**
   * Jump to song
   */
  jumpToSong(songId: string): boolean {
    const index = this.playlist.findIndex((s) => s.id === songId);
    if (index >= 0) {
      this.currentIndex = index;
      return true;
    }
    return false;
  }

  /**
   * Add song to playlist
   */
  addSong(song: Song, position?: number): void {
    if (position !== undefined && position >= 0 && position <= this.playlist.length) {
      this.playlist.splice(position, 0, song);
      if (position <= this.currentIndex) {
        this.currentIndex++;
      }
    } else {
      this.playlist.push(song);
    }
  }

  /**
   * Remove song from playlist
   */
  removeSong(songId: string): boolean {
    const index = this.playlist.findIndex((s) => s.id === songId);
    if (index >= 0) {
      this.playlist.splice(index, 1);
      if (index < this.currentIndex) {
        this.currentIndex--;
      } else if (index === this.currentIndex && this.currentIndex >= this.playlist.length) {
        this.currentIndex = Math.max(0, this.currentIndex - 1);
      }
      return true;
    }
    return false;
  }

  /**
   * Get playlist length
   */
  getPlaylistLength(): number {
    return this.playlist.length;
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<PlaylistConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Re-shuffle if shuffle setting changed
    if (config.shuffle !== undefined) {
      this.playlist = this.config.shuffle ? this.intelligentShuffle(this.playlist) : this.simpleShuffle(this.playlist);
    }
  }
}

// Singleton instance
let dynamicPlaylistEngine: DynamicPlaylistEngine | null = null;

export function getDynamicPlaylistEngine(config?: PlaylistConfig): DynamicPlaylistEngine {
  if (!dynamicPlaylistEngine) {
    dynamicPlaylistEngine = new DynamicPlaylistEngine(config);
  }
  return dynamicPlaylistEngine;
}
