"use server";

import { createClient } from "@supabase/supabase-js";
import type { FeedSong } from "@/types/monetization";
import { getSuspiciousUserStatus } from "@/lib/services/fraudService";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key",
);

const FEED_CACHE_TTL_MS = 45_000;
const PROFILE_CACHE_TTL_MS = 120_000;
const MAX_CANDIDATES = 320;

const MIX = {
  personalized: 0.6,
  trending: 0.3,
  discovery: 0.1,
} as const;

export type Severity = "low" | "medium" | "high";

type UserBehaviorInsert = {
  user_id: string;
  song_id: string;
  artist_id: string | null;
  genre: string | null;
  watch_time_seconds: number;
  completion_rate: number;
  skip_rate: number;
  skip_latency_seconds: number;
  liked: boolean;
  shared: boolean;
  followed: boolean;
  replayed: boolean;
  session_id: string | null;
  source: "feed" | "song" | "artist" | "search" | "other";
  created_at: string;
};

type UserProfile = {
  userId: string;
  preferredGenres: string[];
  preferredArtists: string[];
  avgSessionTimeSeconds: number;
  avgCompletionRate: number;
  avgSkipRate: number;
  engagementScore: number;
  lastUpdatedAt: string;
};

type SongCandidate = {
  id: string;
  title: string;
  artist_id: string | null;
  genre: string | null;
  duration: number;
  cover_url: string | null;
  created_at: string;
  stream_count: number;
  likes_count: number;
  shares_count: number;
  trending_score: number;
  plays_24h: number;
  abuse_risk: number;
  suspicious_users_24h: number;
  should_block_earnings: boolean;
};

export type ScoreBreakdown = {
  baseTrendingScore: number;
  userAffinityScore: number;
  recentGrowthRate: number;
  growthBoostMultiplier: number;
  viralScore: number;
  diversityBoost: number;
  freshnessBoost: number;
  antiSpamPenalty: number;
  finalScore: number;
};

export type RankedFeedSong = FeedSong & {
  songId: string;
  song_id: string;
  artistId?: string;
  artist_id?: string;
  genre?: string | null;
  scoreBreakdown: ScoreBreakdown;
  algorithmMeta: {
    sourceBucket: "personalized" | "trending" | "discovery";
    antiSpamPassed: boolean;
    boostedByGrowthSpike: boolean;
    suspiciousArtistFiltered: boolean;
  };
};

type FeedCacheEntry = {
  expiresAt: number;
  songs: RankedFeedSong[];
};

type ProfileCacheEntry = {
  expiresAt: number;
  profile: UserProfile;
};

export type ForYouOptions = {
  limit?: number;
  sessionId?: string | null;
  bypassCache?: boolean;
};

export type ForYouFeedResponse = {
  userId: string;
  limit: number;
  generatedAt: string;
  cacheHit: boolean;
  songs: RankedFeedSong[];
};

type RecordInteractionInput = {
  userId: string;
  songId: string;
  sessionId?: string | null;
  source?: "feed" | "song" | "artist" | "search" | "other";
  watchTimeSeconds: number;
  totalDurationSeconds: number;
  liked?: boolean;
  shared?: boolean;
  followed?: boolean;
  replayed?: boolean;
  skipped?: boolean;
};

const feedCache = new Map<string, FeedCacheEntry>();
const profileCache = new Map<string, ProfileCacheEntry>();

