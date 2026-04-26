import { getNextAd, trackImpression, trackCompletion, trackClick, type Ad } from "@/lib/services/adService";
import { cacheGet, cacheSet } from "@/lib/production/cache";

interface AdSchedule {
  audioAdAfterSongs: number; // Play audio ad after X songs
  bannerAdInterval: number; // Show banner ad every X minutes
}

const DEFAULT_SCHEDULE: AdSchedule = {
  audioAdAfterSongs: 3, // Audio ad after every 3 songs
  bannerAdInterval: 5, // Banner ad every 5 minutes
};

/**
 * Ad Scheduler
 * Determines when to show ads based on user activity
 */
class AdScheduler {
  private songCount = 0;
  private lastBannerAdTime = 0;
  private currentAd: Ad | null = null;
  private currentImpressionId: string | null = null;

  /**
   * Check if audio ad should play
   */
  shouldPlayAudioAd(): boolean {
    this.songCount++;
    
    if (this.songCount >= DEFAULT_SCHEDULE.audioAdAfterSongs) {
      this.songCount = 0;
      return true;
    }
    
    return false;
  }

  /**
   * Check if banner ad should show
   */
  shouldShowBannerAd(): boolean {
    const now = Date.now();
    const timeSinceLastAd = now - this.lastBannerAdTime;
    const intervalMs = DEFAULT_SCHEDULE.bannerAdInterval * 60 * 1000;

    if (timeSinceLastAd >= intervalMs) {
      this.lastBannerAdTime = now;
      return true;
    }

    return false;
  }

  /**
   * Get next audio ad
   */
  async getNextAudioAd(userId: string): Promise<Ad | null> {
    const cacheKey = `next_audio_ad:${userId}`;
    
    // Check cache first
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return cached as Ad;
    }

    const result = await getNextAd(userId, "audio");
    
    if (result.ok && result.ad) {
      const ad = result.ad as Ad;
      this.currentAd = ad;
      await cacheSet(cacheKey, ad, { ttl: 300 }); // Cache for 5 minutes
      return ad;
    }

    return null;
  }

  /**
   * Get next banner ad
   */
  async getNextBannerAd(userId: string): Promise<Ad | null> {
    const result = await getNextAd(userId, "banner");
    
    if (result.ok && result.ad) {
      return result.ad as Ad;
    }

    return null;
  }

  /**
   * Track ad impression
   */
  async trackImpression(userId: string | null, sessionId: string): Promise<void> {
    if (!this.currentAd) return;

    this.currentImpressionId = await trackImpression(
      this.currentAd.id,
      userId,
      sessionId
    );
  }

  /**
   * Track ad click
   */
  async trackClick(userId: string | null): Promise<void> {
    if (!this.currentAd || !this.currentImpressionId) return;

    await trackClick(this.currentAd.id, this.currentImpressionId, userId);
  }

  /**
   * Track ad completion
   */
  async trackCompletion(durationSeconds: number): Promise<void> {
    if (!this.currentImpressionId) return;

    await trackCompletion(this.currentImpressionId, durationSeconds);
    
    // Clear current ad
    this.currentAd = null;
    this.currentImpressionId = null;
  }

  /**
   * Skip ad
   */
  skipAd(): void {
    this.currentAd = null;
    this.currentImpressionId = null;
  }

  /**
   * Reset song counter
   */
  resetSongCounter(): void {
    this.songCount = 0;
  }
}

// Singleton instance
let adScheduler: AdScheduler | null = null;

export function getAdScheduler(): AdScheduler {
  if (!adScheduler) {
    adScheduler = new AdScheduler();
  }
  return adScheduler;
}
