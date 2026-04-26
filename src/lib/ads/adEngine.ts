/**
 * Real Ads Engine
 * Delivery API, weighted rotation, frequency cap, impression tracking
 */

import { getRedisClient } from "@/lib/redis/client";
import { createAdminClient } from "@/lib/supabase/admin";

interface Ad {
  id: string;
  type: "banner" | "audio" | "video";
  title: string;
  content_url: string;
  target_url: string;
  cpm_rate: number;
  weight: number;
  impressions: number;
  max_daily_impressions: number;
}

interface AdDeliveryResult {
  ad: Ad | null;
  reason: "delivered" | "frequency_cap" | "no_ads" | "premium_user" | "error";
  nextAllowedAt: number;
}

interface AdTrackingEvent {
  adId: string;
  userId: string;
  eventType: "impression" | "click" | "completion";
  timestamp: number;
  sessionId: string;
}

const FREQUENCY_CAP_MS = 3 * 60 * 1000; // 3 minutes
const MAX_DAILY_IMPRESSIONS = 50;

class AdEngine {
  private impressionQueue: AdTrackingEvent[] = [];
  private batchInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start batch processing
    this.startBatchProcessing();
  }

  /**
   * Get next ad for user
   */
  async getNextAd(
    userId: string,
    adType: "banner" | "audio" = "banner",
    isPremium: boolean = false
  ): Promise<AdDeliveryResult> {
    // Premium users don't see ads
    if (isPremium) {
      return {
        ad: null,
        reason: "premium_user",
        nextAllowedAt: Date.now(),
      };
    }

    const redis = getRedisClient();
    if (!redis) {
      return { ad: null, reason: "error", nextAllowedAt: Date.now() };
    }

    // Check frequency cap
    const lastAdKey = `ad:last:${userId}:${adType}`;
    const lastAdTime = await redis.get(lastAdKey);
    const now = Date.now();

    if (lastAdTime) {
      const elapsed = now - parseInt(lastAdTime, 10);
      if (elapsed < FREQUENCY_CAP_MS) {
        return {
          ad: null,
          reason: "frequency_cap",
          nextAllowedAt: parseInt(lastAdTime, 10) + FREQUENCY_CAP_MS,
        };
      }
    }

    // Check daily impression limit
    const dailyKey = `ad:daily:${userId}:${new Date().toISOString().split("T")[0]}`;
    const dailyCount = parseInt((await redis.get(dailyKey)) || "0", 10);
    if (dailyCount >= MAX_DAILY_IMPRESSIONS) {
      return {
        ad: null,
        reason: "frequency_cap",
        nextAllowedAt: now + 24 * 60 * 60 * 1000,
      };
    }

    // Get weighted ad
    const ad = await this.selectWeightedAd(adType);
    if (!ad) {
      return { ad: null, reason: "no_ads", nextAllowedAt: now };
    }

    // Mark as shown
    await redis.set(lastAdKey, now.toString(), "PX", FREQUENCY_CAP_MS * 2);
    await redis.incr(dailyKey);
    await redis.expire(dailyKey, 86400);

    // Track impression
    this.queueImpression({
      adId: ad.id,
      userId,
      eventType: "impression",
      timestamp: now,
      sessionId: "",
    });

    return {
      ad,
      reason: "delivered",
      nextAllowedAt: now + FREQUENCY_CAP_MS,
    };
  }

  /**
   * Select ad by weighted rotation
   */
  private async selectWeightedAd(adType: "banner" | "audio"): Promise<Ad | null> {
    const admin = createAdminClient();

    const { data: ads } = await admin
      .from("ads")
      .select("*")
      .eq("type", adType)
      .eq("status", "active")
      .order("impressions", { ascending: true })
      .limit(10);

    if (!ads || ads.length === 0) return null;

    // Weighted random selection (lower impressions = higher weight)
    const totalWeight = ads.reduce((sum, ad) => sum + (ad.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const ad of ads) {
      random -= ad.weight || 1;
      if (random <= 0) {
        return ad as Ad;
      }
    }

    return ads[0] as Ad;
  }

  /**
   * Track ad event
   */
  trackEvent(event: Omit<AdTrackingEvent, "timestamp">): void {
    this.queueImpression({
      ...event,
      timestamp: Date.now(),
    });
  }

  /**
   * Queue impression for batch processing
   */
  private queueImpression(event: AdTrackingEvent): void {
    this.impressionQueue.push(event);

    if (this.impressionQueue.length >= 25) {
      void this.flushImpressions();
    }
  }

  /**
   * Start batch processing
   */
  private startBatchProcessing(): void {
    this.batchInterval = setInterval(() => {
      if (this.impressionQueue.length > 0) {
        void this.flushImpressions();
      }
    }, 5000);
  }

  /**
   * Flush impressions to database
   */
  private async flushImpressions(): Promise<void> {
    if (this.impressionQueue.length === 0) return;

    const batch = this.impressionQueue.splice(0, 25);
    const admin = createAdminClient();

    try {
      await admin.from("ad_impressions").insert(
        batch.map((e) => ({
          ad_id: e.adId,
          user_id: e.userId,
          event_type: e.eventType,
          created_at: new Date(e.timestamp).toISOString(),
          session_id: e.sessionId,
        }))
      );
    } catch (error) {
      console.error("[AdEngine] Failed to flush impressions:", error);
      // Re-queue failed items
      this.impressionQueue.unshift(...batch);
    }
  }

  /**
   * Get user's ad history
   */
  async getUserAdHistory(userId: string): Promise<{
    dailyImpressions: number;
    lastAdTime: number;
    nextAllowedAt: number;
  }> {
    const redis = getRedisClient();
    if (!redis) {
      return { dailyImpressions: 0, lastAdTime: 0, nextAllowedAt: 0 };
    }

    const dailyKey = `ad:daily:${userId}:${new Date().toISOString().split("T")[0]}`;
    const dailyCount = parseInt((await redis.get(dailyKey)) || "0", 10);

    const lastBanner = parseInt((await redis.get(`ad:last:${userId}:banner`)) || "0", 10);
    const lastAudio = parseInt((await redis.get(`ad:last:${userId}:audio`)) || "0", 10);
    const lastAdTime = Math.max(lastBanner, lastAudio);

    return {
      dailyImpressions: dailyCount,
      lastAdTime,
      nextAllowedAt: lastAdTime + FREQUENCY_CAP_MS,
    };
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

let adEngine: AdEngine | null = null;

export function getAdEngine(): AdEngine {
  if (!adEngine) {
    adEngine = new AdEngine();
  }
  return adEngine;
}
