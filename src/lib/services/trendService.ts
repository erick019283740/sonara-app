"use server";

import { createClient } from "@supabase/supabase-js";
import type { TrendingScore } from "@/types/monetization";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

const NEW_SONG_WINDOW_DAYS = 7;

type SongBaseRow = {
  id: string;
  artist_id: string;
  created_at: string;
};

type SongMetricsRow = {
  likes: number | null;
  shares: number | null;
};

type StreamAggRow = {
  song_id: string;
  plays_24h: number;
  completion_rate_24h: number;
};

type AbuseSignalRow = {
  song_id: string;
  high_events_24h: number;
  suspicious_unique_users_24h: number;
  active_cluster_score_24h: number;
};

type AbuseAwareTrendingScore = TrendingScore & {
  abusePenalty: number;
  abuseRisk: number;
  validPlays24h: number;
  suspiciousUniqueUsers24h: number;
  highSeverityEvents24h: number;
  activeClusterScore24h: number;
};

const SCORE_WEIGHTS = {
  plays: 0.4,
  likes: 0.25,
  completion: 0.2,
  shares: 0.15,
} as const;

/**
 * Penalty is intentionally capped so legitimate songs with mild anomalies are not over-punished.
 */
function computeAbusePenalty(input: {
  highEvents: number;
  suspiciousUsers: number;
  activeClusterScore: number;
}): { penaltyMultiplier: number; abuseRisk: number } {
  const highEventRisk = Math.min(45, input.highEvents * 4);
  const suspiciousUserRisk = Math.min(35, input.suspiciousUsers * 3);
  const clusterRisk = Math.min(40, input.activeClusterScore * 0.6);

  const abuseRisk = Math.min(
    100,
    highEventRisk + suspiciousUserRisk + clusterRisk,
  );

  // 0..100 risk -> 1.0..0.35 multiplier
  const penaltyMultiplier = Math.max(0.35, 1 - abuseRisk / 154);

  return {
    penaltyMultiplier,
    abuseRisk: Number(abuseRisk.toFixed(2)),
  };
}

function daysSinceUpload(createdAt: string): number {
  const upload = new Date(createdAt);
  const now = new Date();
  return Math.max(
    0,
    Math.floor((now.getTime() - upload.getTime()) / (1000 * 60 * 60 * 24)),
  );
}

