/**
 * Fraud Protection Engine
 * Detects replay attacks, bot streaming, fake donation loops
 */

import { getRedisClient } from "@/lib/redis/client";

export interface FraudDetection {
  userId: string;
  eventType: "stream" | "donation" | "ad_impression";
  riskScore: number;
  reasons: string[];
  timestamp: number;
}

class FraudProtectionEngine {
  private userTrustScores = new Map<string, number>();
  private suspiciousUsers = new Set<string>();
  private detectionHistory = new Map<string, FraudDetection[]>();

  /**
   * Check for replay attack
   */
  async detectReplayAttack(
    userId: string,
    eventId: string,
    windowMs: number = 10000
  ): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = `replay_check:${userId}:${eventId}`;
    const exists = await redis.exists(key);

    if (exists) {
      return true; // Replay attack detected
    }

    // Mark as seen
    await redis.set(key, "1", "PX", windowMs);
    return false;
  }

  /**
   * Check for bot streaming (unrealistic patterns)
   */
  async detectBotStreaming(userId: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = `stream_rate:${userId}`;
    const now = Date.now();

    // Get stream count in last minute
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, now - 60000);
    pipeline.zcard(key);
    pipeline.zadd(key, now, now.toString());
    pipeline.expire(key, 120);
    const results = await pipeline.exec();

    if (!results) return false;

    const streamCount = (results[1][1] as number) || 0;

    // More than 60 streams in a minute = bot
    if (streamCount > 60) {
      await this.flagUser(userId, "bot_streaming", streamCount);
      return true;
    }

    return false;
  }

  /**
   * Check for fake donation loops
   */
  async detectFakeDonationLoops(userId: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = `donation_rate:${userId}`;
    const now = Date.now();

    // Get donation count in last hour
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, now - 3600000);
    pipeline.zcard(key);
    pipeline.zadd(key, now, now.toString());
    pipeline.expire(key, 7200);
    const results = await pipeline.exec();

    if (!results) return false;

    const donationCount = (results[1][1] as number) || 0;

    // More than 10 donations in an hour = suspicious
    if (donationCount > 10) {
      await this.flagUser(userId, "donation_loop", donationCount);
      return true;
    }

    return false;
  }

  /**
   * Flag suspicious user
   */
  async flagUser(
    userId: string,
    reason: string,
    severity: number
  ): Promise<void> {
    // Add to suspicious set
    this.suspiciousUsers.add(userId);

    // Reduce trust score
    const currentScore = this.userTrustScores.get(userId) ?? 100;
    const newScore = Math.max(0, currentScore - severity);
    this.userTrustScores.set(userId, newScore);

    // Log detection
    const detection: FraudDetection = {
      userId,
      eventType: "stream",
      riskScore: severity,
      reasons: [reason],
      timestamp: Date.now(),
    };

    const history = this.detectionHistory.get(userId) || [];
    history.push(detection);
    this.detectionHistory.set(userId, history);

    // Block in real-time if trust score too low
    if (newScore < 30) {
      console.warn(`[FraudEngine] BLOCKING user ${userId} - trust score: ${newScore}`);
      await this.blockUser(userId, reason);
    }
  }

  /**
   * Block user
   */
  async blockUser(userId: string, reason: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    // Add to blocked set
    await redis.sadd("blocked_users", userId);
    await redis.set(`block_reason:${userId}`, reason, "EX", 86400); // 24 hours

    console.error(`[FraudEngine] User ${userId} blocked: ${reason}`);
  }

  /**
   * Check if user is blocked
   */
  async isUserBlocked(userId: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    const blocked = await redis.sismember("blocked_users", userId);
    return blocked === 1;
  }

  /**
   * Get user trust score
   */
  getTrustScore(userId: string): number {
    return this.userTrustScores.get(userId) ?? 100;
  }

  /**
   * Increase user trust score
   */
  increaseTrustScore(userId: string, amount: number): void {
    const currentScore = this.userTrustScores.get(userId) ?? 100;
    const newScore = Math.min(100, currentScore + amount);
    this.userTrustScores.set(userId, newScore);
  }

  /**
   * Get fraud detection history
   */
  getDetectionHistory(userId: string): FraudDetection[] {
    return this.detectionHistory.get(userId) || [];
  }
}

// Singleton instance
let fraudProtectionEngine: FraudProtectionEngine | null = null;

export function getFraudProtectionEngine(): FraudProtectionEngine {
  if (!fraudProtectionEngine) {
    fraudProtectionEngine = new FraudProtectionEngine();
  }
  return fraudProtectionEngine;
}