function nowIso() {
  return new Date().toISOString();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeNum(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function ratio(a: number, b: number) {
  if (b <= 0) return a > 0 ? 1 : 0;
  return a / b;
}

function daysSince(iso: string): number {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return 9999;
  return Math.max(0, (Date.now() - d) / 86_400_000);
}

function cacheKey(userId: string, limit: number, sessionId?: string | null) {
  return `${userId}|${limit}|${sessionId ?? "no-session"}`;
}

async function fetchUserProfile(
  userId: string,
  force = false,
): Promise<UserProfile> {
  const cached = profileCache.get(userId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.profile;

  const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ data: behaviorRows }, { data: followsRows }] = await Promise.all([
    supabase
      .from("user_behavior")
      .select("genre,artist_id,watch_time_seconds,completion_rate,skip_rate")
      .eq("user_id", userId)
      .gte("created_at", since30d)
      .limit(5000),
    supabase
      .from("artist_follows")
      .select("artist_id")
      .eq("user_id", userId)
      .limit(500),
  ]);

  const genreScores = new Map<string, number>();
  const artistScores = new Map<string, number>();

  let totalWatch = 0;
  let totalCompletion = 0;
  let totalSkip = 0;
  let rowsCount = 0;

  for (const row of behaviorRows ?? []) {
    const genre = safeStr((row as { genre?: unknown }).genre, "").trim();
    const artistId = safeStr(
      (row as { artist_id?: unknown }).artist_id,
      "",
    ).trim();

    const watch = safeNum(
      (row as { watch_time_seconds?: unknown }).watch_time_seconds,
      0,
    );
    const completion = safeNum(
      (row as { completion_rate?: unknown }).completion_rate,
      0,
    );
    const skip = safeNum((row as { skip_rate?: unknown }).skip_rate, 0);

    totalWatch += watch;
    totalCompletion += completion;
    totalSkip += skip;
    rowsCount += 1;

    const weight =
      completion * 1.2 + Math.max(0, 100 - skip) * 0.35 + watch * 0.02;

    if (genre) genreScores.set(genre, (genreScores.get(genre) ?? 0) + weight);
    if (artistId)
      artistScores.set(artistId, (artistScores.get(artistId) ?? 0) + weight);
  }

  for (const row of followsRows ?? []) {
    const artistId = safeStr(
      (row as { artist_id?: unknown }).artist_id,
      "",
    ).trim();
    if (!artistId) continue;
    artistScores.set(artistId, (artistScores.get(artistId) ?? 0) + 220);
  }

  const preferredGenres = [...genreScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k);

  const preferredArtists = [...artistScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k]) => k);

  const avgSessionTimeSeconds = rowsCount > 0 ? totalWatch / rowsCount : 0;
  const avgCompletionRate = rowsCount > 0 ? totalCompletion / rowsCount : 0;
  const avgSkipRate = rowsCount > 0 ? totalSkip / rowsCount : 0;

  const engagementScore = clamp(
    avgCompletionRate * 0.65 + (100 - avgSkipRate) * 0.35,
    0,
    100,
  );

  const profile: UserProfile = {
    userId,
    preferredGenres,
    preferredArtists,
    avgSessionTimeSeconds,
    avgCompletionRate,
    avgSkipRate,
    engagementScore,
    lastUpdatedAt: nowIso(),
  };

  profileCache.set(userId, {
    profile,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  });

  return profile;
}

