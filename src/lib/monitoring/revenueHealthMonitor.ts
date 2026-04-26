/**
 * Revenue Health Monitor
 * Real-time metrics for streams, revenue, fraud, batch performance
 * Detects problems before revenue is affected
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

export interface RevenueHealthMetrics {
  timestamp: string;
  streamsPerMinute: number;
  revenuePerMinute: number;
  suspiciousRate: number;
  batchDuration: number;
  failedBatches: number;
  unprocessedStreams: number;
  integrityStatus: {
    intact: boolean;
    orphanedStreams: number;
    orphanedRevenue: number;
    revenueMatch: boolean;
  };
  alerts: HealthAlert[];
}

export interface HealthAlert {
  level: "info" | "warning" | "critical";
  metric: string;
  message: string;
  value: number;
  threshold: number;
}

// Thresholds for alerts
const ALERT_THRESHOLDS = {
  streamsPerMinuteLow: 0,       // Critical: no streams
  streamsPerMinuteHigh: 500,    // Warning: possible bot activity
  suspiciousRateHigh: 10,       // Warning: >10% suspicious
  suspiciousRateCritical: 25,   // Critical: >25% suspicious
  batchDurationHigh: 5000,      // Warning: batch takes >5s
  batchDurationCritical: 15000, // Critical: batch takes >15s
  unprocessedHigh: 1000,       // Warning: >1000 unprocessed
  unprocessedCritical: 5000,    // Critical: >5000 unprocessed
  failedBatchesHigh: 3,         // Warning: >3 failed batches
  revenuePerMinuteLow: 0,       // Info: no revenue
};

interface MetricSnapshot {
  timestamp: number;
  streamCount: number;
  revenueTotal: number;
  suspiciousCount: number;
}

// In-memory metric tracking (resets on deploy)
const metricHistory: MetricSnapshot[] = [];
const MAX_HISTORY = 60; // Keep last 60 snapshots (1 minute each)
let failedBatchCount = 0;
let lastBatchDuration = 0;

/**
 * Record a batch result for monitoring
 */
export function recordBatchMetrics(durationMs: number, success: boolean): void {
  lastBatchDuration = durationMs;
  if (!success) {
    failedBatchCount++;
  }
}

/**
 * Collect current health metrics
 */
