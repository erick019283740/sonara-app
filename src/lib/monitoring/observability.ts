/**
 * Observability Layer
 * API latency, feed render time, player start time, ad load time, error aggregation
 */

interface LatencyMetric {
  endpoint: string;
  latencyMs: number;
  timestamp: number;
  status: "success" | "error";
  errorMessage?: string;
}

interface PlayerMetric {
  songId: string;
  startTimeMs: number;
  bufferTimeMs: number;
  firstFrameTimeMs: number;
  timestamp: number;
}

interface FeedMetric {
  renderTimeMs: number;
  itemCount: number;
  scrollJank: number; // frame drops
  timestamp: number;
}

interface AdMetric {
  adId: string;
  loadTimeMs: number;
  renderTimeMs: number;
  clickTimestamp?: number;
  timestamp: number;
}

interface ErrorMetric {
  type: "api" | "player" | "feed" | "ad" | "network" | "unknown";
  message: string;
  stack?: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

class ObservabilityLayer {
  private apiLatencies: LatencyMetric[] = [];
  private playerMetrics: PlayerMetric[] = [];
  private feedMetrics: FeedMetric[] = [];
  private adMetrics: AdMetric[] = [];
  private errorMap = new Map<string, ErrorMetric>();
  private maxMetricsPerType = 1000;

  /**
   * Track API latency
   */
  trackApiLatency(endpoint: string, latencyMs: number, success: boolean, errorMessage?: string): void {
    const metric: LatencyMetric = {
      endpoint,
      latencyMs,
      timestamp: Date.now(),
      status: success ? "success" : "error",
      errorMessage,
    };

    this.apiLatencies.push(metric);
    this.trimMetrics(this.apiLatencies);

    // Alert if latency is high
    if (latencyMs > 300) {
      console.warn(`[Observability] High API latency: ${endpoint} took ${latencyMs}ms`);
    }
  }

  /**
   * Track player start time
   */
  trackPlayerStart(
    songId: string,
    startTimeMs: number,
    bufferTimeMs: number,
    firstFrameTimeMs: number
  ): void {
    const metric: PlayerMetric = {
      songId,
      startTimeMs,
      bufferTimeMs,
      firstFrameTimeMs,
      timestamp: Date.now(),
    };

    this.playerMetrics.push(metric);
    this.trimMetrics(this.playerMetrics);

    if (startTimeMs > 300) {
      console.warn(`[Observability] Slow player start: ${startTimeMs}ms for song ${songId}`);
    }
  }

  /**
   * Track feed render performance
   */
  trackFeedRender(renderTimeMs: number, itemCount: number, scrollJank: number = 0): void {
    const metric: FeedMetric = {
      renderTimeMs,
      itemCount,
      scrollJank,
      timestamp: Date.now(),
    };

    this.feedMetrics.push(metric);
    this.trimMetrics(this.feedMetrics);

    if (renderTimeMs > 16) { // 60fps = 16ms per frame
      console.warn(`[Observability] Feed render slow: ${renderTimeMs}ms for ${itemCount} items`);
    }

    if (scrollJank > 0) {
      console.warn(`[Observability] Feed scroll jank: ${scrollJank} frame drops`);
    }
  }

  /**
   * Track ad load performance
   */
  trackAdLoad(adId: string, loadTimeMs: number, renderTimeMs: number): void {
    const metric: AdMetric = {
      adId,
      loadTimeMs,
      renderTimeMs,
      timestamp: Date.now(),
    };

    this.adMetrics.push(metric);
    this.trimMetrics(this.adMetrics);

    if (loadTimeMs > 200) {
      console.warn(`[Observability] Slow ad load: ${loadTimeMs}ms for ad ${adId}`);
    }
  }

  /**
   * Track ad click
   */
  trackAdClick(adId: string): void {
    const metric = this.adMetrics.find((m) => m.adId === adId);
    if (metric) {
      metric.clickTimestamp = Date.now();
    }
  }

  /**
   * Aggregate error
   */
  trackError(type: ErrorMetric["type"], message: string, stack?: string): void {
    const key = `${type}:${message}`;
    const existing = this.errorMap.get(key);

    const now = Date.now();

    if (existing) {
      existing.count++;
      existing.lastSeen = now;
      if (stack && !existing.stack) {
        existing.stack = stack;
      }
    } else {
      this.errorMap.set(key, {
        type,
        message,
        stack,
        count: 1,
        firstSeen: now,
        lastSeen: now,
      });
    }

    // Log first occurrence
    if (!existing) {
      console.error(`[Observability] Error: [${type}] ${message}`);
    }
  }