async function fetchSongCandidates(
  limit = MAX_CANDIDATES,
): Promise<SongCandidate[]> {
  const [{ data: trendingRows }] = await Promise.all([
    supabase
      .from("trending_scores")
      .select(
        "song_id,trending_score,plays_24h,abuse_risk,suspicious_users_24h",
      )
      .order("trending_score", { ascending: false })
      .limit(limit),
  ]);

  const bySong = new Map<string, SongCandidate>();

  const blockedSongs = new Set<string>();

  const songIds = (trendingRows ?? [])
    .map((r) => safeStr((r as { song_id?: unknown }).song_id, ""))
    .filter(Boolean);

  if (songIds.length === 0) return [];

  const { data: songsRows } = await supabase
    .from("songs")
    .select(
      "id,title,artist_id,genre,duration,cover_url,created_at,stream_count,likes_count,shares_count",
    )
    .in("id", songIds);

  const songMeta = new Map<string, Record<string, unknown>>();
  for (const row of songsRows ?? []) {
    songMeta.set(
      String((row as { id: unknown }).id),
      row as Record<string, unknown>,
    );
  }

  const { data: suspiciousArtistsRows } = await supabase
    .from("suspicious_users")
    .select("user_id,status,max_risk_score,severity")
    .in("status", ["blocked", "flagged"])
    .gte("max_risk_score", 60)
    .limit(5000);

  const suspiciousArtistUserIds = new Set(
    (suspiciousArtistsRows ?? [])
      .map((r) => safeStr((r as { user_id?: unknown }).user_id, ""))
      .filter(Boolean),
  );

  const { data: artistRows } = await supabase
    .from("artists")
    .select("id,user_id")
    .limit(20000);

  const suspiciousArtistIds = new Set<string>();
  for (const row of artistRows ?? []) {
    const artistId = safeStr((row as { id?: unknown }).id, "");
    const artistUserId = safeStr((row as { user_id?: unknown }).user_id, "");
    if (artistId && artistUserId && suspiciousArtistUserIds.has(artistUserId)) {
      suspiciousArtistIds.add(artistId);
    }
  }

  for (const row of trendingRows ?? []) {
    const songId = safeStr((row as { song_id?: unknown }).song_id, "");
    const meta = songMeta.get(songId);
    if (!meta) continue;

    bySong.set(songId, {
      id: songId,
      title: safeStr(meta.title, "Unknown"),
      artist_id: safeStr(meta.artist_id, "") || null,
      genre: safeStr(meta.genre, "") || null,
      duration: safeNum(meta.duration, 0),
      cover_url: safeStr(meta.cover_url, "") || null,
      created_at: safeStr(meta.created_at, nowIso()),
      stream_count: safeNum(meta.stream_count, 0),
      likes_count: safeNum(meta.likes_count, 0),
      shares_count: safeNum(meta.shares_count, 0),
      trending_score: safeNum(
        (row as { trending_score?: unknown }).trending_score,
        0,
      ),
      plays_24h: safeNum((row as { plays_24h?: unknown }).plays_24h, 0),
      abuse_risk: safeNum((row as { abuse_risk?: unknown }).abuse_risk, 0),
      suspicious_users_24h: safeNum(
        (row as { suspicious_users_24h?: unknown }).suspicious_users_24h,
        0,
      ),
      should_block_earnings:
        blockedSongs.has(songId) ||
        suspiciousArtistIds.has(safeStr(meta.artist_id, "")),
    });
  }

  return [...bySong.values()];
}

async function getGrowthRate(
  songId: string,
): Promise<{ growthRate: number; multiplier: number }> {
  const now = Date.now();
  const lastHourStart = new Date(now - 3600_000).toISOString();
  const prevHourStart = new Date(now - 2 * 3600_000).toISOString();

  const [lastHour, prevHour] = await Promise.all([
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("song_id", songId)
      .gte("created_at", lastHourStart),
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("song_id", songId)
      .gte("created_at", prevHourStart)
      .lt("created_at", lastHourStart),
  ]);

  const last = safeNum(lastHour.count, 0);
  const prev = safeNum(prevHour.count, 0);

  const growthRate = prev <= 0 ? (last > 0 ? 3 : 1) : last / prev;

  let multiplier = 1;
  if (growthRate >= 6) multiplier = 3;
  else if (growthRate >= 4) multiplier = 2.25;
  else if (growthRate >= 2.5) multiplier = 1.8;
  else if (growthRate >= 1.6) multiplier = 1.5;

  return { growthRate, multiplier };
}

function computeAffinity(song: SongCandidate, profile: UserProfile): number {
  let score = 0;

  if (song.genre && profile.preferredGenres.includes(song.genre)) {
    const pos = profile.preferredGenres.indexOf(song.genre);
    score += 60 - pos * 6;
  }

  if (song.artist_id && profile.preferredArtists.includes(song.artist_id)) {
    const pos = profile.preferredArtists.indexOf(song.artist_id);
    score += 85 - pos * 3;
  }

  const engagementAdjustment = profile.engagementScore * 0.25;
  score += engagementAdjustment;

  return clamp(score, 0, 100);
}

function antiSpamPenalty(song: SongCandidate): number {
  let penalty = 1;

  if (song.should_block_earnings) penalty *= 0.2;
  if (song.abuse_risk >= 85) penalty *= 0.2;
  else if (song.abuse_risk >= 70) penalty *= 0.4;
  else if (song.abuse_risk >= 60) penalty *= 0.65;
  else if (song.abuse_risk >= 45) penalty *= 0.82;

  if (song.suspicious_users_24h >= 90) penalty *= 0.2;
  else if (song.suspicious_users_24h >= 60) penalty *= 0.5;
  else if (song.suspicious_users_24h >= 45) penalty *= 0.72;
  else if (song.suspicious_users_24h >= 20) penalty *= 0.9;

  return clamp(Number(penalty.toFixed(4)), 0, 1);
}

