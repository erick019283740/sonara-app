import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type SharePlatform = "tiktok" | "instagram" | "whatsapp" | "x" | "other";
export type ConversionType = "signup" | "stream" | "follow" | "support";

export interface ShareLinkResult {
  shareId: string;
  shareToken: string;
  shareUrl: string;
  platform: SharePlatform;
  songId: string;
  artistId: string | null;
  createdAt: string;
}

export interface ShareConversionResult {
  ok: boolean;
  shareId?: string;
  conversionId?: string;
  songId?: string;
  viralScoreIncrement?: number;
  deduplicated?: boolean;
  error?: string;
}

export interface UseBoostInput {
  artistUserId: string;
  songId: string;
  credits?: number;
}

export interface UseBoostResult {
  ok: boolean;
  artistId?: string;
  songId?: string;
  creditsUsed?: number;
  dailyUsed?: number;
  error?: string;
}

export interface DashboardSongMetric {
  songId: string;
  title: string;
  streamCount: number;
  likesCount: number;
  sharesCount: number;
  viralScore: number;
  shareBoostScore: number;
  createdAt: string;
}

export interface CreatorDashboardResult {
  artistId: string;
  artistUserId: string;
  stageName: string;
  totalFollowers: number;
  totalEarnings: number;
  earnings30d: number;
  streams30d: number;
  shares30d: number;
  avgViralScore: number;
  topSongViralScore: number;
  songs: DashboardSongMetric[];
  followerGrowth30d: number;
  dailyMetrics: Array<{
    date: string;
    streamsCount: number;
    uniqueListeners: number;
    followersGained: number;
    totalEarnings: number;
    sharesCount: number;
    conversionsCount: number;
    viralScoreAvg: number;
  }>;
}

export interface RetentionResult {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  streakIncreased: boolean;
}

export interface FollowResult {
  ok: boolean;
  followerUserId: string;
  followedUserId: string;
  createdAt?: string;
  deleted?: boolean;
}

export interface LeaderboardEntry {
  leaderboardDate: string;
  rank: number;
  artistId: string;
  stageName: string;
  score: number;
  streamsCount: number;
  followersGained: number;
  earningsAmount: number;
}

export interface BatchMetricsResult {
  processedArtists: number;
  processedSongs: number;
  leaderboardDate: string;
  completedAt: string;
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type EmptyQueryResult<T> = { data: T[]; error: null };

const CACHE_TTL_DASHBOARD_MS = 30_000;
const CACHE_TTL_LEADERBOARD_MS = 20_000;
const DEFAULT_SHARE_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://sonara.app";
const DEFAULT_DASHBOARD_SONG_LIMIT = 50;
const DEFAULT_LEADERBOARD_LIMIT = 50;

class GrowthService {
  private readonly dashboardCache = new Map<string, CacheEntry<CreatorDashboardResult>>();
  private readonly leaderboardCache = new Map<string, CacheEntry<LeaderboardEntry[]>>();