export async function collectRevenueHealthMetrics(): Promise<RevenueHealthMetrics> {
  const now = Date.now();
  const alerts: HealthAlert[] = [];

  // 1. Streams per minute (from last hour of streams)
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const oneMinuteAgo = new Date(now - 60 * 1000).toISOString();

  const { count: streamsLastMinute } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .gte("created_at", oneMinuteAgo);

  const streamsPerMinute = streamsLastMinute || 0;

  // 2. Revenue per minute (from revenue_events)
  const { data: recentRevenue } = await supabase
    .from("revenue_events")
    .select("amount_artist")
    .gte("created_at", oneMinuteAgo);

  const revenuePerMinute = (recentRevenue || []).reduce(
    (sum, r) => sum + (parseFloat(r.amount_artist) || 0),
    0
  );

  // 3. Suspicious rate (last hour)
  const { count: totalStreamsHour } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .gte("created_at", oneHourAgo);

  const { count: suspiciousStreamsHour } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("is_suspicious", true)
    .gte("created_at", oneHourAgo);

  const suspiciousRate = totalStreamsHour
    ? ((suspiciousStreamsHour || 0) / totalStreamsHour) * 100
    : 0;

  // 4. Unprocessed streams
  const { count: unprocessedStreams } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("is_valid", true)
    .eq("is_suspicious", false)
    .eq("revenue_counted", false);

  // 5. Integrity check
  const { data: integrityData, error: integrityError } = await supabase.rpc(
    "verify_revenue_integrity"
  );

  const integrityStatus = integrityError
    ? { intact: false, orphanedStreams: -1, orphanedRevenue: -1, revenueMatch: false }
    : {
        intact: (integrityData as Record<string, unknown>).intact as boolean,
        orphanedStreams: (integrityData as Record<string, unknown>).orphaned_streams as number,
        orphanedRevenue: (integrityData as Record<string, unknown>).orphaned_revenue as number,
        revenueMatch: (integrityData as Record<string, unknown>).revenue_match as boolean,
      };

  // 6. Generate alerts
  if (streamsPerMinute === ALERT_THRESHOLDS.streamsPerMinuteLow) {
    alerts.push({
      level: "critical",
      metric: "streams_per_minute",
      message: "No streams in the last minute — possible system outage",
      value: streamsPerMinute,
      threshold: ALERT_THRESHOLDS.streamsPerMinuteLow,
    });
  }

  if (streamsPerMinute > ALERT_THRESHOLDS.streamsPerMinuteHigh) {
    alerts.push({
      level: "warning",
      metric: "streams_per_minute",
      message: "Unusually high stream rate — possible bot activity",
      value: streamsPerMinute,
      threshold: ALERT_THRESHOLDS.streamsPerMinuteHigh,
    });
  }

  if (suspiciousRate > ALERT_THRESHOLDS.suspiciousRateCritical) {
    alerts.push({
      level: "critical",
      metric: "suspicious_rate",
      message: "Critical fraud rate detected — investigate immediately",
      value: suspiciousRate,
      threshold: ALERT_THRESHOLDS.suspiciousRateCritical,
    });
  } else if (suspiciousRate > ALERT_THRESHOLDS.suspiciousRateHigh) {
    alerts.push({
      level: "warning",
      metric: "suspicious_rate",
      message: "Elevated suspicious stream rate",
      value: suspiciousRate,
      threshold: ALERT_THRESHOLDS.suspiciousRateHigh,
    });
  }

  if (lastBatchDuration > ALERT_THRESHOLDS.batchDurationCritical) {
    alerts.push({
      level: "critical",
      metric: "batch_duration",
      message: "Batch processing critically slow — revenue may be delayed",
      value: lastBatchDuration,
      threshold: ALERT_THRESHOLDS.batchDurationCritical,
    });
  } else if (lastBatchDuration > ALERT_THRESHOLDS.batchDurationHigh) {
    alerts.push({
      level: "warning",
      metric: "batch_duration",
      message: "Batch processing slower than expected",
      value: lastBatchDuration,
      threshold: ALERT_THRESHOLDS.batchDurationHigh,
    });
  }

  if ((unprocessedStreams || 0) > ALERT_THRESHOLDS.unprocessedCritical) {
    alerts.push({
      level: "critical",
      metric: "unprocessed_streams",
      message: "Too many unprocessed streams — batch processing may be failing",
      value: unprocessedStreams || 0,
      threshold: ALERT_THRESHOLDS.unprocessedCritical,
    });
  } else if ((unprocessedStreams || 0) > ALERT_THRESHOLDS.unprocessedHigh) {
    alerts.push({
      level: "warning",
      metric: "unprocessed_streams",
      message: "Unprocessed streams accumulating — consider increasing batch frequency",
      value: unprocessedStreams || 0,
      threshold: ALERT_THRESHOLDS.unprocessedHigh,
    });
  }

  if (failedBatchCount > ALERT_THRESHOLDS.failedBatchesHigh) {
    alerts.push({
      level: "warning",
      metric: "failed_batches",
      message: "Multiple batch failures detected — check logs",
      value: failedBatchCount,
      threshold: ALERT_THRESHOLDS.failedBatchesHigh,
    });
  }

  if (!integrityStatus.intact) {
    alerts.push({
      level: "critical",
      metric: "revenue_integrity",
      message: "Revenue integrity check failed — orphaned streams or revenue detected",
      value: integrityStatus.orphanedStreams + integrityStatus.orphanedRevenue,
      threshold: 0,
    });
  }

  if (!integrityStatus.revenueMatch) {
    alerts.push({
      level: "warning",
      metric: "revenue_match",
      message: "Revenue events don't match artist stats — possible sync issue",
      value: 0,
      threshold: 0,
    });
  }

  // Store snapshot
  metricHistory.push({
    timestamp: now,
    streamCount: streamsPerMinute,
    revenueTotal: revenuePerMinute,
    suspiciousCount: suspiciousStreamsHour || 0,
  });

  // Trim history
  while (metricHistory.length > MAX_HISTORY) {
    metricHistory.shift();
  }

  return {
    timestamp: new Date(now).toISOString(),
    streamsPerMinute,
    revenuePerMinute: Math.round(revenuePerMinute * 10000) / 10000,
    suspiciousRate: Math.round(suspiciousRate * 100) / 100,
    batchDuration: lastBatchDuration,
    failedBatches: failedBatchCount,
    unprocessedStreams: unprocessedStreams || 0,
    integrityStatus,
    alerts,
  };
}

/**
 * Get metric history for dashboard charts
 */
export function getMetricHistory(): MetricSnapshot[] {
  return [...metricHistory];
}

/**
 * Reset failed batch counter (after investigation)
 */
export function resetFailedBatchCount(): void {
  failedBatchCount = 0;
}

/**
 * Quick health check for /api/health
 */
export async function quickRevenueHealthCheck(): Promise<{
  healthy: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Check unprocessed streams
  const { count } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("is_valid", true)
    .eq("is_suspicious", false)
    .eq("revenue_counted", false);

  if ((count || 0) > 5000) {
    issues.push(`${count} unprocessed streams — batch may be failing`);
  }

  // Quick integrity spot check
  const { data, error } = await supabase.rpc("verify_revenue_integrity");
  if (!error && data) {
    const result = data as Record<string, unknown>;
    if (!result.intact) {
      issues.push("Revenue integrity check failed");
    }
    if (!result.revenue_match) {
      issues.push("Revenue events don't match stats");
    }
  }

  return {
    healthy: issues.length === 0,
    issues,
  };
}
