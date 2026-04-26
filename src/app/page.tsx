import { SongCard } from "@/components/song/song-card";
import { createClient } from "@/lib/supabase/server";
import type { Song } from "@/types/database";
import Link from "next/link";

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: raw } = await supabase
    .from("songs")
    .select(
      "id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, artist:artists(id, stage_name, user_id)"
    )
    .order("stream_count", { ascending: false })
    .limit(16);

  const songs = (raw ?? []) as unknown as Song[];

  return (
    <div className="space-y-10">
      <section className="rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-950/50 to-zinc-900 p-8 md:p-12">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-300">
          Independent music
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-white md:text-4xl">
          SONARA helps small artists earn from streams, fans, and discovery.
        </h1>
        <p className="mt-4 max-w-xl text-sm text-zinc-400">
          70/30 on streams, direct donations with a 90/10 artist split, and tools to grow your
          audience — built on Supabase and Next.js.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/explore"
            className="rounded-full bg-white px-6 py-2.5 text-sm font-medium text-zinc-900"
          >
            Explore
          </Link>
          <Link
            href="/register"
            className="rounded-full border border-white/20 px-6 py-2.5 text-sm text-white hover:bg-white/5"
          >
            Create account
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">Trending</h2>
          <Link href="/explore" className="text-xs text-violet-300 hover:underline">
            See all
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {songs.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No songs yet. Ask an artist to upload, or sign up as an artist.
            </p>
          ) : (
            songs.map((s) => (
              <SongCard key={s.id} song={s} queue={songs} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
