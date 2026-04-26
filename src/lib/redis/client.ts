import Redis from "ioredis";

let redisClient: Redis | null = null;
let redisAvailable = false;

export function getRedisClient(): Redis | null {
  if (!redisClient && !redisAvailable) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.warn("[Redis] REDIS_URL not set - Redis features disabled");
      redisAvailable = false;
      return null;
    }
    
    try {
      redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            return null;
          }
          return Math.min(times * 50, 200);
        },
      });

      redisClient.on("error", (err) => {
        console.error("[Redis] Connection error:", err);
        redisAvailable = false;
      });

      redisClient.on("connect", () => {
        console.log("[Redis] Connected successfully");
        redisAvailable = true;
      });
    } catch (error) {
      console.error("[Redis] Failed to initialize:", error);
      redisAvailable = false;
      redisClient = null;
    }
  }

  return redisClient;
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisAvailable = false;
  }
}