  async createShareLink(params: {
    userId?: string;
    artistId?: string | null;
    songId: string;
    platform: SharePlatform;
    campaign?: string;
    expiresInDays?: number;
  }): Promise<ShareLinkResult> {
    const admin = createAdminClient();
    const shareToken = this.generateShareToken();
    const shareUrl = this.buildShareUrl(shareToken, params.songId, params.platform, params.campaign);
    const expiresAt =
      typeof params.expiresInDays === "number" && params.expiresInDays > 0
        ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

    const { data, error } = await admin
      .from("share_tracking")
      .insert({
        user_id: params.userId ?? null,
        artist_id: params.artistId ?? null,
        song_id: params.songId,
        platform: params.platform,
        share_token: shareToken,
        share_url: shareUrl,
        campaign: params.campaign ?? null,
        expires_at: expiresAt,
      })
      .select("id, share_token, share_url, platform, song_id, artist_id, created_at")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create share link: ${error?.message ?? "unknown"}`);
    }

    return {
      shareId: data.id as string,
      shareToken: data.share_token as string,
      shareUrl: data.share_url as string,
      platform: data.platform as SharePlatform,
      songId: data.song_id as string,
      artistId: (data.artist_id as string | null) ?? null,
      createdAt: data.created_at as string,
    };
  }

  async trackShareConversion(params: {
    shareToken: string;
    newUserId?: string | null;
    conversionType?: ConversionType;
  }): Promise<ShareConversionResult> {
    const admin = createAdminClient();

    const { data, error } = await admin.rpc("record_share_conversion", {
      p_share_token: params.shareToken,
      p_new_user_id: params.newUserId ?? null,
      p_conversion_type: params.conversionType ?? "signup",
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    const result = (data ?? {}) as {
      ok?: boolean;
      share_id?: string;
      conversion_id?: string;
      song_id?: string;
      viral_score_increment?: number;
      deduplicated?: boolean;
      error?: string;
    };

    return {
      ok: Boolean(result.ok),
      shareId: result.share_id,
      conversionId: result.conversion_id,
      songId: result.song_id,
      viralScoreIncrement: result.viral_score_increment,
      deduplicated: Boolean(result.deduplicated),
      error: result.error,
    };
  }

  async useBoostCredits(input: UseBoostInput): Promise<UseBoostResult> {
    const admin = createAdminClient();
    const credits = Math.max(1, Math.floor(input.credits ?? 1));

    const artistId = await this.getArtistIdByUserId(input.artistUserId);
    if (!artistId) {
      return { ok: false, error: "artist_not_found" };
    }

    const { data, error } = await admin.rpc("consume_artist_boost", {
      p_artist_id: artistId,
      p_song_id: input.songId,
      p_credits: credits,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    const result = (data ?? {}) as {
      ok?: boolean;
      artist_id?: string;
      song_id?: string;
      credits_used?: number;
      daily_used?: number;
      error?: string;
    };

    return {
      ok: Boolean(result.ok),
      artistId: result.artist_id,
      songId: result.song_id,
      creditsUsed: result.credits_used,
      dailyUsed: result.daily_used,
      error: result.error,
    };
  }

  async applyBoostExposureForSongs(songIds: string[]): Promise<Record<string, number>> {
    if (!songIds.length) return {};
    const admin = createAdminClient();

    const nowIso = new Date().toISOString();
    const { data: boosts, error: boostErr } = await admin
      .from("song_boosts")
      .select("song_id, exposure_multiplier, decay_factor, starts_at, ends_at")
      .in("song_id", songIds)
      .lte("starts_at", nowIso)
      .gte("ends_at", nowIso);

    if (boostErr) {
      throw new Error(`Failed to load active boosts: ${boostErr.message}`);
    }

    const exposureBySong: Record<string, number> = {};
    const activeBoosts = (boosts ?? []) as Array<{
      song_id: string;
      exposure_multiplier: number;
      decay_factor: number;
      starts_at: string;
      ends_at: string;
    }>;

    for (const songId of songIds) {
      exposureBySong[songId] = 1;
    }

    for (const b of activeBoosts) {
      const starts = new Date(b.starts_at).getTime();
      const ends = new Date(b.ends_at).getTime();
      const now = Date.now();
      const total = Math.max(1, ends - starts);
      const elapsed = Math.max(0, Math.min(total, now - starts));
      const progress = elapsed / total;

      const base = Number(b.exposure_multiplier ?? 1);
      const decay = Number(b.decay_factor ?? 0.7);

      const dynamic = Math.max(1, base * (1 - progress * (1 - decay)));
      exposureBySong[b.song_id] = Math.max(exposureBySong[b.song_id] ?? 1, Number(dynamic.toFixed(4)));
    }

    return exposureBySong;
  }

  async followUser(params: { followerUserId: string; followedUserId: string }): Promise<FollowResult> {
    if (params.followerUserId === params.followedUserId) {
      throw new Error("Cannot follow yourself");
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("user_follows")
      .insert({
        follower_user_id: params.followerUserId,
        followed_user_id: params.followedUserId,
      })
      .select("follower_user_id, followed_user_id, created_at")
      .single();

    if (error || !data) {
      throw new Error(`Failed to follow user: ${error?.message ?? "unknown"}`);
    }

    return {
      ok: true,
      followerUserId: data.follower_user_id as string,
      followedUserId: data.followed_user_id as string,
      createdAt: data.created_at as string,
    };
  }

  async unfollowUser(params: { followerUserId: string; followedUserId: string }): Promise<FollowResult> {
    const admin = createAdminClient();
    const { error } = await admin
      .from("user_follows")
      .delete()
      .eq("follower_user_id", params.followerUserId)
      .eq("followed_user_id", params.followedUserId);

    if (error) {
      throw new Error(`Failed to unfollow user: ${error.message}`);
    }

    return {
      ok: true,
      followerUserId: params.followerUserId,
      followedUserId: params.followedUserId,
      deleted: true,
    };
  }

  async getFollowGraph(userId: string): Promise<{
    followers: string[];
    following: string[];
    followersCount: number;
    followingCount: number;
  }> {
    const admin = createAdminClient();
    const [followersRes, followingRes] = await Promise.all([
      admin
        .from("user_follows")
        .select("follower_user_id")
        .eq("followed_user_id", userId),
      admin
        .from("user_follows")
        .select("followed_user_id")
        .eq("follower_user_id", userId),
    ]);

    if (followersRes.error) {
      throw new Error(`Failed to fetch followers: ${followersRes.error.message}`);
    }
    if (followingRes.error) {
      throw new Error(`Failed to fetch following: ${followingRes.error.message}`);
    }

    const followers = (followersRes.data ?? []).map((r) => r.follower_user_id as string);
    const following = (followingRes.data ?? []).map((r) => r.followed_user_id as string);

    return {
      followers,
      following,
      followersCount: followers.length,
      followingCount: following.length,
    };
  }

  async updateDailyStreak(userId: string): Promise<RetentionResult> {
    const admin = createAdminClient();
    const today = this.toDateOnly(new Date());

    const { data: row, error: selErr } = await admin
      .from("user_retention_stats")
      .select("user_id, current_streak, longest_streak, last_active_date")
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) {
      throw new Error(`Failed to load retention stats: ${selErr.message}`);
    }

    const currentStreak = Number(row?.current_streak ?? 0);
    const longestStreak = Number(row?.longest_streak ?? 0);
    const lastActiveDate = (row?.last_active_date as string | null) ?? null;

    let nextStreak = currentStreak;
    let streakIncreased = false;

    if (!lastActiveDate) {
      nextStreak = 1;
      streakIncreased = true;
    } else if (lastActiveDate === today) {
      nextStreak = currentStreak;
    } else {
      const diffDays = this.diffDays(lastActiveDate, today);
      if (diffDays === 1) {
        nextStreak = currentStreak + 1;
        streakIncreased = true;
      } else {
        nextStreak = 1;
        streakIncreased = true;
      }
    }

    const nextLongest = Math.max(longestStreak, nextStreak);

    const { error: upErr } = await admin.from("user_retention_stats").upsert(
      {
        user_id: userId,
        current_streak: nextStreak,
        longest_streak: nextLongest,
        last_active_date: today,
      },
      { onConflict: "user_id" },
    );

    if (upErr) {
      throw new Error(`Failed to update retention stats: ${upErr.message}`);
    }

    return {
      userId,
      currentStreak: nextStreak,
      longestStreak: nextLongest,
      lastActiveDate: today,
      streakIncreased,
    };
  }

  async getCreatorDashboard(artistUserId: string, songsLimit = DEFAULT_DASHBOARD_SONG_LIMIT): Promise<CreatorDashboardResult> {
    const cacheKey = `${artistUserId}:${songsLimit}`;
    const cached = this.getCache(this.dashboardCache, cacheKey);
    if (cached) return cached;

    const admin = createAdminClient();

    const { data: dashboardRow, error: dashErr } = await admin
      .from("creator_dashboard_v")
      .select(
        "artist_id, artist_user_id, stage_name, total_followers, total_earnings, earnings_30d, streams_30d, shares_30d, avg_viral_score, top_song_viral_score",
      )
      .eq("artist_user_id", artistUserId)
      .maybeSingle();

    if (dashErr || !dashboardRow) {
      throw new Error(`Failed to fetch dashboard: ${dashErr?.message ?? "not_found"}`);
    }

    const artistId = dashboardRow.artist_id as string;

    const [songsRes, metricsRes, followsNowRes, followsPastRes] = await Promise.all([
      admin
        .from("songs")
        .select("id, title, stream_count, likes_count, shares_count, viral_score, share_boost_score, created_at")
        .eq("artist_id", artistId)
        .order("created_at", { ascending: false })
        .limit(Math.max(1, Math.floor(songsLimit))),
      admin
        .from("creator_daily_metrics")
        .select("metric_date, streams_count, unique_listeners, followers_gained, total_earnings, shares_count, conversions_count, viral_score_avg")
        .eq("artist_id", artistId)
        .gte("metric_date", this.toDateOnly(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
        .order("metric_date", { ascending: true }),
      admin
        .from("artist_follows")
        .select("id", { count: "exact", head: true })
        .eq("artist_id", artistId),
      admin
        .from("artist_follows")
        .select("id", { count: "exact", head: true })
        .eq("artist_id", artistId)
        .lt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    if (songsRes.error) throw new Error(`Failed to load songs: ${songsRes.error.message}`);
    if (metricsRes.error) throw new Error(`Failed to load daily metrics: ${metricsRes.error.message}`);
    if (followsNowRes.error) throw new Error(`Failed to load follower count: ${followsNowRes.error.message}`);
    if (followsPastRes.error) throw new Error(`Failed to load previous follower count: ${followsPastRes.error.message}`);

    const songs = (songsRes.data ?? []).map((s) => ({
      songId: s.id as string,
      title: s.title as string,
      streamCount: Number(s.stream_count ?? 0),
      likesCount: Number(s.likes_count ?? 0),
      sharesCount: Number(s.shares_count ?? 0),
      viralScore: Number(s.viral_score ?? 0),
      shareBoostScore: Number(s.share_boost_score ?? 0),
      createdAt: s.created_at as string,
    }));

    const dailyMetrics = (metricsRes.data ?? []).map((m) => ({
      date: m.metric_date as string,
      streamsCount: Number(m.streams_count ?? 0),
      uniqueListeners: Number(m.unique_listeners ?? 0),
      followersGained: Number(m.followers_gained ?? 0),
      totalEarnings: Number(m.total_earnings ?? 0),
      sharesCount: Number(m.shares_count ?? 0),
      conversionsCount: Number(m.conversions_count ?? 0),
      viralScoreAvg: Number(m.viral_score_avg ?? 0),
    }));

    const followerGrowth30d = Math.max(0, (followsNowRes.count ?? 0) - (followsPastRes.count ?? 0));

    const result: CreatorDashboardResult = {
      artistId,
      artistUserId: dashboardRow.artist_user_id as string,
      stageName: dashboardRow.stage_name as string,
      totalFollowers: Number(dashboardRow.total_followers ?? 0),
      totalEarnings: Number(dashboardRow.total_earnings ?? 0),
      earnings30d: Number(dashboardRow.earnings_30d ?? 0),
      streams30d: Number(dashboardRow.streams_30d ?? 0),
      shares30d: Number(dashboardRow.shares_30d ?? 0),
      avgViralScore: Number(dashboardRow.avg_viral_score ?? 0),
      topSongViralScore: Number(dashboardRow.top_song_viral_score ?? 0),
      songs,
      followerGrowth30d,
      dailyMetrics,
    };

    this.setCache(this.dashboardCache, cacheKey, result, CACHE_TTL_DASHBOARD_MS);
    return result;
  }

  async getLeaderboard(options?: {
    date?: string;
    limit?: number;
    bypassCache?: boolean;
  }): Promise<LeaderboardEntry[]> {
    const admin = createAdminClient();
    const date = options?.date ?? this.toDateOnly(new Date());
    const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? DEFAULT_LEADERBOARD_LIMIT)));
    const cacheKey = `${date}:${limit}`;

    if (!options?.bypassCache) {
      const cached = this.getCache(this.leaderboardCache, cacheKey);
      if (cached) return cached;
    }

    const { data, error } = await admin
      .from("artist_leaderboard_daily")
      .select("leaderboard_date, rank, artist_id, score, streams_count, followers_gained, earnings_amount, artists:artist_id(stage_name)")
      .eq("leaderboard_date", date)
      .order("rank", { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch leaderboard: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      leaderboard_date: string;
      rank: number;
      artist_id: string;
      score: number;
      streams_count: number;
      followers_gained: number;
      earnings_amount: number;
      artists?: { stage_name?: string } | { stage_name?: string }[] | null;
    }>;

    const result = rows.map((r) => ({
      leaderboardDate: r.leaderboard_date,
      rank: Number(r.rank ?? 0),
      artistId: r.artist_id,
      stageName: this.extractStageName(r.artists),
      score: Number(r.score ?? 0),
      streamsCount: Number(r.streams_count ?? 0),
      followersGained: Number(r.followers_gained ?? 0),
      earningsAmount: Number(r.earnings_amount ?? 0),
    }));

    this.setCache(this.leaderboardCache, cacheKey, result, CACHE_TTL_LEADERBOARD_MS);
    return result;
  }

  async runBatchedMetricUpdate(targetDate?: string): Promise<BatchMetricsResult> {
    const admin = createAdminClient();
    const date = targetDate ?? this.toDateOnly(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const startIso = `${date}T00:00:00.000Z`;
    const endIso = `${date}T23:59:59.999Z`;

    const { data: artists, error: artistsErr } = await admin
      .from("artists")
      .select("id");

    if (artistsErr) {
      throw new Error(`Failed to load artists: ${artistsErr.message}`);
    }

    const artistIds = (artists ?? []).map((a) => a.id as string);
    let processedSongs = 0;

    for (const artistId of artistIds) {
      const [songsRes, followsRes, earningsRes] = await Promise.all([
        admin
          .from("songs")
          .select("id, viral_score")
          .eq("artist_id", artistId),
        admin
          .from("artist_follows")
          .select("id", { count: "exact", head: true })
          .eq("artist_id", artistId)
          .gte("created_at", startIso)
          .lte("created_at", endIso),
        admin
          .from("earnings")
          .select("amount")
          .eq("artist_id", artistId)
          .gte("created_at", startIso)
          .lte("created_at", endIso),
      ]);

      if (songsRes.error) throw new Error(`Failed loading songs for ${artistId}: ${songsRes.error.message}`);
      if (followsRes.error) throw new Error(`Failed loading follows for ${artistId}: ${followsRes.error.message}`);
      if (earningsRes.error) throw new Error(`Failed loading earnings for ${artistId}: ${earningsRes.error.message}`);

      const songs = (songsRes.data ?? []) as Array<{ id: string; viral_score: number }>;
      const songIds = songs.map((s) => s.id);

      const [streamsRes, sharesRes, conversionsRes] = await Promise.all([
        songIds.length
          ? admin
              .from("streams")
              .select("song_id, user_id")
              .in("song_id", songIds)
              .gte("created_at", startIso)
              .lte("created_at", endIso)
          : Promise.resolve({
              data: [],
              error: null,
            } as EmptyQueryResult<{ song_id: string; user_id: string }>),
        songIds.length
          ? admin
              .from("share_tracking")
              .select("id, song_id")
              .in("song_id", songIds)
              .gte("created_at", startIso)
              .lte("created_at", endIso)
          : Promise.resolve({
              data: [],
              error: null,
            } as EmptyQueryResult<{ id: string; song_id: string }>),
        songIds.length
          ? admin
              .from("share_conversions")
              .select("id, share_id")
              .gte("converted_at", startIso)
              .lte("converted_at", endIso)
          : Promise.resolve({
              data: [],
              error: null,
            } as EmptyQueryResult<{ id: string; share_id: string }>),
      ]);

      if (streamsRes.error) throw new Error(`Failed loading streams for ${artistId}: ${streamsRes.error.message}`);
      if (sharesRes.error) throw new Error(`Failed loading shares for ${artistId}: ${sharesRes.error.message}`);
      if (conversionsRes.error) throw new Error(`Failed loading conversions for ${artistId}: ${conversionsRes.error.message}`);

      const streams = (streamsRes.data ?? []) as Array<{ song_id: string; user_id: string }>;
      const shares = (sharesRes.data ?? []) as Array<{ id: string; song_id: string }>;
      const conversions = (conversionsRes.data ?? []) as Array<{ id: string; share_id: string }>;

      const shareIds = new Set(shares.map((s) => s.id));
      const conversionsCount = conversions.filter((c) => shareIds.has(c.share_id)).length;

      const uniqueListeners = new Set(streams.map((s) => s.user_id)).size;
      const streamsCount = streams.length;
      const followersGained = followsRes.count ?? 0;
      const sharesCount = shares.length;
      const totalEarnings = (earningsRes.data ?? []).reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
      const avgViralScore =
        songs.length > 0
          ? songs.reduce((sum, s) => sum + Number(s.viral_score ?? 0), 0) / songs.length
          : 0;

      await admin.from("creator_daily_metrics").upsert(
        {
          artist_id: artistId,
          metric_date: date,
          streams_count: streamsCount,
          unique_listeners: uniqueListeners,
          followers_gained: followersGained,
          total_earnings: Number(totalEarnings.toFixed(4)),
          shares_count: sharesCount,
          conversions_count: conversionsCount,
          viral_score_avg: Number(avgViralScore.toFixed(6)),
        },
        { onConflict: "artist_id,metric_date" },
      );

      processedSongs += songs.length;
    }

    await this.rebuildLeaderboardForDate(date);

    this.dashboardCache.clear();
    this.leaderboardCache.clear();

    return {
      processedArtists: artistIds.length,
      processedSongs,
      leaderboardDate: date,
      completedAt: new Date().toISOString(),
    };
  }

  private async rebuildLeaderboardForDate(date: string): Promise<void> {
    const admin = createAdminClient();

    const { data: metrics, error } = await admin
      .from("creator_daily_metrics")
      .select("artist_id, streams_count, followers_gained, total_earnings, viral_score_avg")
      .eq("metric_date", date);

    if (error) {
      throw new Error(`Failed to build leaderboard metrics: ${error.message}`);
    }

    const rows = (metrics ?? []) as Array<{
      artist_id: string;
      streams_count: number;
      followers_gained: number;
      total_earnings: number;
      viral_score_avg: number;
    }>;

    const scored = rows
      .map((r) => ({
        artistId: r.artist_id,
        streamsCount: Number(r.streams_count ?? 0),
        followersGained: Number(r.followers_gained ?? 0),
        earningsAmount: Number(r.total_earnings ?? 0),
        score: this.computeLeaderboardScore({
          streams: Number(r.streams_count ?? 0),
          followers: Number(r.followers_gained ?? 0),
          earnings: Number(r.total_earnings ?? 0),
          viral: Number(r.viral_score_avg ?? 0),
        }),
      }))
      .sort((a, b) => b.score - a.score);

    await admin.from("artist_leaderboard_daily").delete().eq("leaderboard_date", date);

    if (!scored.length) return;

    await admin.from("artist_leaderboard_daily").insert(
      scored.map((row, index) => ({
        leaderboard_date: date,
        artist_id: row.artistId,
        rank: index + 1,
        score: Number(row.score.toFixed(6)),
        streams_count: row.streamsCount,
        followers_gained: row.followersGained,
        earnings_amount: Number(row.earningsAmount.toFixed(4)),
      })),
    );
  }

  private computeLeaderboardScore(input: {
    streams: number;
    followers: number;
    earnings: number;
    viral: number;
  }): number {
    return (
      input.streams * 0.35 +
      input.followers * 4.5 +
      input.earnings * 9 +
      input.viral * 2.2
    );
  }

  private async getArtistIdByUserId(userId: string): Promise<string | null> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("artists")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve artist: ${error.message}`);
    }

    return (data?.id as string | undefined) ?? null;
  }

  private generateShareToken(): string {
    return crypto
      .randomBytes(18)
      .toString("base64url")
      .replace(/[^A-Za-z0-9_-]/g, "");
  }

  private buildShareUrl(token: string, songId: string, platform: SharePlatform, campaign?: string): string {
    const url = new URL("/s", DEFAULT_SHARE_BASE_URL);
    url.searchParams.set("st", token);
    url.searchParams.set("song", songId);
    url.searchParams.set("p", platform);
    if (campaign?.trim()) url.searchParams.set("c", campaign.trim());
    return url.toString();
  }

  private toDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private diffDays(fromDate: string, toDate: string): number {
    const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
    const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
    return Math.floor((to - from) / (24 * 60 * 60 * 1000));
  }

  private getCache<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCache<T>(store: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  private extractStageName(
    artistsField?: { stage_name?: string } | { stage_name?: string }[] | null,
  ): string {
    if (!artistsField) return "Unknown Artist";
    if (Array.isArray(artistsField)) {
      return artistsField[0]?.stage_name || "Unknown Artist";
    }
    return artistsField.stage_name || "Unknown Artist";
  }
}

export const growthService = new GrowthService();
export default growthService;
