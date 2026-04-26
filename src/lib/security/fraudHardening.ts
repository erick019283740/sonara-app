/**
 * Fraud + Abuse Hardening
 * Bot detection, fingerprint, session anomaly, skip spam, ad fraud
 */

import type { Redis } from "ioredis";
import { getRedisClient } from "@/lib/redis/client";

interface FraudScore {
  userId: string;
  score: number; // 0-100, lower is more suspicious
  factors: string[];
  timestamp: number;
}

interface DeviceFingerprint {
  userAgent: string;
  screenSize: string;
  timezone: string;
  language: string;
  plugins: string;
  canvasHash: string;
}

const SKIP_SPAM_THRESHOLD = 10; // skips per minute
const STREAM_BOT_THRESHOLD = 60; // streams per minute
const AD_CLICK_THRESHOLD = 20; // ad clicks per hour
const SESSION_ANOMALY_THRESHOLD = 5; // location changes per session

class FraudHardening {
  private scores = new Map<string, FraudScore>();

  /**
   * Calculate comprehensive fraud score for user
   */
  async calculateFraudScore(userId: string, fingerprint?: DeviceFingerprint): Promise<FraudScore> {
    const factors: string[] = [];
    let score = 100; // Start at 100 (trusted)

    const redis = getRedisClient();
    if (!redis) {
      return { userId, score: 100, factors: ["no_redis"], timestamp: Date.now() };
    }

    // 1. Bot stream simulation detection
    const streamRate = await this.getEventRate(redis, `stream:${userId}`, 60);
    if (streamRate > STREAM_BOT_THRESHOLD) {
      score -= 40;
      factors.push("bot_streaming");
    } else if (streamRate > 30) {
      score -= 15;
      factors.push("high_stream_rate");
    }

    // 2. Skip spam detection
    const skipRate = await this.getEventRate(redis, `skip:${userId}`, 60);
    if (skipRate > SKIP_SPAM_THRESHOLD) {
      score -= 25;
      factors.push("skip_spam");
    }

    // 3. Ad click fraud
    const adClickRate = await this.getEventRate(redis, `ad_click:${userId}`, 3600);
    if (adClickRate > AD_CLICK_THRESHOLD) {
      score -= 30;
      factors.push("ad_click_fraud");
    }

    // 4. Session anomaly (location changes)
    const locationChanges = parseInt((await redis.get(`loc_changes:${userId}`)) || "0", 10);
    if (locationChanges > SESSION_ANOMALY_THRESHOLD) {
      score -= 20;
      factors.push("session_anomaly");
    }

    // 5. Device fingerprint inconsistency
    if (fingerprint) {
      const storedFp = await redis.get(`fp:${userId}`);
      if (storedFp) {
        const currentFp = JSON.stringify(fingerprint);
        if (storedFp !== currentFp) {
          // Fingerprint changed - possible account sharing
          score -= 10;
          factors.push("fingerprint_mismatch");
        }
      } else {
        // Store first fingerprint
        await redis.setex(`fp:${userId}`, 86400 * 30, JSON.stringify(fingerprint as unknown as Record<string, unknown>));
      }
    }

    // 6. Replay attack pattern
    const replayCount = parseInt((await redis.get(`replay:${userId}`)) || "0", 10);
    if (replayCount > 5) {
      score -= 35;
      factors.push("replay_attack");
    }

    const finalScore = Math.max(0, score);

    const result: FraudScore = {
      userId,
      score: finalScore,
      factors,
      timestamp: Date.now(),
    };

    this.scores.set(userId, result);

    // Store in Redis
    await redis.setex(`fraud_score:${userId}`, 3600, JSON.stringify(result));

    // Auto-block if score is too low
    if (finalScore < 20) {
      await redis.sadd("blocked_users", userId);
      await redis.setex(`block_reason:${userId}`, 86400, factors.join(","));
    }

    return result;
  }

  /**
   * Get event rate from Redis sorted set
   */
  private async getEventRate(redis: Redis, key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Remove old entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count entries in window
    const count = await redis.zcard(key);

    return count || 0;
  }

  /**
   * Track event for fraud detection
   */
  async trackEvent(userId: string, eventType: "stream" | "skip" | "ad_click" | "replay" | "location_change"): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    const now = Date.now();
    const key = `${eventType}:${userId}`;

    await redis.zadd(key, now, now.toString());

    // Set expiry
    await redis.expire(key, 3600);

    // Special handling for location changes
    if (eventType === "location_change") {
      await redis.incr(`loc_changes:${userId}`);
      await redis.expire(`loc_changes:${userId}`, 86400);
    }

    // Special handling for replays
    if (eventType === "replay") {
      await redis.incr(`replay:${userId}`);
      await redis.expire(`replay:${userId}`, 86400);
    }
  }

  /**
   * Check if user is blocked
   */
  async isBlocked(userId: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    const blocked = await redis.sismember("blocked_users", userId);
    return blocked === 1;
  }

  /**
   * Get fraud score
   */
  getFraudScore(userId: string): FraudScore | null {
    return this.scores.get(userId) || null;
  }

  /**
   * Clear fraud data (for testing)
   */
  clearUserData(userId: string): void {
    this.scores.delete(userId);
  }

  /**
   * Get all suspicious users
   */
  getSuspiciousUsers(threshold: number = 50): FraudScore[] {
    return Array.from(this.scores.values()).filter((s) => s.score < threshold);
  }
}

let fraudHardening: FraudHardening | null = null;

export function getFraudHardening(): FraudHardening {
  if (!fraudHardening) {
    fraudHardening = new FraudHardening();
  }
  return fraudHardening;
}
