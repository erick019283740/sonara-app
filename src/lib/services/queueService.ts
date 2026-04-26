import { QueueEvent } from "@/types/events";

type QueueType = QueueEvent["type"];

interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  failed: number;
}

// Re-export from Redis implementation for backward compatibility
export {
  enqueueEvent,
  dequeueEvent,
  getQueueStats,
  markEventProcessed,
  markEventFailed,
  subscribeToQueue,
} from "@/lib/redis/queueService";

// Keep types for backward compatibility
export type { QueueStats };
