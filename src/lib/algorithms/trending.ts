import { countStreamsBySongSince } from "@/lib/supabase/aggregate-streams";
import type { Song } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TrendingSong = Song & {
  trending_score: number;
  plays_24h: number;
  plays_7d: number;
};

const SONG_SELECT =
  "id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count, artist:artists(id, stage_name, user_id, follower_count)";

export type TrendingInputs = {
  stream_count: number;
  likes_count: number;
  shares_count: number;
  recent_plays_24h: number;
  /** Plays in the 7d window excluding the last 24h (so 24h is not double-counted in the weekly signal). */
  recent_plays_7d_excl_24h: number;
  follower_boost: number;
};

/**
 * Lightweight trending score — favors recent listening bursts and engagement.
 */
export function computeTrendingScore(input: TrendingInputs): number {
  const weeklyTail = Math.max(0, input.recent_plays_7d_excl_24h);
  return (
    input.stream_count * 1.0 +
    input.likes_count * 2.0 +
    input.recent_plays_24h * 3.0 +
    weeklyTail * 1.0 +
    input.follower_boost +
    input.shares_count * 1.5
  );
}

function followerBoost(followers: number): number {
  return Math.log10(Math.max(0, followers) + 1) * 6;
}

/**
 * Server-side trending: pulls a candidate pool, aggregates streams for 24h/7d, scores, sorts.
 */
export async function fetchTrendingSongs(
  supabase: SupabaseClient,
  limit = 40,
  candidatePool = 320
): Promise<TrendingSong[]> {
  const now = Date.now();
  const since24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: raw, error } = await supabase
    .from("songs")
    .select(SONG_SELECT)
    .order("stream_count", { ascending: false })
    .limit(candidatePool);

  if (error || !raw?.length) return [];

  const songs = raw as unknown as (Song & {
    artist?: Song["artist"] & { follower_count?: number };
    shares_count?: number;
  })[];

  const ids = songs.map((s) => s.id);
  const plays24 = await countStreamsBySongSince(supabase, ids, since24);
  const plays7 = await countStreamsBySongSince(supabase, ids, since7);

  const scored: TrendingSong[] = songs.map((s) => {
    const p24 = plays24.get(s.id) ?? 0;
    const p7 = plays7.get(s.id) ?? 0;
    const p7excl = Math.max(0, p7 - p24);
    const a = s.artist;
    const followers = Array.isArray(a)
      ? (a[0] as { follower_count?: number })?.follower_count ?? 0
      : (a as { follower_count?: number } | undefined)?.follower_count ?? 0;

    const score = computeTrendingScore({
      stream_count: s.stream_count,
      likes_count: s.likes_count,
      shares_count: s.shares_count ?? 0,
      recent_plays_24h: p24,
      recent_plays_7d_excl_24h: p7excl,
      follower_boost: followerBoost(followers),
    });

    return {
      ...(s as Song),
      trending_score: score,
      plays_24h: p24,
      plays_7d: p7,
    };
  });

  scored.sort((a, b) => b.trending_score - a.trending_score);
  return scored.slice(0, limit);
}

export async function fetchTrendingScoreForSong(
  supabase: SupabaseClient,
  songId: string
): Promise<{ song: TrendingSong | null }> {
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: raw, error } = await supabase
    .from("songs")
    .select(SONG_SELECT)
    .eq("id", songId)
    .maybeSingle();

  if (error || !raw) return { song: null };

  const s = raw as unknown as Song & {
    artist?: Song["artist"] & { follower_count?: number };
    shares_count?: number;
  };

  const plays24 = await countStreamsBySongSince(supabase, [songId], since24);
  const plays7 = await countStreamsBySongSince(supabase, [songId], since7);
  const p24 = plays24.get(songId) ?? 0;
  const p7 = plays7.get(songId) ?? 0;
  const p7excl = Math.max(0, p7 - p24);
  const a = s.artist;
  const followers = Array.isArray(a)
    ? (a[0] as { follower_count?: number })?.follower_count ?? 0
    : (a as { follower_count?: number } | undefined)?.follower_count ?? 0;

  const trending_score = computeTrendingScore({
    stream_count: s.stream_count,
    likes_count: s.likes_count,
    shares_count: s.shares_count ?? 0,
    recent_plays_24h: p24,
    recent_plays_7d_excl_24h: p7excl,
    follower_boost: followerBoost(followers),
  });

  return {
    song: {
      ...(s as Song),
      trending_score,
      plays_24h: p24,
      plays_7d: p7,
    },
  };
}