function isNewSongByDate(createdAt: string): boolean {
  return daysSinceUpload(createdAt) < NEW_SONG_WINDOW_DAYS;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function emptyTrending(songId: string): AbuseAwareTrendingScore {
  return {
    songId,
    trendingScore: 0,
    plays24h: 0,
    likes: 0,
    completionRate: 0,
    shares: 0,
    isNewSong: false,
    daysSinceUpload: 0,
    abusePenalty: 0,
    abuseRisk: 0,
    validPlays24h: 0,
    suspiciousUniqueUsers24h: 0,
    highSeverityEvents24h: 0,
    activeClusterScore24h: 0,
  };
}

async function getSongBase(songId: string): Promise<SongBaseRow | null> {
  const { data, error } = await supabase
    .from("songs")
    .select("id, artist_id, created_at")
    .eq("id", songId)
    .maybeSingle();

  if (error || !data) return null;
  return data as SongBaseRow;
}

async function getSongMetrics(songId: string): Promise<SongMetricsRow> {
  const { data } = await supabase
    .from("song_metrics")
    .select("likes, shares")
    .eq("song_id", songId)
    .maybeSingle();

  return {
    likes: (data?.likes as number | null) ?? 0,
    shares: (data?.shares as number | null) ?? 0,
  };
}

/**
 * Fraud-aware stream aggregation:
 * - uses streams table
 * - counts all streams
 */
async function getValidStreamAgg24h(songId: string): Promise<StreamAggRow> {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("streams")
    .select("seconds_played")
    .eq("song_id", songId)
    .gte("created_at", sinceIso)
    .limit(5000);

  if (error || !data?.length) {
    return {
      song_id: songId,
      plays_24h: 0,
      completion_rate_24h: 0,
    };
  }

  const validCount = data.length;
  const avgSecondsPlayed = data.reduce((sum, s) => sum + Number(s.seconds_played || 0), 0) / validCount;
  const completionRate = Math.min((avgSecondsPlayed / 180) * 100, 100);

  return {
    song_id: songId,
    plays_24h: validCount,
    completion_rate_24h: round4(completionRate),
  };
}

/**
 * Abuse signal aggregation from monitoring system.
 */
async function getAbuseSignals24h(songId: string): Promise<AbuseSignalRow> {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [abuseEventsRes, clusterRes] = await Promise.all([
    supabase
      .from("abuse_events")
      .select("severity, user_id")
      .eq("song_id", songId)
      .gte("created_at", sinceIso)
      .limit(5000),
    supabase
      .from("fraud_clusters")
      .select("cluster_score, status")
      .eq("song_id", songId)
      .eq("status", "active")
      .gte("updated_at", sinceIso)
      .limit(1000),
  ]);

  const eventRows = (abuseEventsRes.data ?? []) as {
    severity: string;
    user_id: string | null;
  }[];
  const clusterRows = (clusterRes.data ?? []) as {
    cluster_score: number;
    status: string;
  }[];

  const highEvents = eventRows.filter((r) => r.severity === "high").length;
  const suspiciousUsers = new Set(
    eventRows
      .filter((r) => r.severity === "high" || r.severity === "medium")
      .map((r) => r.user_id)
      .filter((id): id is string => Boolean(id)),
  ).size;

  const activeClusterScore = clusterRows.reduce(
    (sum, r) => sum + Number(r.cluster_score || 0),
    0,
  );

  return {
    song_id: songId,
    high_events_24h: highEvents,
    suspicious_unique_users_24h: suspiciousUsers,
    active_cluster_score_24h: round4(activeClusterScore),
  };
}

function computeBaseScore(input: {
  plays24h: number;
  likes: number;
  completionRate: number;
  shares: number;
}): number {
  return (
    input.plays24h * SCORE_WEIGHTS.plays +
    input.likes * SCORE_WEIGHTS.likes +
    (input.completionRate / 100) * SCORE_WEIGHTS.completion +
    input.shares * SCORE_WEIGHTS.shares
  );
}

export async function calculateTrendingScore(
  songId: string,
): Promise<AbuseAwareTrendingScore | null> {
  const song = await getSongBase(songId);
  if (!song) return null;

  const [metrics, streamAgg, abuseAgg] = await Promise.all([
    getSongMetrics(songId),
    getValidStreamAgg24h(songId),
    getAbuseSignals24h(songId),
  ]);

  const likes = Number(metrics.likes || 0);
  const shares = Number(metrics.shares || 0);
  const plays24h = Number(streamAgg.plays_24h || 0);
  const completionRate = Number(streamAgg.completion_rate_24h || 0);

  const base = computeBaseScore({
    plays24h,
    likes,
    completionRate,
    shares,
  });

  const newSong = isNewSongByDate(song.created_at);
  const withNewSongBoost = newSong ? base * 1.3 : base;

  const abuse = computeAbusePenalty({
    highEvents: abuseAgg.high_events_24h,
    suspiciousUsers: abuseAgg.suspicious_unique_users_24h,
    activeClusterScore: abuseAgg.active_cluster_score_24h,
  });

  const finalScore = withNewSongBoost * abuse.penaltyMultiplier;
  const abusePenalty = 1 - abuse.penaltyMultiplier;

  return {
    songId,
    trendingScore: round4(finalScore),
    plays24h,
    likes,
    completionRate: round4(completionRate),
    shares,
    isNewSong: newSong,
    daysSinceUpload: daysSinceUpload(song.created_at),
    abusePenalty: round4(abusePenalty),
    abuseRisk: round4(abuse.abuseRisk),
    validPlays24h: plays24h,
    suspiciousUniqueUsers24h: abuseAgg.suspicious_unique_users_24h,
    highSeverityEvents24h: abuseAgg.high_events_24h,
    activeClusterScore24h: abuseAgg.active_cluster_score_24h,
  };
}

export async function updateTrendingScoreCache(
  songId: string,
): Promise<boolean> {
  try {
    const trendingData = await calculateTrendingScore(songId);
    if (!trendingData) return false;

    const { error } = await supabase.from("trending_scores").upsert(
      {
        song_id: songId,
        trending_score: trendingData.trendingScore,
        plays_24h: trendingData.validPlays24h,
        likes_count: trendingData.likes,
        completion_rate: trendingData.completionRate,
        shares_count: trendingData.shares,
        is_new_song: trendingData.isNewSong,
        days_since_upload: trendingData.daysSinceUpload,
        abuse_risk: trendingData.abuseRisk,
        abuse_penalty: trendingData.abusePenalty,
        suspicious_users_24h: trendingData.suspiciousUniqueUsers24h,
        high_severity_abuse_events_24h: trendingData.highSeverityEvents24h,
        active_cluster_score_24h: trendingData.activeClusterScore24h,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "song_id" },
    );

    return !error;
  } catch {
    return false;
  }
}

/**
 * Recalculate one song and persist an abuse-aware audit event.
 */
export async function recalculateTrendForSong(
  songId: string,
): Promise<boolean> {
  const ok = await updateTrendingScoreCache(songId);
  if (!ok) return false;

  const score = await calculateTrendingScore(songId);
  if (!score) return false;

  await supabase.from("abuse_events").insert({
    event_type: "stream_abuse",
    song_id: songId,
    severity:
      score.abuseRisk >= 80 ? "high" : score.abuseRisk >= 45 ? "medium" : "low",
    risk_score: score.abuseRisk,
    reasons: ["trend_recalculation_abuse_aware"],
    metadata: {
      trending_score: score.trendingScore,
      abuse_penalty: score.abusePenalty,
      suspicious_users_24h: score.suspiciousUniqueUsers24h,
      high_events_24h: score.highSeverityEvents24h,
      cluster_score_24h: score.activeClusterScore24h,
    },
    state: "open",
    created_at: new Date().toISOString(),
  });

  return true;
}

/**
 * Batch abuse-aware recalculation.
 */
export async function batchRecalculateTrendingScores(
  songIds: string[],
): Promise<number> {
  let successCount = 0;

  for (const songId of songIds) {
    const success = await recalculateTrendForSong(songId);
    if (success) successCount += 1;
  }

  return successCount;
}

export async function getSongsNeedingRecalc(hoursBack = 24): Promise<string[]> {
  const sinceIso = new Date(
    Date.now() - hoursBack * 60 * 60 * 1000,
  ).toISOString();

  const [streamChanged, abuseChanged] = await Promise.all([
    supabase
      .from("streams")
      .select("song_id")
      .gte("created_at", sinceIso)
      .limit(10000),
    supabase
      .from("abuse_events")
      .select("song_id")
      .gte("created_at", sinceIso)
      .not("song_id", "is", null)
      .limit(10000),
  ]);

  const ids = new Set<string>();

  for (const row of (streamChanged.data ?? []) as {
    song_id: string | null;
  }[]) {
    if (row.song_id) ids.add(row.song_id);
  }

  for (const row of (abuseChanged.data ?? []) as { song_id: string | null }[]) {
    if (row.song_id) ids.add(row.song_id);
  }

  return [...ids];
}

export async function getTrendingSongs(
  limit = 50,
): Promise<AbuseAwareTrendingScore[]> {
  const { data, error } = await supabase
    .from("trending_scores")
    .select(
      "song_id, trending_score, plays_24h, likes_count, completion_rate, shares_count, is_new_song, days_since_upload, abuse_penalty, abuse_risk, suspicious_users_24h, high_severity_abuse_events_24h, active_cluster_score_24h",
    )
    .order("trending_score", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    songId: String(row.song_id),
    trendingScore: Number(row.trending_score || 0),
    plays24h: Number(row.plays_24h || 0),
    likes: Number(row.likes_count || 0),
    completionRate: Number(row.completion_rate || 0),
    shares: Number(row.shares_count || 0),
    isNewSong: Boolean(row.is_new_song),
    daysSinceUpload: Number(row.days_since_upload || 0),
    abusePenalty: Number(row.abuse_penalty || 0),
    abuseRisk: Number(row.abuse_risk || 0),
    validPlays24h: Number(row.plays_24h || 0),
    suspiciousUniqueUsers24h: Number(row.suspicious_users_24h || 0),
    highSeverityEvents24h: Number(row.high_severity_abuse_events_24h || 0),
    activeClusterScore24h: Number(row.active_cluster_score_24h || 0),
  }));
}

