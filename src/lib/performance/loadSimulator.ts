/**
 * Load Simulation Layer
 * Simulates 50-200 concurrent users to detect bottlenecks
 */

import { getRedisClient } from "@/lib/redis/client";

interface LoadTestResult {
  timestamp: number;
  concurrentUsers: number;
  apiLatency: number;
  redisLatency: number;
  dbLatency: number;
  playerDesync: boolean;
  bottleneck: string | null;
}

class LoadSimulator {
  private results: LoadTestResult[] = [];
  private isRunning = false;
  private abortController: AbortController | null = null;

  /**
   * Start load simulation
   */
  async startSimulation(concurrentUsers: number = 100): Promise<void> {
    if (this.isRunning) {
      console.warn("[LoadSimulator] Simulation already running");
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    console.log(`[LoadSimulator] Starting simulation with ${concurrentUsers} users`);

    const workers = Array.from({ length: concurrentUsers }, (_, i) =>
      this.simulateUser(i, signal)
    );

    await Promise.allSettled(workers);
    this.isRunning = false;
  }

  /**
   * Stop simulation
   */
  stopSimulation(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
  }

  /**
   * Simulate single user
   */
  private async simulateUser(userId: number, signal: AbortSignal): Promise<void> {
    const actions = [
      () => this.simulateFeedScroll(userId),
      () => this.simulateSongStream(userId),
      () => this.simulateSkipAction(userId),
      () => this.simulateAdRequest(userId),
    ];

    for (let i = 0; i < 20; i++) {
      if (signal.aborted) return;

      const action = actions[Math.floor(Math.random() * actions.length)];
      await action();
      await this.delay(100 + Math.random() * 500);
    }
  }

  /**
   * Simulate feed scroll
   */
  private async simulateFeedScroll(userId: number): Promise<void> {
    const start = performance.now();
    try {
      const res = await fetch("/api/feed?page=0&limit=30", {
        signal: this.abortController?.signal,
      });
      const latency = performance.now() - start;
      this.recordResult(userId, latency, "api");
    } catch {
      this.recordResult(userId, -1, "api", "feed_timeout");
    }
  }

  /**
   * Simulate song stream
   */
  private async simulateSongStream(userId: number): Promise<void> {
    const start = performance.now();
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: `sim-user-${userId}`,
          songId: `song-${Math.floor(Math.random() * 100)}`,
          durationPlayedSeconds: 30 + Math.floor(Math.random() * 120),
        }),
        signal: this.abortController?.signal,
      });
      const latency = performance.now() - start;
      this.recordResult(userId, latency, "db");
    } catch {
      this.recordResult(userId, -1, "db", "stream_timeout");
    }
  }

  /**
   * Simulate skip action
   */
  private async simulateSkipAction(userId: number): Promise<void> {
    // Skip is client-side, but triggers API for analytics
    await this.delay(50);
  }

  /**
   * Simulate ad request
   */
  private async simulateAdRequest(userId: number): Promise<void> {
    const start = performance.now();
    try {
      const res = await fetch("/api/ads?userId=sim-user-${userId}", {
        signal: this.abortController?.signal,
      });
      const latency = performance.now() - start;
      this.recordResult(userId, latency, "api");
    } catch {
      this.recordResult(userId, -1, "api", "ad_timeout");
    }
  }

  /**
   * Record test result
   */
  private async recordResult(
    userId: number,
    latency: number,
    type: "api" | "redis" | "db",
    bottleneck: string | null = null
  ): Promise<void> {
    const redis = getRedisClient();
    const redisLatency = redis ? await this.checkRedisLatency() : -1;

    const result: LoadTestResult = {
      timestamp: Date.now(),
      concurrentUsers: this.isRunning ? 100 : 0,
      apiLatency: type === "api" ? latency : -1,
      redisLatency: type === "redis" ? latency : redisLatency,
      dbLatency: type === "db" ? latency : -1,
      playerDesync: false,
      bottleneck,
    };

    this.results.push(result);

    // Store in Redis for dashboard
    if (redis) {
      await redis.lpush("load_test_results", JSON.stringify(result));
      await redis.ltrim("load_test_results", 0, 999);
    }
  }

  /**
   * Check Redis latency
   */
  private async checkRedisLatency(): Promise<number> {
    const redis = getRedisClient();
    if (!redis) return -1;

    const start = Date.now();
    await redis.ping();
    return Date.now() - start;
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): {
    totalRequests: number;
    avgApiLatency: number;
    avgRedisLatency: number;
    avgDbLatency: number;
    bottlenecks: string[];
    isHealthy: boolean;
  } {
    const validResults = this.results.filter((r) => r.apiLatency > 0);
    const apiLatencies = validResults.map((r) => r.apiLatency);
    const redisLatencies = this.results.filter((r) => r.redisLatency > 0).map((r) => r.redisLatency);
    const dbLatencies = this.results.filter((r) => r.dbLatency > 0).map((r) => r.dbLatency);

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    const bottlenecks = this.results
      .filter((r) => r.bottleneck)
      .map((r) => r.bottleneck!)
      .filter((v, i, a) => a.indexOf(v) === i);

    const avgApi = avg(apiLatencies);
    const avgRedis = avg(redisLatencies);
    const avgDb = avg(dbLatencies);

    return {
      totalRequests: this.results.length,
      avgApiLatency: avgApi,
      avgRedisLatency: avgRedis,
      avgDbLatency: avgDb,
      bottlenecks,
      isHealthy: avgApi < 300 && avgRedis < 50 && avgDb < 200,
    };
  }

  /**
   * Detect bottlenecks in real-time
   */
  detectBottlenecks(): string[] {
    const recent = this.results.slice(-50);
    const issues: string[] = [];

    const avgApi = recent.filter((r) => r.apiLatency > 0).reduce((a, r) => a + r.apiLatency, 0) / recent.length;
    if (avgApi > 300) issues.push("API_LATENCY_SPIKE");

    const avgRedis = recent.filter((r) => r.redisLatency > 0).reduce((a, r) => a + r.redisLatency, 0) / recent.length;
    if (avgRedis > 50) issues.push("REDIS_BOTTLENECK");

    const avgDb = recent.filter((r) => r.dbLatency > 0).reduce((a, r) => a + r.dbLatency, 0) / recent.length;
    if (avgDb > 200) issues.push("DB_CONNECTION_SATURATION");

    return issues;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let loadSimulator: LoadSimulator | null = null;

export function getLoadSimulator(): LoadSimulator {
  if (!loadSimulator) {
    loadSimulator = new LoadSimulator();
  }
  return loadSimulator;
}
