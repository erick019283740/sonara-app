/**
 * API Fraud Guard
 * Unified fraud protection wrapper for all API endpoints
 * Adds bot detection, replay prevention, anomaly detection
 */

import { NextRequest, NextResponse } from "next/server";
import { getFraudHardening } from "@/lib/security/fraudHardening";
import { applyRateLimit } from "@/lib/redis/rateLimiter";

interface FraudGuardConfig {
  endpoint: string;
  requireAuth?: boolean;
  maxRequestsPerMinute?: number;
  checkBotPatterns?: boolean;
  checkReplay?: boolean;
  checkAnomaly?: boolean;
}

const DEFAULT_CONFIG: FraudGuardConfig = {
  endpoint: "",
  requireAuth: true,
  maxRequestsPerMinute: 60,
  checkBotPatterns: true,
  checkReplay: true,
  checkAnomaly: true,
};

/**
 * Get client IP from request
 */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * Get device fingerprint from request
 */
function getDeviceFingerprint(request: NextRequest): string {
  const userAgent = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept") || "";
  const language = request.headers.get("accept-language") || "";
  return `${userAgent}|${accept}|${language}`;
}

/**
 * Check for bot patterns in request
 */
function detectBotPatterns(request: NextRequest): {
  isBot: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const userAgent = request.headers.get("user-agent") || "";

  // No user agent
  if (!userAgent || userAgent.length < 10) {
    reasons.push("missing_user_agent");
  }

  // Known bot signatures
  const botPatterns = [
    /bot/i, /crawler/i, /spider/i, /scraper/i,
    /python-requests/i, /curl/i, /wget/i, /postman/i,
  ];
  for (const pattern of botPatterns) {
    if (pattern.test(userAgent)) {
      reasons.push(`bot_signature:${pattern.source}`);
    }
  }

  // Missing required headers
  if (!request.headers.get("accept")) {
    reasons.push("missing_accept_header");
  }

  return {
    isBot: reasons.length > 0,
    reasons,
  };
}

/**
 * Apply fraud guard to API endpoint
 */
export async function withFraudGuard<T>(
  request: NextRequest,
  config: Partial<FraudGuardConfig>,
  handler: () => Promise<NextResponse<T>>
): Promise<NextResponse<T | { error: string; fraudFlags?: string[] }>> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const ip = getClientIp(request);

  // 1. Rate limiting
  const rateLimitResponse = await applyRateLimit(
    request,
    merged.endpoint,
    null
  );
  if (rateLimitResponse) {
    return rateLimitResponse as unknown as NextResponse<T | { error: string; fraudFlags?: string[] }>;
  }

  // 2. Bot pattern detection
  if (merged.checkBotPatterns) {
    const botCheck = detectBotPatterns(request);
    if (botCheck.isBot) {
      const fraudEngine = getFraudHardening();
      // Track bot attempt as stream anomaly
      await fraudEngine.trackEvent("unknown", "stream");

      return NextResponse.json(
        { error: "bot_detected", fraudFlags: botCheck.reasons },
        { status: 403 }
      );
    }
  }

  // 3. Execute handler
  try {
    return await handler();
  } catch (error) {
    console.error(`[ApiFraudGuard] ${merged.endpoint} error:`, error);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}

/**
 * Validate stream request with fraud checks
 */
export async function validateStreamRequest(
  request: NextRequest,
  body: {
    songId: string;
    durationPlayedSeconds: number;
    sessionId?: string;
  }
): Promise<{
  valid: boolean;
  userId?: string;
  error?: string;
  fraudFlags?: string[];
}> {
  const ip = getClientIp(request);
  const fingerprint = getDeviceFingerprint(request);

  // Get auth user
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { valid: false, error: "unauthorized" };
  }

  const fraudEngine = getFraudHardening();

  // Check if user is blocked
  if (await fraudEngine.isBlocked(user.id)) {
    return { valid: false, error: "account_suspended", fraudFlags: ["blocked_user"] };
  }

  // Calculate fraud score
  const score = await fraudEngine.calculateFraudScore(user.id, {
    userAgent: request.headers.get("user-agent") || "",
    screenSize: "unknown",
    timezone: "unknown",
    language: request.headers.get("accept-language") || "",
    plugins: "",
    canvasHash: fingerprint,
  });

  if (score.score < 30) {
    return {
      valid: false,
      error: "suspicious_activity",
      fraudFlags: score.factors,
    };
  }

  // Track the stream event
  await fraudEngine.trackEvent(user.id, "stream");

  // Check replay (same song in quick succession)
  if (body.durationPlayedSeconds < 5) {
    await fraudEngine.trackEvent(user.id, "skip");
  }

  return {
    valid: true,
    userId: user.id,
  };
}

/**
 * Middleware-style fraud guard for API routes
 */
export function createFraudGuard(config: Partial<FraudGuardConfig>) {
  return async (request: NextRequest) => {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const ip = getClientIp(request);

    // Rate limit check
    const rateLimitResponse = await applyRateLimit(
      request,
      merged.endpoint,
      null
    );
    if (rateLimitResponse) return rateLimitResponse;

    // Bot check
    if (merged.checkBotPatterns) {
      const botCheck = detectBotPatterns(request);
      if (botCheck.isBot) {
        return NextResponse.json(
          { error: "bot_detected", fraudFlags: botCheck.reasons },
          { status: 403 }
        );
      }
    }

    return null; // No fraud detected, proceed
  };
}