  /**
   * Get API latency report
   */
  getApiLatencyReport(): {
    avgLatency: number;
    p95Latency: number;
    p99Latency: number;
    errorRate: number;
    totalRequests: number;
  } {
    const latencies = this.apiLatencies.map((m) => m.latencyMs).sort((a, b) => a - b);
    const total = latencies.length;

    if (total === 0) {
      return { avgLatency: 0, p95Latency: 0, p99Latency: 0, errorRate: 0, totalRequests: 0 };
    }

    const avg = latencies.reduce((a, b) => a + b, 0) / total;
    const p95 = latencies[Math.floor(total * 0.95)] || latencies[total - 1];
    const p99 = latencies[Math.floor(total * 0.99)] || latencies[total - 1];
    const errors = this.apiLatencies.filter((m) => m.status === "error").length;

    return {
      avgLatency: Math.round(avg),
      p95Latency: p95,
      p99Latency: p99,
      errorRate: Math.round((errors / total) * 100),
      totalRequests: total,
    };
  }

  /**
   * Get player performance report
   */
  getPlayerReport(): {
    avgStartTime: number;
    avgBufferTime: number;
    slowStarts: number;
    totalPlays: number;
  } {
    const metrics = this.playerMetrics;
    const total = metrics.length;

    if (total === 0) {
      return { avgStartTime: 0, avgBufferTime: 0, slowStarts: 0, totalPlays: 0 };
    }

    const avgStart = metrics.reduce((a, m) => a + m.startTimeMs, 0) / total;
    const avgBuffer = metrics.reduce((a, m) => a + m.bufferTimeMs, 0) / total;
    const slowStarts = metrics.filter((m) => m.startTimeMs > 300).length;

    return {
      avgStartTime: Math.round(avgStart),
      avgBufferTime: Math.round(avgBuffer),
      slowStarts,
      totalPlays: total,
    };
  }

  /**
   * Get feed performance report
   */
  getFeedReport(): {
    avgRenderTime: number;
    avgJank: number;
    slowRenders: number;
    totalRenders: number;
  } {
    const metrics = this.feedMetrics;
    const total = metrics.length;

    if (total === 0) {
      return { avgRenderTime: 0, avgJank: 0, slowRenders: 0, totalRenders: 0 };
    }

    const avgRender = metrics.reduce((a, m) => a + m.renderTimeMs, 0) / total;
    const avgJank = metrics.reduce((a, m) => a + m.scrollJank, 0) / total;
    const slowRenders = metrics.filter((m) => m.renderTimeMs > 16).length;

    return {
      avgRenderTime: Math.round(avgRender),
      avgJank: Math.round(avgJank * 10) / 10,
      slowRenders,
      totalRenders: total,
    };
  }

  /**
   * Get error aggregation report
   */
  getErrorReport(): ErrorMetric[] {
    return Array.from(this.errorMap.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Get full dashboard data
   */
  getDashboardData(): {
    api: {
      avgLatency: number;
      p95Latency: number;
      p99Latency: number;
      errorRate: number;
      totalRequests: number;
    };
    player: {
      avgStartTime: number;
      avgBufferTime: number;
      slowStarts: number;
      totalPlays: number;
    };
    feed: {
      avgRenderTime: number;
      avgJank: number;
      slowRenders: number;
      totalRenders: number;
    };
    errors: ErrorMetric[];
    timestamp: number;
  } {
    return {
      api: this.getApiLatencyReport(),
      player: this.getPlayerReport(),
      feed: this.getFeedReport(),
      errors: this.getErrorReport().slice(0, 10),
      timestamp: Date.now(),
    };
  }

  /**
   * Trim metrics array to max size
   */
  private trimMetrics<T>(metrics: T[]): void {
    if (metrics.length > this.maxMetricsPerType) {
      metrics.splice(0, metrics.length - this.maxMetricsPerType);
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.apiLatencies = [];
    this.playerMetrics = [];
    this.feedMetrics = [];
    this.adMetrics = [];
    this.errorMap.clear();
  }
}

let observability: ObservabilityLayer | null = null;

export function getObservability(): ObservabilityLayer {
  if (!observability) {
    observability = new ObservabilityLayer();
  }
  return observability;
}
