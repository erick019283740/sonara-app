import { getRedisClient } from "@/lib/redis/client";
import { QueueEvent } from "@/types/events";

const BATCH_SIZE = 25;
const BATCH_INTERVAL_MS = 5000; // Process batch every 5 seconds

interface BatchProcessor {
  type: QueueEvent["type"];
  buffer: QueueEvent[];
  lastProcessTime: number;
}

class StreamBatchProcessor {
  private processors: Map<string, BatchProcessor> = new Map();
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startBatchProcessing();
  }

  private getProcessor(type: QueueEvent["type"]): BatchProcessor {
    if (!this.processors.has(type)) {
      this.processors.set(type, {
        type,
        buffer: [],
        lastProcessTime: Date.now(),
      });
    }
    return this.processors.get(type)!;
  }

  async addToBatch(event: QueueEvent): Promise<void> {
    const processor = this.getProcessor(event.type);
    processor.buffer.push(event);

    // Process immediately if buffer is full
    if (processor.buffer.length >= BATCH_SIZE) {
      await this.processBatch(processor);
    }
  }

  private async processBatch(processor: BatchProcessor): Promise<void> {
    if (processor.buffer.length === 0) return;

    const batch = processor.buffer.splice(0, BATCH_SIZE);
    processor.lastProcessTime = Date.now();

    try {
      await this.writeBatchToDatabase(processor.type, batch);
      console.log(
        `[BatchProcessor] Processed ${batch.length} events of type ${processor.type}`
      );
    } catch (error) {
      console.error(
        `[BatchProcessor] Failed to process batch of type ${processor.type}:`,
        error
      );
      // Return failed events to buffer for retry
      processor.buffer.unshift(...batch);
    }
  }

  private async writeBatchToDatabase(
    type: QueueEvent["type"],
    batch: QueueEvent[]
  ): Promise<void> {
    // This would be implemented based on the specific event type
    // For now, it's a placeholder that would call the appropriate service
    console.log(`[BatchProcessor] Writing ${batch.length} ${type} events to DB`);
  }

  private startBatchProcessing(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      const now = Date.now();
      for (const processor of this.processors.values()) {
        // Process if interval has passed
        if (now - processor.lastProcessTime >= BATCH_INTERVAL_MS) {
          void this.processBatch(processor);
        }
      }
    }, BATCH_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async flush(): Promise<void> {
    // Process all remaining buffers
    for (const processor of this.processors.values()) {
      if (processor.buffer.length > 0) {
        await this.processBatch(processor);
      }
    }
  }
}

// Singleton instance
let batchProcessor: StreamBatchProcessor | null = null;

export function getBatchProcessor(): StreamBatchProcessor {
  if (!batchProcessor) {
    batchProcessor = new StreamBatchProcessor();
  }
  return batchProcessor;
}

export async function addToBatch(event: QueueEvent): Promise<void> {
  const processor = getBatchProcessor();
  await processor.addToBatch(event);
}

export async function flushBatches(): Promise<void> {
  if (batchProcessor) {
    await batchProcessor.flush();
  }
}
