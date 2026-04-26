import { countStreamsBySongSince } from "@/lib/supabase/aggregate-streams";
import type { Artist } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RisingArtist = Pick<
  Artist,
  "id" | "user_id" | "stage_name" | "bio" | "follower_count"
> & {
  rise_score: number;
  new_follows_7d: number;
  streams_7d: number;
  uploads_7d: number;
};

function aggregateIds(rows: { artist_id?: string }[] | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    const id = r.artist_id;
    if (!id) continue;
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

/**
 * Ranks artists by 7d follow velocity, listening bursts on their catalog, and fresh uploads.
 */
export async function fetchRisingArtists(
  supabase: SupabaseClient,
  limit = 20
): Promise<RisingArtist[]> {
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: followRows }, { data: streamRows }, { data: uploadRows }] =
    await Promise.all([
      supabase
        .from("artist_follows")
        .select("artist_id")
        .gte("created_at", since7)
        .limit(8000),
      supabase
        .from("streams")
        .select("song_id")
        .gte("created_at", since7)
        .limit(12000),
      supabase
        .from("songs")
        .select("artist_id")
        .gte("created_at", since7)
        .limit(4000),
    ]);

  const followsMap = aggregateIds(followRows ?? []);
  const uploadsMap = aggregateIds(uploadRows ?? []);

  const songIds = [...new Set((streamRows ?? []).map((r) => r.song_id).filter(Boolean))] as string[];
  const streamsBySong = await countStreamsBySongSince(supabase, songIds, since7);

  const songArtist = new Map<string, string>();
  if (songIds.length) {
    const chunk = 120;
    for (let i = 0; i < songIds.length; i += chunk) {
      const part = songIds.slice(i, i + chunk);
      const { data: songs } = await supabase
        .from("songs")
        .select("id, artist_id")
        .in("id", part);
      for (const row of songs ?? []) {
        if (row.id && row.artist_id) songArtist.set(row.id, row.artist_id);
      }
    }
  }

  const streamsByArtist = new Map<string, number>();
  for (const [sid, c] of streamsBySong) {
    const aid = songArtist.get(sid);
    if (!aid) continue;
    streamsByArtist.set(aid, (streamsByArtist.get(aid) ?? 0) + c);
  }

  const artistIds = new Set<string>();
  for (const id of followsMap.keys()) artistIds.add(id);
  for (const id of uploadsMap.keys()) artistIds.add(id);
  for (const id of streamsByArtist.keys()) artistIds.add(id);

  if (!artistIds.size) {
    const { data: fallback } = await supabase
      .from("artists")
      .select("id, user_id, stage_name, bio, follower_count")
      .order("follower_count", { ascending: false })
      .limit(limit);
    return (fallback ?? []).map((a) => ({
      ...a,
      rise_score: Math.log10((a.follower_count ?? 0) + 1) * 4,
      new_follows_7d: 0,
      streams_7d: 0,
      uploads_7d: 0,
    }));
  }

  const scored = [...artistIds].map((id) => {
    const f = followsMap.get(id) ?? 0;
    const s = streamsByArtist.get(id) ?? 0;
    const u = uploadsMap.get(id) ?? 0;
    const rise_score = f * 4.0 + s * 0.35 + u * 6.0;
    return { id, rise_score, new_follows_7d: f, streams_7d: s, uploads_7d: u };
  });

  scored.sort((a, b) => b.rise_score - a.rise_score);
  const top = scored.slice(0, limit);

  const { data: artists } = await supabase
    .from("artists")
    .select("id, user_id, stage_name, bio, follower_count")
    .in(
      "id",
      top.map((t) => t.id)
    );

  const byId = new Map((artists ?? []).map((a) => [a.id, a]));

  return top
    .map((t) => {
      const base = byId.get(t.id);
      if (!base) return null;
      return {
        ...base,
        rise_score: t.rise_score + Math.log10((base.follower_count ?? 0) + 1) * 2,
        new_follows_7d: t.new_follows_7d,
        streams_7d: t.streams_7d,
        uploads_7d: t.uploads_7d,
      };
    })
    .filter(Boolean) as RisingArtist[];
}
