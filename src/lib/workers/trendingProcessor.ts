import { createClient } from "@supabase/supabase-js";
import { Decimal } from "decimal.js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key";
const supabase = createClient(supabaseUrl, supabaseKey);

export interface TrendingScoreData {
  songId: string;
  plays24h: number;
  likes: number;
  completionRate: number;
  shares: number;
  daysSinceUpload: number;
  baseScore: number;
  boostedScore: number;
  updatedAt: string;
}

type TrendingScoreCacheRow = {
  song_id: string;
  base_score: number;
  boosted_score: number;
  plays_24h: number;
  likes: number;
  completion_rate: number;
  shares: number;
  updated_at: string;
};

function calculateDaysSinceUpload(uploadedAt: string): number {
  const now = new Date();
  const uploadDate = new Date(uploadedAt);
  const diffMs = now.getTime() - uploadDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function calculateBaseScore(
  plays24h: number,
  likes: number,
  completionRate: number,
  shares: number
): number {
  const playsScore = plays24h * 0.4;
  const likesScore = likes * 0.25;
  const completionScore = completionRate * 0.2;
  const sharesScore = shares * 0.15;

  return playsScore + likesScore + completionScore + sharesScore;
}

function applyNewSongBoost(
  baseScore: number,
  daysSinceUpload: number
): number {
  if (daysSinceUpload < 7) {
    return baseScore * 1.3;
  }
  return baseScore;
}

export async function calculateTrendingScore(songId: string): Promise<TrendingScoreData | null> {
  try {
    // Get song info
    const { data: song, error: songError } = await supabase
      .from("songs")
      .select("uploaded_at")
      .eq("id", songId)
      .single();

    if (songError || !song) return null;

    // Get stream metrics
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { data: streams } = await supabase
      .from("streams")
      .select("seconds_played")
      .eq("song_id", songId)
      .gte("created_at", yesterday.toISOString());

    const plays24h = streams?.length || 0;
    const completionRate = streams
      ? Math.min(streams.reduce((sum, s) => sum + s.seconds_played, 0) / streams.length / 180, 1)
      : 0;

    // Get engagement metrics
    const { data: metrics } = await supabase
      .from("song_metrics")
      .select("likes, shares")
      .eq("song_id", songId)
      .single();

    const likes = metrics?.likes || 0;
    const shares = metrics?.shares || 0;

    // Calculate days since upload
    const daysSinceUpload = calculateDaysSinceUpload(song.uploaded_at);

    // Calculate scores
    const baseScore = calculateBaseScore(plays24h, likes, completionRate, shares);
    const boostedScore = applyNewSongBoost(baseScore, daysSinceUpload);

    return {
      songId,
      plays24h,
      likes,
      completionRate,
      shares,
      daysSinceUpload,
      baseScore,
      boostedScore,
      updatedAt: now.toISOString(),
    };
  } catch (err) {
    console.error(`Error calculating trending score for song ${songId}:`, err);
    return null;
  }
}

export async function batchRecalculateTrendingScores(): Promise<void> {
  try {
    // Get all songs
    const { data: songs, error } = await supabase
      .from("songs")
      .select("id")
      .limit(10000);

    if (error || !songs) return;

    // Calculate scores for each song
    const scores: TrendingScoreCacheRow[] = [];
    for (const song of songs) {
      const score = await calculateTrendingScore(song.id);
      if (score) {
        scores.push({
          song_id: score.songId,
          base_score: score.baseScore,
          boosted_score: score.boostedScore,
          plays_24h: score.plays24h,
          likes: score.likes,
          completion_rate: score.completionRate,
          shares: score.shares,
          updated_at: score.updatedAt,
        });
      }
    }

    // Upsert into cache
    if (scores.length > 0) {
      await supabase
        .from("trending_scores_cache")
        .upsert(scores, { onConflict: "song_id" });
    }
  } catch (err) {
    console.error("Error batch recalculating trending scores:", err);
  }
}

export async function getTrendingSongs(limit: number = 50): Promise<TrendingScoreCacheRow[]> {
  try {
    const { data, error } = await supabase
      .from("trending_scores_cache")
      .select("*")
      .order("boosted_score", { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function getTrendingNewSongs(limit: number = 30): Promise<TrendingScoreCacheRow[]> {
  try {
    const { data, error } = await supabase
      .from("trending_scores_cache")
      .select("*")
      .lte("days_since_upload", 7)
      .order("boosted_score", { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function updateMicroTrendingScore(
  songId: string,
  delta: Decimal
): Promise<void> {
  try {
    // Get current score
    const { data: current } = await supabase
      .from("trending_scores_cache")
      .select("boosted_score")
      .eq("song_id", songId)
      .single();

    if (!current) return;

    const newScore = new Decimal(current.boosted_score).plus(delta);

    // Update cache
    await supabase
      .from("trending_scores_cache")
      .update({
        boosted_score: newScore.toString(),
        updated_at: new Date().toISOString(),
      })
      .eq("song_id", songId);
  } catch (err) {
    console.error(`Error updating micro trending score for ${songId}:`, err);
  }
}

export async function cacheInvalidate(songId: string): Promise<void> {
  try {
    const score = await calculateTrendingScore(songId);
    if (score) {
      await supabase.from("trending_scores_cache").upsert({
        song_id: score.songId,
        base_score: score.baseScore,
        boosted_score: score.boostedScore,
        plays_24h: score.plays24h,
        likes: score.likes,
        completion_rate: score.completionRate,
        shares: score.shares,
        updated_at: score.updatedAt,
      });
    }
  } catch (err) {
    console.error(`Error cache invalidating for ${songId}:`, err);
  }
}