function antiSpamPass(song: SongCandidate): boolean {
  if (song.should_block_earnings) return false;
  if (song.abuse_risk >= 70) return false;
  if (song.suspicious_users_24h >= 60) return false;
  return true;
}

function diversityBoost(
  song: SongCandidate,
  already: RankedFeedSong[],
  profile: UserProfile,
): number {
  if (already.length === 0) return 1.03;

  const sameArtistInTop = already.filter(
    (s) => s.artist === song.artist_id,
  ).length;
  const sameGenreInTop = already.filter(
    (s) => (s as unknown as { genre?: string | null }).genre === song.genre,
  ).length;

  let boost = 1;
  if (sameArtistInTop >= 2) boost -= 0.16;
  if (sameGenreInTop >= Math.max(3, Math.floor(already.length * 0.45)))
    boost -= 0.08;

  if (song.artist_id && !profile.preferredArtists.includes(song.artist_id)) {
    boost += 0.04;
  }

  return clamp(boost, 0.72, 1.2);
}

function freshnessBoost(song: SongCandidate): number {
  const d = daysSince(song.created_at);
  if (d <= 1) return 1.18;
  if (d <= 3) return 1.1;
  if (d <= 7) return 1.05;
  if (d <= 30) return 1;
  return 0.96;
}

