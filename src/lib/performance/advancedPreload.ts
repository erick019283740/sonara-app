/**
 * Advanced Preload System
 * Preload next 2 songs, buffer audio, decode before play
 */

import { getStreamingOptimizer } from "./streamingOptimizer";

interface PreloadQueue {
  songId: string;
  fileUrl: string;
  priority: number;
}

class AdvancedPreloader {
  private preloadQueue: PreloadQueue[] = [];
  private maxQueueSize = 3; // Preload next 2 songs + current
  private isProcessing = false;
  private streamingOptimizer = getStreamingOptimizer();

  /**
   * Add song to preload queue
   */
  enqueuePreload(songId: string, fileUrl: string, priority: number = 0): void {
    // Check if already in queue
    if (this.preloadQueue.some((item) => item.songId === songId)) {
      return;
    }

    // Add to queue
    this.preloadQueue.push({ songId, fileUrl, priority });

    // Sort by priority (higher priority first)
    this.preloadQueue.sort((a, b) => b.priority - a.priority);

    // Limit queue size
    if (this.preloadQueue.length > this.maxQueueSize) {
      this.preloadQueue = this.preloadQueue.slice(0, this.maxQueueSize);
    }

    // Start processing if not already
    if (!this.isProcessing) {
      void this.processQueue();
    }
  }

  /**
   * Process preload queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.preloadQueue.length > 0) {
      const item = this.preloadQueue.shift();
      if (!item) break;

      try {
        await this.preloadSong(item.songId, item.fileUrl);
      } catch (error) {
        console.error("[AdvancedPreloader] Failed to preload:", error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Preload song with full processing
   */
  private async preloadSong(songId: string, fileUrl: string): Promise<void> {
    // Use streaming optimizer for basic preload
    this.streamingOptimizer.preloadSong(songId, fileUrl);

    // Additional: Pre-decode audio (browser handles this with preload="auto")
    // Additional: Buffer first few seconds
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = fileUrl;

    // Wait for canplay event to ensure buffering
    return new Promise((resolve, reject) => {
      audio.addEventListener("canplay", () => {
        resolve();
      }, { once: true });

      audio.addEventListener("error", () => {
        reject(new Error("Failed to preload audio"));
      }, { once: true });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error("Preload timeout"));
      }, 10000);
    });
  }

  /**
   * Get preloaded song
   */
  getPreloaded(songId: string): HTMLAudioElement | null {
    return this.streamingOptimizer.getPreloaded(songId);
  }

  /**
   * Clear queue
   */
  clearQueue(): void {
    this.preloadQueue = [];
  }

  /**
   * Remove song from queue
   */
  removeFromQueue(songId: string): void {
    this.preloadQueue = this.preloadQueue.filter((item) => item.songId !== songId);
  }
}

// Singleton instance
let advancedPreloader: AdvancedPreloader | null = null;

export function getAdvancedPreloader(): AdvancedPreloader {
  if (!advancedPreloader) {
    advancedPreloader = new AdvancedPreloader();
  }
  return advancedPreloader;
}

/**
 * Preload next songs in playlist
 */
export function preloadNextSongs(
  currentSongId: string,
  songs: Array<{ id: string; file_url: string }>,
  count: number = 2
): void {
  const preloader = getAdvancedPreloader();

  // Find current song index
  const currentIndex = songs.findIndex((s) => s.id === currentSongId);
  if (currentIndex === -1) return;

  // Preload next N songs
  for (let i = 1; i <= count; i++) {
    const nextIndex = currentIndex + i;
    if (nextIndex < songs.length) {
      const nextSong = songs[nextIndex];
      preloader.enqueuePreload(nextSong.id, nextSong.file_url, count - i);
    }
  }
}
