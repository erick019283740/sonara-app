import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRedisClient } from "@/lib/redis/client";
import { getQueueStats } from "@/lib/services/queueService";

export const dynamic = "force-dynamic";

async function checkDatabaseHealth(): Promise<{
  status: string;
  latency: number;
}> {
  const start = Date.now();
  try {
    const admin = createAdminClient();
    await admin.rpc("version");
    return {
      status: "connected",
      latency: Date.now() - start,
    };
  } catch (error) {
    console.error("[Health] Database check failed:", error);
    return {
      status: "disconnected",
      latency: -1,
    };
  }
}

async function checkRedisHealth(): Promise<{
  status: string;
  latency: number;
}> {
  const start = Date.now();
  try {
    const redis = getRedisClient();
    if (!redis) {
      // In production, Redis is required
      if (process.env.NODE_ENV === "production") {
        throw new Error("Redis is required in production");
      }
      return {
        status: "not_configured",
        latency: -1,
      };
    }
    await redis.ping();
    return {
      status: "connected",
      latency: Date.now() - start,
    };
  } catch (error) {
    console.error("[Health] Redis check failed:", error);
    // In production, Redis failure is critical
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    return {
      status: "disconnected",
      latency: -1,
    };
  }
}

async function checkSupabaseAuth(): Promise<{
  status: string;
}> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.getUser();
    if (error && error.message !== "Auth session missing!") {
      throw error;
    }
    return {
      status: "connected",
    };
  } catch (error) {
    console.error("[Health] Supabase auth check failed:", error);
    return {
      status: "disconnected",
    };
  }
}

export async function GET() {
  const [dbHealth, redisHealth, authHealth, queueStats] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkSupabaseAuth(),
    getQueueStats(),
  ]);

  const overallStatus =
    dbHealth.status === "connected" &&
    authHealth.status === "connected" &&
    (redisHealth.status === "connected" || 
     (redisHealth.status === "not_configured" && process.env.NODE_ENV !== "production"))
      ? "ok"
      : "degraded";

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: redisHealth,
        supabaseAuth: authHealth,
      },
      queue: queueStats,
    },
    {
      status: overallStatus === "ok" ? 200 : 503,
    }
  );
}
