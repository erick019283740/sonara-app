import Redis from "ioredis";
import { QueueEvent } from "@/types/events";
import { getRedisClient } from "./client";

const QUEUE_KEY_PREFIX = "sonara:queue:";

export async function enqueueEvent(type: QueueEvent["type"], data: unknown): Promise<void> {
  const redis = getRedisClient();
  
  // Fail-open if Redis is not available - log warning but don't crash
  if (!redis) {
    console.warn("[RedisQueue] Redis not available - queue disabled, event not persisted");
    return;
  }
  
  const event: QueueEvent = {
    type,
    data,
    timestamp: new Date().toISOString(),
    retries: 0,
    maxRetries: 3,
  };

  const queueKey = `${QUEUE_KEY_PREFIX}${type}`;
  await redis.rpush(queueKey, JSON.stringify(event));
}

export async function dequeueEvent(type: QueueEvent["type"]): Promise<QueueEvent | null> {
  const redis = getRedisClient();
  
  if (!redis) {
    return null;
  }
  
  const queueKey = `${QUEUE_KEY_PREFIX}${type}`;

  const result = await redis.lpop(queueKey);
  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result) as QueueEvent;
  } catch (error) {
    console.error("[RedisQueue] Failed to parse event:", error);
    return null;
  }
}

export async function getQueueSize(type: QueueEvent["type"]): Promise<number> {
  const redis = getRedisClient();
  
  if (!redis) {
    return 0;
  }
  
  const queueKey = `${QUEUE_KEY_PREFIX}${type}`;
  return await redis.llen(queueKey);
}

export async function getQueueStats(): Promise<{
  total: number;
  pending: number;
  processing: number;
  failed: number;
}> {
  const types: QueueEvent["type"][] = ["stream", "like", "follow", "support"];
  let total = 0;

  for (const type of types) {
    total += await getQueueSize(type);
  }

  return {
    total,
    pending: total,
    processing: 0, // Would need separate tracking for in-flight events
    failed: 0, // Would need separate dead-letter queue
  };
}

export async function markEventProcessed(_type: QueueEvent["type"], _event: QueueEvent): Promise<void> {
  // Events are removed from queue when dequeued, so no explicit marking needed
  // Could add to processed log for audit trail if needed
}

export async function markEventFailed(
  type: QueueEvent["type"],
  event: QueueEvent
): Promise<void> {
  const redis = getRedisClient();
  
  if (!redis) {
    console.warn("[RedisQueue] Redis not available - cannot retry failed event");
    return;
  }
  
  if (event.retries < event.maxRetries) {
    event.retries++;
    await enqueueEvent(type, event);
  } else {
    // Move to dead-letter queue for manual inspection
    const deadLetterKey = `${QUEUE_KEY_PREFIX}dead_letter:${type}`;
    await redis.rpush(deadLetterKey, JSON.stringify({
      ...event,
      failedAt: new Date().toISOString(),
    }));
  }
}

export async function subscribeToQueue(
  _type: QueueEvent["type"],
  _callback: (event: QueueEvent) => void
): Promise<void> {
  // Redis pub/sub would be implemented here for real-time notifications
  // For now, use polling in the worker
}
