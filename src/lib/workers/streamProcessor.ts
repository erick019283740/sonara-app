import { createClient } from "@supabase/supabase-js";
import { StreamEvent, ProcessedStream } from "@/types/events";
import { Decimal } from "decimal.js";
import { evaluateStreamFraud } from "@/lib/services/fraudService";
import { recordStreamEarning } from "@/lib/services/earningsLedgerService";
import {
  calculateEarningsSplit,
  isValidStreamDuration,
} from "@/lib/domain/streamRules";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const STREAM_VALUE = new Decimal("0.01");

export async function processStreamEvent(
  event: StreamEvent
): Promise<ProcessedStream> {
  const streamId = event.id;

  // Validate stream duration
  if (!isValidStreamDuration(event.durationPlayedSeconds)) {
    return {
      streamId,
      isValid: false,
      fraudFlags: ["insufficient_duration"],
      streamValue: 0,
      artistCut: 0,
      platformCut: 0,
    };
  }

  const fraudEvaluation = await evaluateStreamFraud({
    userId: event.userId,
    songId: event.songId,
    artistId: event.artistId,
    deviceId: event.deviceId,
    ipAddress: event.ipAddress,
    ipFingerprint: event.ipAddress,
    sessionId: event.sessionId,
    durationPlayedSeconds: event.durationPlayedSeconds,
    totalDurationSeconds: event.totalDurationSeconds,
    userAgent: event.userAgent,
    eventTimestamp: event.timestamp,
  });
  const fraudFlags = fraudEvaluation.reasons;
  const riskScore = fraudEvaluation.riskScore;
  const isValid = fraudEvaluation.isAllowed;

  let streamValue = 0;
  let artistCut = 0;
  let platformCut = 0;

  if (isValid) {
    streamValue = STREAM_VALUE.toNumber();
    const split = calculateEarningsSplit(streamValue);
    artistCut = split.artistShare;
    platformCut = split.platformShare;
  }

  // Store stream event
  try {
    await supabase.from("streams").insert({
      id: streamId,
      user_id: event.userId,
      song_id: event.songId,
      seconds_played: event.durationPlayedSeconds,
      created_at: event.timestamp,
    });

    // Store fraud flags if any
    if (fraudFlags.length > 0) {
      await supabase.from("stream_fraud_flags").insert({
        stream_id: streamId,
        user_id: event.userId,
        song_id: event.songId,
        flags: fraudFlags,
        risk_score: riskScore,
        metadata: {
          device_id: event.deviceId,
          ip_address: event.ipAddress,
          lastStreamAt: event.timestamp,
        },
        created_at: event.timestamp,
      });
    }

    // If valid, record earnings
    if (isValid) {
      await recordStreamEarning(
        event.artistId,
        streamId,
        event.songId,
        STREAM_VALUE
      );
    }
  } catch (err) {
    console.error("Error processing stream event:", err);
    throw err;
  }

  return {
    streamId,
    isValid,
    fraudFlags,
    streamValue,
    artistCut,
    platformCut,
  };
}

export async function getSongStreamCount(songId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("song_id", songId);

    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function getUserTotalStreams(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function getStreamsLast24Hours(songId: string): Promise<number> {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { count, error } = await supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("song_id", songId)
      .gte("created_at", yesterday.toISOString());

    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function calculateCompletionRate(songId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("streams")
      .select("seconds_played")
      .eq("song_id", songId);

    if (error || !data || data.length === 0) return 0;

    const avgSecondsPlayed =
      data.reduce((sum, s) => sum + s.seconds_played, 0) / data.length;
    return Math.min(avgSecondsPlayed / 180, 1);
  } catch {
    return 0;
  }
}

type SongMetricsResult = {
  songId: string;
  plays24h: number;
  completionRate: number;
  likes: number;
  shares: number;
};

export async function getSongMetrics(songId: string): Promise<SongMetricsResult> {
  const plays24h = await getStreamsLast24Hours(songId);
  const completionRate = await calculateCompletionRate(songId);

  try {
    const { data } = await supabase
      .from("song_metrics")
      .select("likes, shares")
      .eq("song_id", songId)
      .single();

    return {
      songId,
      plays24h,
      completionRate,
      likes: data?.likes || 0,
      shares: data?.shares || 0,
    };
  } catch {
    return {
      songId,
      plays24h,
      completionRate,
      likes: 0,
      shares: 0,
    };
  }
}
