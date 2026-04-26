import { SongCard } from "@/components/song/song-card";
import { ShareSongButton } from "@/components/song/share-song-button";import { SupportArtistButton } from "@/components/paypal/support-artist-button";import { fetchRelatedSongs } from "@/lib/algorithms/related-songs";
import { fetchTrendingScoreForSong } from "@/lib/algorithms/trending";
import {
  computePlayToShareRatio,
  computeViralMomentum,
  isHotTrending,
} from "@/lib/analytics/viral-score";
import { createClient } from "@/lib/supabase/server";
import type { Song } from "@/types/database";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

function stageName(song: Song) {
  const a = song.artist;
  if (!a) return "Artist";
  if (Array.isArray(a)) return a[0]?.stage_name ?? "Artist";
  return a.stage_name;
}

export default async function SongPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: raw, error } = await supabase
    .from("songs")
    .select(
      "id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count, external_click_count, artist:artists(id, stage_name, user_id, follower_count)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !raw) notFound();

  const song = raw as unknown as Song & {
    artist?: Song["artist"] & { follower_count?: number };
  };

  const [{ song: scored }, related] = await Promise.all([
    fetchTrendingScoreForSong(supabase, id),
    fetchRelatedSongs(supabase, id, 12),
  ]);

  const trendScore = scored?.trending_score ?? 0;
  const a = song.artist;
  const followers = Array.isArray(a)
    ? (a[0] as { follower_count?: number })?.follower_count ?? 0
    : (a as { follower_count?: number } | undefined)?.follower_count ?? 0;
  const followerBoost = Math.log10(Math.max(0, followers) + 1) * 6;

  const viral = computeViralMomentum({
    stream_count: song.stream_count,
    likes_count: song.likes_count,
    shares_count: song.shares_count ?? 0,
    external_click_count: song.external_click_count ?? 0,
    plays_24h: scored?.plays_24h ?? 0,
    plays_7d_excl_24h: Math.max(0, (scored?.plays_7d ?? 0) - (scored?.plays_24h ?? 0)),
    follower_boost: followerBoost,
  });

  const playShare = computePlayToShareRatio(song.stream_count, song.shares_count ?? 0);

  const queue = [song, ...related];

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="relative mx-auto h-56 w-56 shrink-0 overflow-hidden rounded-3xl bg-zinc-800 md:mx-0">
          {song.cover_url ? (
            <Image
              src={song.cover_url}
              alt={song.title}
              fill
              className="object-cover"
              sizes="224px"
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-5xl text-zinc-600">
              ♪
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold text-white">{song.title}</h1>
            {isHotTrending(trendScore) && (
              <span className="rounded-full bg-orange-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-200">
                Trending now
              </span>
            )}
          </div>
          <p className="text-zinc-400">
            <Link href={`/artist/${song.artist_id}`} className="text-violet-300 hover:underline">
              {stageName(song)}
            </Link>
            <span className="text-zinc-600"> · </span>
            <span>{song.genre}</span>
          </p>
          <p className="text-xs text-zinc-500">
            {song.stream_count.toLocaleString()} streams · {song.likes_count.toLocaleString()} likes
            {(song.shares_count ?? 0) > 0 && (
              <>
                {" "}
                · {(song.shares_count ?? 0).toLocaleString()} shares
              </>
            )}
          </p>
          <p className="text-[11px] text-zinc-500">
            Trending score: {trendScore.toFixed(1)} · Viral momentum: {viral.toFixed(1)} ·
            Play/share: {playShare.toFixed(3)}
          </p>
          <div className="flex gap-3 pt-4">
            <ShareSongButton songId={song.id} title={song.title} />
            <SupportArtistButton artistId={song.artist_id} artistName={stageName(song)} />
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">Play</h2>
        <SongCard song={song} queue={queue} trendingScore={trendScore} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-white">More like this</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Same genre &amp; similar popularity — discover the next track.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {related.length === 0 ? (
            <p className="text-sm text-zinc-500">No related songs yet.</p>
          ) : (
            related.map((s) => <SongCard key={s.id} song={s} queue={related} />)
          )}
        </div>
      </section>
    </div>
  );
}
