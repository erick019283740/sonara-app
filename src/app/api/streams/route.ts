import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { enqueueEvent, getQueueStats } from "@/lib/services/queueService";
import type { StreamEventPayload } from "@/types/events";
import { applyRateLimit } from "@/lib/redis/rateLimiter";

const MIN_STREAM_SECONDS = 1;
const MAX_STREAM_SECONDS = 60 * 60 * 6;
const DEVICE_ID_SALT = process.env.DEVICE_ID_SALT || "sonara_device_salt";

type StreamRequestBody = {
  songId?: string;
  artistId?: string;
  durationPlayedSeconds?: number;
  totalDurationSeconds?: number;
  sessionId?: string;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeParseNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function generateDeviceId(userAgent: string, ipAddress: string): string {
  const combined = `${userAgent}|${ipAddress}|${DEVICE_ID_SALT}`;
  return crypto.createHash("sha256").update(combined).digest("hex");
}

function generateIpFingerprint(ipAddress: string): string {
  return crypto
    .createHash("sha256")
    .update(`${ipAddress}|${DEVICE_ID_SALT}`)
    .digest("hex");
}

function getClientIp(request: NextRequest): string {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  return request.headers.get("x-real-ip") || "unknown";
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

function validateBody(body: StreamRequestBody) {
  const songId = normalizeId(body.songId);
  const artistId = normalizeId(body.artistId);
  const sessionId = normalizeId(body.sessionId);
  const durationPlayedSeconds = safeParseNumber(body.durationPlayedSeconds);
  const totalDurationSeconds = safeParseNumber(body.totalDurationSeconds);

  if (!songId) return { ok: false as const, error: "songId_required" };
  if (!artistId) return { ok: false as const, error: "artistId_required" };
  if (!sessionId) return { ok: false as const, error: "sessionId_required" };
  if (!isUuidLike(sessionId)) {
    return { ok: false as const, error: "invalid_sessionId_format" };
  }

  if (
    !Number.isFinite(durationPlayedSeconds) ||
    !Number.isFinite(totalDurationSeconds)
  ) {
    return { ok: false as const, error: "invalid_duration_values" };
  }

  if (
    durationPlayedSeconds < MIN_STREAM_SECONDS ||
    durationPlayedSeconds > MAX_STREAM_SECONDS
  ) {
    return { ok: false as const, error: "durationPlayedSeconds_out_of_range" };
  }

  if (
    totalDurationSeconds < MIN_STREAM_SECONDS ||
    totalDurationSeconds > MAX_STREAM_SECONDS
  ) {
    return { ok: false as const, error: "totalDurationSeconds_out_of_range" };
  }

  if (durationPlayedSeconds > totalDurationSeconds) {
    return { ok: false as const, error: "duration_exceeds_total" };
  }

  return {
    ok: true as const,
    value: {
      songId,
      artistId,
      sessionId,
      durationPlayedSeconds,
      totalDurationSeconds,
    },
  };
}

export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResponse = await applyRateLimit(
    request,
    "/api/streams",
    await getAuthenticatedUserId()
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: StreamRequestBody;
    try {
      body = (await request.json()) as StreamRequestBody;
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }

    const validated = validateBody(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const {
      songId,
      artistId,
      sessionId,
      durationPlayedSeconds,
      totalDurationSeconds,
    } = validated.value;

    const userAgent = request.headers.get("user-agent") || "";
    const ipAddress = getClientIp(request);
    const deviceId = generateDeviceId(userAgent, ipAddress);
    const ipFingerprint = generateIpFingerprint(ipAddress);

    const streamEvent: StreamEventPayload = {
      userId,
      songId,
      artistId,
      deviceId,
      sessionId,
      ipAddress,
      ipFingerprint,
      durationPlayedSeconds,
      totalDurationSeconds,
      userAgent,
      metadata: {
        received_at: new Date().toISOString(),
        source: "api_streams_route",
      },
    };

    await enqueueEvent("stream", streamEvent);

    return NextResponse.json(
      {
        ok: true,
        queued: true,
        message: "Stream event accepted for processing",
      },
      { status: 202 },
    );
  } catch {
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const stats = await getQueueStats();

    return NextResponse.json(
      {
        ok: true,
        queue: stats,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
