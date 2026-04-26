import { SupportArtistButton } from "@/components/paypal/support-artist-button";
import { SongCard } from "@/components/song/song-card";
import { createClient } from "@/lib/supabase/server";
import type { Artist, Song } from "@/types/database";
import { ArtistActions } from "./ui";

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function ArtistPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: artistRow } = await supabase
    .from("artists")
    .select("id, user_id, stage_name, bio, follower_count, total_earnings")
    .eq("id", id)
    .maybeSingle();

  const artist = artistRow as Artist | null;

  if (!artist) {
    return <p className="text-zinc-500">Artist not found.</p>;
  }

  const { data: songsRaw } = await supabase
    .from("songs")
    .select(
      "id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, artist:artists(id, stage_name, user_id)",
    )
    .eq("artist_id", id)
    .order("stream_count", { ascending: false });

  const songs = (songsRaw ?? []) as unknown as Song[];

  return (
    <div className="space-y-8">
      <header className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-xs uppercase tracking-widest text-violet-300">
          Artist
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          {artist.stage_name}
        </h1>
        {artist.bio ? (
          <p className="mt-3 max-w-2xl text-sm text-zinc-400">{artist.bio}</p>
        ) : null}
        <p className="mt-4 text-xs text-zinc-500">
          {artist.follower_count} followers · {songs.length} tracks
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SupportArtistButton
            artistId={artist.id}
            artistName={artist.stage_name}
          />
        </div>
        <ArtistActions
          artistId={artist.id}
          initialFollowerCount={artist.follower_count}
        />
      </header>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">Music</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {songs.length === 0 ? (
            <p className="text-sm text-zinc-500">No uploads yet.</p>
          ) : (
            songs.map((s) => <SongCard key={s.id} song={s} queue={songs} />)
          )}
        </div>
      </section>
    </div>
  );
}
