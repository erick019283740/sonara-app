import { QueueEvent } from "@/types/events";
import { getBatchProcessor, addToBatch } from "@/lib/production/batchProcessor";

/**
 * Event-Driven Stream Processing
 * Instead of direct DB writes, streams go through event queue → batch processing
 */

export interface StreamEvent {
  userId: string;
  songId: string;
  artistId: string;
  sessionId: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  deviceId: string;
  ipFingerprint: string;
  timestamp: string;
}

/**
 * Push stream event to queue (non-blocking)
 */
export async function pushStreamEvent(event: StreamEvent): Promise<void> {
  const queueEvent: QueueEvent = {
    type: "stream",
    data: event,
    timestamp: new Date().toISOString(),
    retries: 0,
    maxRetries: 3,
  };

  await addToBatch(queueEvent);
}

/**
 * Batch process stream events
 * This is called by the batch processor
 */
export async function processStreamBatch(events: StreamEvent[]): Promise<void> {
  // Process in batches to DB
  // This would call the existing stream processing logic
  // but in batches instead of one-by-one

  console.log(`[EventDrivenStreams] Processing ${events.length} stream events`);

  // For each event, validate and record
  for (const event of events) {
    // Call existing stream validation and recording logic
    // This would be the same logic as in streamProcessor.ts
    // but batched for performance
  }

  // Write to database in single transaction
  // await supabase.rpc('batch_register_streams', { p_events: events });
}

/**
 * Event-driven stream recording
 * Replaces direct stream API calls with event queue
 */
export async function recordStreamEvent(event: StreamEvent): Promise<void> {
  await pushStreamEvent(event);
}

/**
 * Get stream event queue depth
 */
export async function getStreamQueueDepth(): Promise<number> {
  const processor = getBatchProcessor();
  // This would need to be exposed from the processor
  return 0;
}