async function rankCandidates(
  userId: string,
  candidates: SongCandidate[],
  limit: number,
  sessionId?: string | null,
): Promise<RankedFeedSong[]> {
  const profile = await fetchUserProfile(userId);

  const suspiciousUserStatus = await getSuspiciousUserStatus(userId);
  const userRiskPenalty = suspiciousUserStatus.isBlocked
    ? 0.55
    : suspiciousUserStatus.isSuspicious
      ? 0.82
      : 1;

  const scored = await Promise.all(
    candidates.map(async (song) => {
      const antiSpamPassed = antiSpamPass(song);
      const spamPenalty = antiSpamPenalty(song);
      if (!antiSpamPassed && spamPenalty <= 0.25) return null;

      const baseTrendingScore = clamp(song.trending_score, 0, 1000);
      const userAffinityScore = computeAffinity(song, profile);

      const { growthRate, multiplier } = await getGrowthRate(song.id);

      const viralScore =
        baseTrendingScore * 0.5 +
        userAffinityScore * 0.3 +
        clamp(growthRate * 100, 0, 400) * 0.2;

      const boosted =
        viralScore * multiplier * userRiskPenalty * spamPenalty;

      const breakdown: ScoreBreakdown = {
        baseTrendingScore,
        userAffinityScore,
        recentGrowthRate: Number(growthRate.toFixed(4)),
        growthBoostMultiplier: Number(multiplier.toFixed(2)),
        viralScore: Number(viralScore.toFixed(4)),
        diversityBoost: 1,
        freshnessBoost: freshnessBoost(song),
        antiSpamPenalty: spamPenalty,
        finalScore: Number((boosted * freshnessBoost(song)).toFixed(4)),
      };

      const row: RankedFeedSong = {
        songId: song.id,
        song_id: song.id,
        title: song.title,
        trendingScore: Number(song.trending_score.toFixed(4)),
        plays24h: song.plays_24h,
        likes: song.likes_count,
        completionRate: 0,
        shares: song.shares_count,
        isNewSong: daysSince(song.created_at) < 7,
        daysSinceUpload: Math.floor(daysSince(song.created_at)),
        artist: song.artist_id ?? undefined,
        artistId: song.artist_id ?? undefined,
        artist_id: song.artist_id ?? undefined,
        genre: song.genre ?? null,
        coverUrl: song.cover_url ?? undefined,
        scoreBreakdown: breakdown,
        algorithmMeta: {
          sourceBucket: "trending",
          antiSpamPassed,
          boostedByGrowthSpike: multiplier > 1,
          suspiciousArtistFiltered: song.should_block_earnings,
        },
      };

      return row;
    }),
  );

  const filtered = scored.filter(Boolean) as RankedFeedSong[];
  filtered.sort(
    (a, b) => b.scoreBreakdown.finalScore - a.scoreBreakdown.finalScore,
  );

  const personalizedTarget = Math.max(1, Math.floor(limit * MIX.personalized));
  const trendingTarget = Math.max(1, Math.floor(limit * MIX.trending));
  const discoveryTarget = Math.max(
    1,
    limit - personalizedTarget - trendingTarget,
  );

  const personalized: RankedFeedSong[] = [];
  const trending: RankedFeedSong[] = [];
  const discovery: RankedFeedSong[] = [];

  for (const s of filtered) {
    const affinity = s.scoreBreakdown.userAffinityScore;
    const freshness = s.scoreBreakdown.freshnessBoost;
    const isDiscovery = affinity < 35 || freshness > 1.12;
    if (isDiscovery) {
      discovery.push(s);
    } else if (affinity >= 55) {
      personalized.push(s);
    } else {
      trending.push(s);
    }
  }

  const selected: RankedFeedSong[] = [];
  const seen = new Set<string>();

  function pushBucket(
    bucket: RankedFeedSong[],
    target: number,
    label: RankedFeedSong["algorithmMeta"]["sourceBucket"],
  ) {
    for (const item of bucket) {
      if (selected.length >= limit) break;
      if (seen.has(item.songId)) continue;
      item.algorithmMeta.sourceBucket = label;
      seen.add(item.songId);
      selected.push(item);
      if (
        selected.filter((x) => x.algorithmMeta.sourceBucket === label).length >=
        target
      )
        break;
    }
  }

  pushBucket(personalized, personalizedTarget, "personalized");
  pushBucket(trending, trendingTarget, "trending");
  pushBucket(discovery, discoveryTarget, "discovery");

  for (const item of filtered) {
    if (selected.length >= limit) break;
    if (seen.has(item.songId)) continue;
    seen.add(item.songId);
    selected.push(item);
  }

  const final: RankedFeedSong[] = [];
  for (const item of selected) {
    const db = diversityBoost(
      candidates.find((c) => c.id === item.songId)!,
      final,
      profile,
    );
    item.scoreBreakdown.diversityBoost = Number(db.toFixed(4));
    item.scoreBreakdown.finalScore = Number(
      (item.scoreBreakdown.finalScore * db).toFixed(4),
    );
    final.push(item);
  }

  final.sort(
    (a, b) => b.scoreBreakdown.finalScore - a.scoreBreakdown.finalScore,
  );

  const cachePayload = final.slice(0, limit);
  feedCache.set(cacheKey(userId, limit, sessionId), {
    songs: cachePayload,
    expiresAt: Date.now() + FEED_CACHE_TTL_MS,
  });

  return cachePayload;
}

export async function getForYouFeed(
  userId: string,
  options: ForYouOptions = {},
): Promise<RankedFeedSong[]> {
  const limit = clamp(safeNum(options.limit, 30), 1, 100);
  const key = cacheKey(userId, limit, options.sessionId ?? null);
  const cached = feedCache.get(key);

  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    return cached.songs;
  }

  const candidates = await fetchSongCandidates(MAX_CANDIDATES);
  return rankCandidates(userId, candidates, limit, options.sessionId ?? null);
}

export async function getForYouFeedResponse(
  userId: string,
  options: ForYouOptions = {},
): Promise<ForYouFeedResponse> {
  const limit = clamp(safeNum(options.limit, 30), 1, 100);
  const key = cacheKey(userId, limit, options.sessionId ?? null);
  const cached = feedCache.get(key);
  const cacheHit = Boolean(
    !options.bypassCache && cached && cached.expiresAt > Date.now(),
  );

  const songs = await getForYouFeed(userId, options);

  return {
    userId,
    limit,
    generatedAt: nowIso(),
    cacheHit,
    songs,
  };
}

