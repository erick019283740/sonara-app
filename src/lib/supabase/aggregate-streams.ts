import type { SupabaseClient } from "@supabase/supabase-js";

const CHUNK = 90;

/** Count stream rows per song_id since `sinceIso` (inclusive). */
export async function countStreamsBySongSince(
  supabase: SupabaseClient,
  songIds: string[],
  sinceIso: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!songIds.length) return counts;

  for (let i = 0; i < songIds.length; i += CHUNK) {
    const chunk = songIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("streams")
      .select("song_id")
      .in("song_id", chunk)
      .gte("created_at", sinceIso);

    if (error) continue;
    for (const row of data ?? []) {
      const sid = row.song_id as string;
      counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
  }

  return counts;
}
