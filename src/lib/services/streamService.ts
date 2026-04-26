"use server";

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  StreamValidationRequest,
  StreamValidationResponse,
  RevenueSplit,
  Stream,
} from "@/types/monetization";
import { evaluateStreamFraud } from "@/lib/services/fraudService";
import { processStreamEarnings } from "@/lib/services/earningsService";
import { recalculateTrendForSong } from "@/lib/services/trendService";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

const STREAM_VALUE = 0.01;
const MIN_STREAM_DURATION = 30;
const MAX_STREAMS_PER_DAY = 10;
const DEFAULT_ARTIST_CUT = 0.6;
const DEFAULT_PLATFORM_CUT = 0.4;

function toISO(input?: string): string {
  if (!input) return new Date().toISOString();
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function resolveArtistId(
  songId: string,
  fallback?: string,
): Promise<string | null> {
  if (fallback) return fallback;

  const { data, error } = await supabase
    .from("songs")
    .select("artist_id")
    .eq("id", songId)
    .maybeSingle();

  if (error || !data?.artist_id) return null;
  return String(data.artist_id);
}

async function incrementDailyCounter(
  userId: string,
  songId: string,
  today: string,
): Promise<void> {
  const { data: dailyLimit } = await supabase
    .from("stream_daily_limits")
    .select("stream_count")
    .eq("user_id", userId)
    .eq("song_id", songId)
    .eq("last_stream_date", today)
    .maybeSingle();

  if (dailyLimit) {
    await supabase
      .from("stream_daily_limits")
      .update({ stream_count: safeNum(dailyLimit.stream_count, 0) + 1 })
      .eq("user_id", userId)
      .eq("song_id", songId)
      .eq("last_stream_date", today);
  } else {
    await supabase.from("stream_daily_limits").insert({
      user_id: userId,
      song_id: songId,
      stream_count: 1,
      last_stream_date: today,
    });
  }
}

async function checkDailyLimit(
  userId: string,
  songId: string,
  today: string,
): Promise<boolean> {
  const { data: dailyLimit } = await supabase
    .from("stream_daily_limits")
    .select("stream_count")
    .eq("user_id", userId)
    .eq("song_id", songId)
    .eq("last_stream_date", today)
    .maybeSingle();

  return safeNum(dailyLimit?.stream_count, 0) < MAX_STREAMS_PER_DAY;
}

export async function validateStream(
  request: StreamValidationRequest,
): Promise<StreamValidationResponse> {
  const {
    userId,
    songId,
    durationPlayedSeconds,
    totalDurationSeconds,
    artistId: artistIdFromReq,
    sessionId,
    deviceId,
    ipAddress,
    ipFingerprint,
    userAgent,
    countryCode,
    city,
    latitude,
    longitude,
    eventTimestamp,
  } = request;

  if (!userId || !songId) {
    return {
      isValid: false,
      status: "rejected",
      reason: "Missing required fields",
      streamValue: 0,
    };
  }

  if (
    !Number.isFinite(durationPlayedSeconds) ||
    !Number.isFinite(totalDurationSeconds) ||
    durationPlayedSeconds <= 0 ||
    totalDurationSeconds <= 0
  ) {
    return {
      isValid: false,
      status: "rejected",
      reason: "Invalid duration values",
      streamValue: 0,
    };
  }

  if (durationPlayedSeconds < MIN_STREAM_DURATION) {
    return {
      isValid: false,
      status: "rejected",
      reason: `Stream too short (minimum ${MIN_STREAM_DURATION} seconds)`,
      streamValue: 0,
    };
  }

  const eventIso = toISO(eventTimestamp);
  const today = eventIso.slice(0, 10);

  try {
    const withinDailyLimit = await checkDailyLimit(userId, songId, today);
    if (!withinDailyLimit) {
      return {
        isValid: false,
        status: "blocked",
        reason: "Daily stream limit exceeded for this song",
        streamValue: 0,
      };
    }

    const resolvedArtistId = await resolveArtistId(songId, artistIdFromReq);
    if (!resolvedArtistId) {
      return {
        isValid: false,
        status: "rejected",
        reason: "Artist not found for song",
        streamValue: 0,
      };
    }

    const fraud = await evaluateStreamFraud({
      userId,
      songId,
      artistId: resolvedArtistId,
      sessionId: sessionId || randomUUID(),
      deviceId: deviceId || "unknown_device",
      ipAddress: ipAddress || "unknown_ip",
      ipFingerprint: ipFingerprint || "unknown_ip_fingerprint",
      durationPlayedSeconds,
      totalDurationSeconds,
      userAgent,
      countryCode: countryCode ?? null,
      city: city ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      eventTimestamp: eventIso,
    });

    const shouldBlockEarnings = fraud.shouldBlockEarnings;
    const streamValue = shouldBlockEarnings ? 0 : STREAM_VALUE;
    const isAllowed = fraud.isAllowed;

    let streamId: string | undefined;

    if (isAllowed) {
      const { data: newStream, error: streamError } = await supabase
        .from("streams")
        .insert({
          user_id: userId,
          song_id: songId,
          seconds_played: durationPlayedSeconds,
          created_at: eventIso,
          is_valid: durationPlayedSeconds >= MIN_STREAM_DURATION,
          is_suspicious: fraud.suspicious,
          revenue_counted: false,
          fraud_score: fraud.riskScore,
          session_id: sessionId || null,
          device_fingerprint: deviceId || null,
          ip_fingerprint: ipFingerprint || null,
        })
        .select("id")
        .single();

      if (streamError) {
        return {
          isValid: false,
          status: "rejected",
          reason: "Failed to record stream",
          streamValue: 0,
        };
      }

      streamId = newStream?.id;
      await incrementDailyCounter(userId, songId, today);

      if (streamId) {
        await processStreamEarnings(
          resolvedArtistId,
          songId,
          streamId,
          {
            suspicious: fraud.suspicious,
            riskScore: fraud.riskScore,
            severity: fraud.severity,
            blockReason: shouldBlockEarnings
              ? "blocked_by_fraud_detection"
              : undefined,
          },
        );
      }

      await recalculateTrendForSong(songId);
    }

    return {
      isValid: isAllowed,
      status: isAllowed
        ? fraud.suspicious
          ? "flagged"
          : "accepted"
        : "blocked",
      reason: isAllowed
        ? undefined
        : fraud.reasons[0] || "Blocked by fraud system",
      streamId,
      streamValue,
      anomalyScore: fraud.anomalyScore,
      graphScore: fraud.graphScore,
      riskScore: fraud.riskScore,
      severity: fraud.severity,
      suspicious: fraud.suspicious,
      shouldBlockEarnings: fraud.shouldBlockEarnings,
      reasons: fraud.reasons,
      clusterId: fraud.clusterId,
    };
  } catch {
    return {
      isValid: false,
      status: "rejected",
      reason: "Internal server error",
      streamValue: 0,
    };
  }
}

export async function getSongStreamCount(songId: string): Promise<number> {
  const { count, error } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("song_id", songId);

  return error ? 0 : safeNum(count, 0);
}

export async function getStreamsLast24Hours(songId: string): Promise<number> {
  const twentyFourHoursAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const { count, error } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("song_id", songId)
    .gte("created_at", twentyFourHoursAgo);

  return error ? 0 : safeNum(count, 0);
}

export async function getCompletionRateLast24h(
  songId: string,
): Promise<number> {
  const twentyFourHoursAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("streams")
    .select("seconds_played")
    .eq("song_id", songId)
    .gte("created_at", twentyFourHoursAgo);

  if (error || !data || data.length === 0) return 0;

  const avgSecondsPlayed = data.reduce((sum, s) => sum + safeNum(s.seconds_played, 0), 0) / data.length;
  return Math.min(Math.round((avgSecondsPlayed / 180) * 100), 100);
}

export async function getCompletionRate(songId: string): Promise<number> {
  const { data, error } = await supabase
    .from("streams")
    .select("seconds_played")
    .eq("song_id", songId);

  if (error || !data || data.length === 0) return 0;

  const avgSecondsPlayed = data.reduce((sum, s) => sum + safeNum(s.seconds_played, 0), 0) / data.length;
  return Math.min(Math.round((avgSecondsPlayed / 180) * 100), 100);
}

export async function getUserDailyStreamCount(
  userId: string,
  songId: string,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("stream_daily_limits")
    .select("stream_count")
    .eq("user_id", userId)
    .eq("song_id", songId)
    .eq("last_stream_date", today)
    .maybeSingle();

  return error ? 0 : safeNum(data?.stream_count, 0);
}

export async function getRecentStreams(
  songId: string,
  limit = 100,
): Promise<Stream[]> {
  const { data, error } = await supabase
    .from("streams")
    .select("id, user_id, song_id, seconds_played, created_at")
    .eq("song_id", songId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((s) => ({
    id: String(s.id),
    userId: String(s.user_id),
    songId: String(s.song_id),
    durationPlayedSeconds: safeNum(s.seconds_played, 0),
    totalDurationSeconds: safeNum(s.seconds_played, 0),
    isValid: true,
    streamValue: STREAM_VALUE,
    isFraudBlocked: false,
    createdAt: String(s.created_at),
  }));
}

export function calculateRevenueSplit(
  streamValue: number = STREAM_VALUE,
): RevenueSplit {
  const value = safeNum(streamValue, STREAM_VALUE);
  return {
    artistCut: Number((value * DEFAULT_ARTIST_CUT).toFixed(4)),
    platformCut: Number((value * DEFAULT_PLATFORM_CUT).toFixed(4)),
  };
}

export async function batchValidateStreams(
  requests: StreamValidationRequest[],
): Promise<StreamValidationResponse[]> {
  const results: StreamValidationResponse[] = [];

  for (const request of requests) {
    const result = await validateStream(request);
    results.push(result);
  }

  return results;
}

export async function getStreamStats(songId: string): Promise<{
  songId: string;
  totalValidStreams: number;
  streamsLast24h: number;
  avgCompletionRate: number;
  totalRevenue: number;
}> {
  const totalStreams = await getSongStreamCount(songId);
  const streamsLast24h = await getStreamsLast24Hours(songId);
  const completionRate = await getCompletionRate(songId);

  return {
    songId,
    totalValidStreams: totalStreams,
    streamsLast24h,
    avgCompletionRate: completionRate,
    totalRevenue: Number((totalStreams * STREAM_VALUE).toFixed(2)),
  };
}
