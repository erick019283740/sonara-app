import type { Song } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

const SONG_SELECT =
  "id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count, artist:artists(id, stage_name, user_id)";

/**
 * Related songs: same genre first, similar popularity band, same artist as tie-break.
 */
export async function fetchRelatedSongs(
  supabase: SupabaseClient,
  songId: string,
  limit = 12
): Promise<Song[]> {
  const { data: base, error } = await supabase
    .from("songs")
    .select("id, artist_id, genre, stream_count")
    .eq("id", songId)
    .maybeSingle();

  if (error || !base) return [];

  const genre = base.genre;
  const sc = base.stream_count ?? 0;
  const low = Math.max(0, Math.floor(sc * 0.25));
  const high = Math.max(low + 1, Math.ceil(sc * 4 + 5));

  const { data: sameGenre } = await supabase
    .from("songs")
    .select(SONG_SELECT)
    .eq("genre", genre)
    .neq("id", songId)
    .gte("stream_count", low)
    .lte("stream_count", high)
    .order("stream_count", { ascending: false })
    .limit(limit);

  const out = (sameGenre ?? []) as unknown as Song[];
  if (out.length >= limit) return out.slice(0, limit);

  const { data: sameArtist } = await supabase
    .from("songs")
    .select(SONG_SELECT)
    .eq("artist_id", base.artist_id)
    .neq("id", songId)
    .order("stream_count", { ascending: false })
    .limit(limit);

  const merged: Song[] = [...out];
  const seen = new Set(merged.map((s) => s.id));
  for (const s of (sameArtist ?? []) as unknown as Song[]) {
    if (seen.has(s.id)) continue;
    merged.push(s);
    seen.add(s.id);
    if (merged.length >= limit) break;
  }

  if (merged.length >= limit) return merged.slice(0, limit);

  const { data: fill } = await supabase
    .from("songs")
    .select(SONG_SELECT)
    .neq("id", songId)
    .order("likes_count", { ascending: false })
    .limit(limit * 2);

  for (const s of (fill ?? []) as unknown as Song[]) {
    if (seen.has(s.id)) continue;
    merged.push(s);
    seen.add(s.id);
    if (merged.length >= limit) break;
  }

  return merged.slice(0, limit);
}