export async function getTrendingNewSongs(
  limit = 30,
): Promise<AbuseAwareTrendingScore[]> {
  const { data, error } = await supabase
    .from("trending_scores")
    .select(
      "song_id, trending_score, plays_24h, likes_count, completion_rate, shares_count, is_new_song, days_since_upload, abuse_penalty, abuse_risk, suspicious_users_24h, high_severity_abuse_events_24h, active_cluster_score_24h",
    )
    .eq("is_new_song", true)
    .order("trending_score", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    songId: String(row.song_id),
    trendingScore: Number(row.trending_score || 0),
    plays24h: Number(row.plays_24h || 0),
    likes: Number(row.likes_count || 0),
    completionRate: Number(row.completion_rate || 0),
    shares: Number(row.shares_count || 0),
    isNewSong: Boolean(row.is_new_song),
    daysSinceUpload: Number(row.days_since_upload || 0),
    abusePenalty: Number(row.abuse_penalty || 0),
    abuseRisk: Number(row.abuse_risk || 0),
    validPlays24h: Number(row.plays_24h || 0),
    suspiciousUniqueUsers24h: Number(row.suspicious_users_24h || 0),
    highSeverityEvents24h: Number(row.high_severity_abuse_events_24h || 0),
    activeClusterScore24h: Number(row.active_cluster_score_24h || 0),
  }));
}

export async function getTrendingWithDetails(limit = 50): Promise<
  Array<
    AbuseAwareTrendingScore & {
      title: string;
      artistId: string | null;
      coverUrl: string | null;
    }
  >
> {
  const scores = await getTrendingSongs(limit);
  if (!scores.length) return [];

  const ids = scores.map((s) => s.songId);

  const { data: songs } = await supabase
    .from("songs")
    .select("id, title, artist_id, cover_url")
    .in("id", ids);

  const map = new Map(
    (songs ?? []).map((s) => [
      String(s.id),
      {
        title: String(s.title || "Unknown"),
        artistId: (s.artist_id as string | null) ?? null,
        coverUrl: (s.cover_url as string | null) ?? null,
      },
    ]),
  );

  return scores.map((score) => {
    const song = map.get(score.songId) || {
      title: "Unknown",
      artistId: null,
      coverUrl: null,
    };

    return {
      ...score,
      title: song.title,
      artistId: song.artistId,
      coverUrl: song.coverUrl,
    };
  });
}

/**
 * Utility for conservative fallback when caller needs a score object.
 */
export async function getTrendingScoreOrEmpty(
  songId: string,
): Promise<AbuseAwareTrendingScore> {
  const score = await calculateTrendingScore(songId);
  return score ?? emptyTrending(songId);
}
