import {
  subscribeToQueue,
} from "@/lib/services/queueService";
import { processStreamEvent } from "@/lib/workers/streamProcessor";
import { batchRecalculateTrendingScores } from "@/lib/workers/trendingProcessor";
import {
  processEarningsAggregation,
  processMonthlyPayouts,
  archiveOldStreamData,
  cleanupExpiredSessions,
} from "@/lib/workers/earningsProcessor";
import { StreamEvent } from "@/types/events";

function isStreamEvent(data: unknown): data is StreamEvent {
  if (typeof data !== "object" || data === null) return false;
  const value = data as Partial<StreamEvent>;
  return (
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    typeof value.songId === "string" &&
    typeof value.artistId === "string" &&
    typeof value.durationPlayedSeconds === "number" &&
    typeof value.totalDurationSeconds === "number" &&
    typeof value.deviceId === "string" &&
    typeof value.ipAddress === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.userAgent === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.completionRate === "number"
  );
}

export async function initializeWorkers(): Promise<void> {
  // Stream processing worker
  subscribeToQueue("stream", async (event) => {
    try {
      if (!isStreamEvent(event.data)) return;
      const streamEvent = event.data;
      await processStreamEvent(streamEvent);
    } catch (err) {
      console.error("Stream worker error:", err);
    }
  });

  // Like processing worker
  subscribeToQueue("like", async (event) => {
    try {
      void event;
      // Handled in engagementProcessor
    } catch (err) {
      console.error("Like worker error:", err);
    }
  });

  // Follow processing worker
  subscribeToQueue("follow", async (event) => {
    try {
      void event;
      // Handled in engagementProcessor
    } catch (err) {
      console.error("Follow worker error:", err);
    }
  });

  // Support processing worker
  subscribeToQueue("support", async (event) => {
    try {
      void event;
      // Handled in engagementProcessor
    } catch (err) {
      console.error("Support worker error:", err);
    }
  });
}

export async function startPeriodicJobs(): Promise<void> {
  // Recalculate trending every 5 minutes
  setInterval(async () => {
    try {
      await batchRecalculateTrendingScores();
    } catch (err) {
      console.error("Trending recalculation error:", err);
    }
  }, 5 * 60 * 1000);

  // Process earnings aggregation every hour
  setInterval(async () => {
    try {
      await processEarningsAggregation();
    } catch (err) {
      console.error("Earnings aggregation error:", err);
    }
  }, 60 * 60 * 1000);

  // Process monthly payouts daily at 2 AM
  const scheduleMonthlyPayouts = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0);

    const timeUntilNextRun = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
      processMonthlyPayouts();
      // Schedule again after 24 hours
      setInterval(processMonthlyPayouts, 24 * 60 * 60 * 1000);
    }, timeUntilNextRun);
  };

  scheduleMonthlyPayouts();

  // Archive old data weekly
  setInterval(async () => {
    try {
      await archiveOldStreamData();
    } catch (err) {
      console.error("Data archival error:", err);
    }
  }, 7 * 24 * 60 * 60 * 1000);

  // Clean up expired sessions daily
  setInterval(async () => {
    try {
      await cleanupExpiredSessions();
    } catch (err) {
      console.error("Session cleanup error:", err);
    }
  }, 24 * 60 * 60 * 1000);
}
