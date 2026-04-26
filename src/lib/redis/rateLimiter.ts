import { NextRequest, NextResponse } from "next/server";
import { getRedisClient } from "./client";

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

// Rate limit configurations per endpoint
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "/api/streams": { windowMs: 60 * 1000, maxRequests: 15 }, // 15 req/min
  "/api/donations": { windowMs: 60 * 1000, maxRequests: 5 }, // 5 req/min
  "/api/upload": { windowMs: 60 * 1000, maxRequests: 3 }, // 3 req/min
  "/api/auth": { windowMs: 60 * 1000, maxRequests: 10 }, // 10 req/min
};

function getRateLimitKey(identifier: string, endpoint: string): string {
  return `ratelimit:${identifier}:${endpoint}`;
}

async function checkRateLimit(
  identifier: string,
  endpoint: string
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  
  // Fail-open if Redis is not available
  if (!redis) {
    console.warn("[RateLimiter] Redis not available - rate limiting disabled");
    return {
      allowed: true,
      remaining: 999,
      resetTime: Date.now() + 60000,
    };
  }
  
  const config = RATE_LIMITS[endpoint] || RATE_LIMITS["/api/auth"]; // Default to auth limits
  const key = getRateLimitKey(identifier, endpoint);
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Use Redis pipeline for atomic operations
  const pipeline = redis.pipeline();
  
  // Remove old entries outside the window
  pipeline.zremrangebyscore(key, 0, windowStart);
  
  // Count current requests in window
  pipeline.zcard(key);
  
  // Add current request
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  
  // Set expiry
  pipeline.expire(key, Math.ceil(config.windowMs / 1000) + 1);
  
  const results = await pipeline.exec();
  
  if (!results) {
    throw new Error("Redis pipeline execution failed");
  }

  const currentCount = (results[1][1] as number) + 1; // +1 for current request
  const allowed = currentCount <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - currentCount);
  const resetTime = now + config.windowMs;

  return {
    allowed,
    remaining,
    resetTime,
  };
}

export async function rateLimitByIp(
  request: NextRequest,
  endpoint: string
): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  return checkRateLimit(ip, endpoint);
}

export async function rateLimitByUserId(
  userId: string,
  endpoint: string
): Promise<RateLimitResult> {
  return checkRateLimit(userId, endpoint);
}

export async function applyRateLimit(
  request: NextRequest,
  endpoint: string,
  userId?: string | null
): Promise<NextResponse | null> {
  try {
    // Check IP-based rate limit first
    const ipResult = await rateLimitByIp(request, endpoint);
    
    if (!ipResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests from this IP" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": RATE_LIMITS[endpoint]?.maxRequests.toString() || "10",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": new Date(ipResult.resetTime).toISOString(),
            "Retry-After": Math.ceil((ipResult.resetTime - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    // If user is authenticated, also check user-based rate limit
    if (userId) {
      const userResult = await rateLimitByUserId(userId, endpoint);
      
      if (!userResult.allowed) {
        return NextResponse.json(
          { error: "Too many requests from this account" },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": RATE_LIMITS[endpoint]?.maxRequests.toString() || "10",
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": new Date(userResult.resetTime).toISOString(),
              "Retry-After": Math.ceil((userResult.resetTime - Date.now()) / 1000).toString(),
            },
          }
        );
      }
    }

    // Add rate limit headers to successful response
    const responseHeaders: Record<string, string> = {
      "X-RateLimit-Limit": RATE_LIMITS[endpoint]?.maxRequests.toString() || "10",
      "X-RateLimit-Remaining": ipResult.remaining.toString(),
      "X-RateLimit-Reset": new Date(ipResult.resetTime).toISOString(),
    };

    // Return null to allow request to proceed
    return null;
  } catch (error) {
    console.error("[RateLimiter] Error:", error);
    // On error, allow request to proceed (fail-open)
    return null;
  }
}

function getClientIp(request: NextRequest): string {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  return request.headers.get("x-real-ip") || "unknown";
}

export function getEndpointFromPath(pathname: string): string {
  // Match endpoint patterns
  if (pathname.startsWith("/api/streams")) return "/api/streams";
  if (pathname.startsWith("/api/donations")) return "/api/donations";
  if (pathname.startsWith("/api/upload")) return "/api/upload";
  if (pathname.startsWith("/api/auth")) return "/api/auth";
  return "/api/auth"; // Default
}
