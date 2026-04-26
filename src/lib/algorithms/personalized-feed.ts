import { fetchTrendingSongs } from "@/lib/algorithms/trending";
import type { Song } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

const SONG_SELECT =
  "id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count, artist:artists(id, stage_name, user_id)";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function takeUnique(songs: Song[], cap: number, seen: Set<string>): Song[] {
  const out: Song[] = [];
  for (const s of songs) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Lightweight personalization: genres from likes, history from streams, artists from follows.
 * ~60% affinity-matched, ~40% discovery (trending mix).
 */
export async function fetchPersonalizedFeed(
  supabase: SupabaseClient,
  userId: string,
  limit = 40,
): Promise<Song[]> {
  const similarTarget = Math.ceil(limit * 0.6);
  const discoveryTarget = Math.max(0, limit - similarTarget);

  const [{ data: likeRows }, { data: plays }, { data: follows }] =
    await Promise.all([
      supabase
        .from("song_likes")
        .select("song_id")
        .eq("user_id", userId)
        .limit(400),
      supabase
        .from("streams")
        .select("song_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("artist_follows")
        .select("artist_id")
        .eq("user_id", userId)
        .limit(200),
    ]);

  const safePlays = plays ?? [];

  const likedSongIds = [
    ...new Set((likeRows ?? []).map((r) => r.song_id).filter(Boolean)),
  ] as string[];

  const genres = new Set<string>();
  if (likedSongIds.length) {
    const { data: likedSongs } = await supabase
      .from("songs")
      .select("genre")
      .in("id", likedSongIds.slice(0, 200));
    for (const row of likedSongs ?? []) {
      if (row.genre) genres.add(row.genre);
    }
  }

  const playedIds = [
    ...new Set((safePlays ?? []).map((p) => p.song_id).filter(Boolean)),
  ] as string[];
  const followedArtistIds = [
    ...new Set((follows ?? []).map((f) => f.artist_id).filter(Boolean)),
  ] as string[];

  const playedGenres = new Set<string>();
  if (playedIds.length) {
    const { data: playedSongs } = await supabase
      .from("songs")
      .select("genre")
      .in("id", playedIds.slice(0, 120));
    for (const r of playedSongs ?? []) {
      if (r.genre) playedGenres.add(r.genre);
    }
  }

  for (const g of playedGenres) genres.add(g);

  const seen = new Set<string>();
  const similarPool: Song[] = [];

  if (genres.size) {
    const genreList = [...genres];
    const { data: byGenre } = await supabase
      .from("songs")
      .select(SONG_SELECT)
      .in("genre", genreList)
      .order("stream_count", { ascending: false })
      .limit(120);
    similarPool.push(...((byGenre ?? []) as unknown as Song[]));
  }

  if (followedArtistIds.length) {
    const { data: byArtist } = await supabase
      .from("songs")
      .select(SONG_SELECT)
      .in("artist_id", followedArtistIds)
      .order("created_at", { ascending: false })
      .limit(80);
    similarPool.push(...((byArtist ?? []) as unknown as Song[]));
  }

  const similar = takeUnique(shuffle(similarPool), similarTarget, seen);

  const trending = await fetchTrendingSongs(
    supabase,
    Math.max(discoveryTarget * 2, 24),
    260,
  );
  const discovery = takeUnique(shuffle(trending), discoveryTarget, seen);

  const merged = shuffle([...similar, ...discovery]);
  return merged.slice(0, limit);
}