export async function recordFeedInteraction(
  input: RecordInteractionInput,
): Promise<{ ok: true }> {
  const {
    userId,
    songId,
    watchTimeSeconds,
    totalDurationSeconds,
    sessionId = null,
    source = "feed",
    liked = false,
    shared = false,
    followed = false,
    replayed = false,
    skipped = false,
  } = input;

  const completionRate = clamp(
    ratio(watchTimeSeconds, Math.max(1, totalDurationSeconds)) * 100,
    0,
    100,
  );
  const skipRate = skipped ? clamp(100 - completionRate, 0, 100) : 0;
  const skipLatencySeconds = skipped
    ? clamp(watchTimeSeconds, 0, totalDurationSeconds)
    : 0;

  const { data: song } = await supabase
    .from("songs")
    .select("id,artist_id,genre,duration")
    .eq("id", songId)
    .maybeSingle();

  const row: UserBehaviorInsert = {
    user_id: userId,
    song_id: songId,
    artist_id: song?.artist_id ? String(song.artist_id) : null,
    genre: song?.genre ? String(song.genre) : null,
    watch_time_seconds: clamp(Math.floor(watchTimeSeconds), 0, 10_000),
    completion_rate: Number(completionRate.toFixed(4)),
    skip_rate: Number(skipRate.toFixed(4)),
    skip_latency_seconds: Number(skipLatencySeconds.toFixed(4)),
    liked,
    shared,
    followed,
    replayed,
    session_id: sessionId,
    source,
    created_at: nowIso(),
  };

  await supabase.from("user_behavior").insert(row);

  const { data: existingSongMetrics } = await supabase
    .from("song_behavior_metrics")
    .select(
      "song_id,total_events,total_watch_time_seconds,avg_completion_rate,avg_skip_rate,like_count,share_count,follow_count,replay_count,updated_at",
    )
    .eq("song_id", songId)
    .maybeSingle();

  if (existingSongMetrics) {
    const totalEvents = safeNum(existingSongMetrics.total_events, 0) + 1;
    const totalWatch =
      safeNum(existingSongMetrics.total_watch_time_seconds, 0) +
      row.watch_time_seconds;
    const avgCompletion =
      (safeNum(existingSongMetrics.avg_completion_rate, 0) * (totalEvents - 1) +
        row.completion_rate) /
      totalEvents;
    const avgSkip =
      (safeNum(existingSongMetrics.avg_skip_rate, 0) * (totalEvents - 1) +
        row.skip_rate) /
      totalEvents;

    await supabase
      .from("song_behavior_metrics")
      .update({
        total_events: totalEvents,
        total_watch_time_seconds: totalWatch,
        avg_completion_rate: Number(avgCompletion.toFixed(4)),
        avg_skip_rate: Number(avgSkip.toFixed(4)),
        like_count:
          safeNum(existingSongMetrics.like_count, 0) + (liked ? 1 : 0),
        share_count:
          safeNum(existingSongMetrics.share_count, 0) + (shared ? 1 : 0),
        follow_count:
          safeNum(existingSongMetrics.follow_count, 0) + (followed ? 1 : 0),
        replay_count:
          safeNum(existingSongMetrics.replay_count, 0) + (replayed ? 1 : 0),
        updated_at: nowIso(),
      })
      .eq("song_id", songId);
  } else {
    await supabase.from("song_behavior_metrics").insert({
      song_id: songId,
      total_events: 1,
      total_watch_time_seconds: row.watch_time_seconds,
      avg_completion_rate: row.completion_rate,
      avg_skip_rate: row.skip_rate,
      like_count: liked ? 1 : 0,
      share_count: shared ? 1 : 0,
      follow_count: followed ? 1 : 0,
      replay_count: replayed ? 1 : 0,
      updated_at: nowIso(),
    });
  }

  profileCache.delete(userId);

  for (const k of [...feedCache.keys()]) {
    if (k.startsWith(`${userId}|`)) feedCache.delete(k);
  }

  return { ok: true };
}

export async function precomputeForYouFeeds(
  userIds: string[],
  limit = 40,
): Promise<{ processed: number }> {
  const safeIds = [...new Set(userIds.filter(Boolean))].slice(0, 500);
  let processed = 0;
  for (const userId of safeIds) {
    await getForYouFeed(userId, { limit, bypassCache: true });
    processed += 1;
  }
  return { processed };
}
