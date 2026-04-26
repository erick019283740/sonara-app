import { SongCard } from "@/components/song/song-card";
import { createClient } from "@/lib/supabase/server";
import type { Playlist, Song } from "@/types/database";
import Link from "next/link";

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

type LibraryTab = "likes" | "saved" | "playlists" | "history";

const TABS: { id: LibraryTab; label: string }[] = [
  { id: "likes", label: "Likes" },
  { id: "saved", label: "Saved" },
  { id: "playlists", label: "Playlists" },
  { id: "history", label: "History" },
];

function normalizeTab(tab?: string): LibraryTab {
  if (
    tab === "likes" ||
    tab === "saved" ||
    tab === "playlists" ||
    tab === "history"
  ) {
    return tab;
  }
  return "saved";
}

function tabHref(tab: LibraryTab) {
  const p = new URLSearchParams();
  p.set("tab", tab);
  return `/library?${p.toString()}`;
}

function rowToSong(input: unknown): Song | null {
  const row = input as { songs?: Song | Song[] | null } | null;
  const value = row?.songs;
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function fetchSavedSongs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("saved_songs")
    .select(
      `songs (
        id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count,
        artist:artists ( id, stage_name, user_id )
      )`,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? []).map(rowToSong).filter((s): s is Song => Boolean(s));
}

async function fetchLikedSongs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("song_likes")
    .select(
      `songs (
        id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count,
        artist:artists ( id, stage_name, user_id )
      )`,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? []).map(rowToSong).filter((s): s is Song => Boolean(s));
}

async function fetchHistorySongs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("streams")
    .select(
      `created_at, songs (
        id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count,
        artist:artists ( id, stage_name, user_id )
      )`,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  const seen = new Set<string>();
  const ordered: Song[] = [];

  for (const row of data ?? []) {
    const song = rowToSong(row as unknown);
    if (!song || seen.has(song.id)) continue;
    seen.add(song.id);
    ordered.push(song);
  }

  return ordered;
}

async function fetchPlaylists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("playlists")
    .select("id, user_id, name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Playlist[];
}

export default async function LibraryPage({ searchParams }: PageProps) {
  const { tab } = await searchParams;
  const activeTab = normalizeTab(tab);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-zinc-300">Sign in to view your library.</p>
        <Link
          href="/login"
          className="mt-4 inline-block text-violet-300 hover:underline"
        >
          Log in
        </Link>
      </div>
    );
  }

  const [savedSongs, likedSongs, historySongs, playlists] = await Promise.all([
    fetchSavedSongs(supabase, user.id),
    fetchLikedSongs(supabase, user.id),
    fetchHistorySongs(supabase, user.id),
    fetchPlaylists(supabase, user.id),
  ]);

  const playlistsMap = new Map<string, Song[]>();

  if (playlists.length > 0) {
    const { data: playlistRows } = await supabase
      .from("playlist_songs")
      .select(
        `playlist_id, songs (
          id, artist_id, title, genre, duration, file_url, cover_url, created_at, stream_count, likes_count, shares_count,
          artist:artists ( id, stage_name, user_id )
        )`,
      )
      .in(
        "playlist_id",
        playlists.map((p) => p.id),
      );

    for (const row of playlistRows ?? []) {
      const typed = row as {
        playlist_id?: string;
        songs?: Song | Song[] | null;
      };
      if (!typed.playlist_id) continue;
      const song = typed.songs
        ? Array.isArray(typed.songs)
          ? (typed.songs[0] ?? null)
          : typed.songs
        : null;

      if (!song) continue;

      const prev = playlistsMap.get(typed.playlist_id) ?? [];
      playlistsMap.set(typed.playlist_id, [...prev, song]);
    }
  }

  const activeSongs =
    activeTab === "likes"
      ? likedSongs
      : activeTab === "saved"
        ? savedSongs
        : activeTab === "history"
          ? historySongs
          : [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Library</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Your likes, saved tracks, playlists, and listening history in one
          place.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            className={`rounded-full px-4 py-2 text-sm transition ${
              activeTab === t.id
                ? "bg-white text-zinc-900"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {activeTab !== "playlists" ? (
        <section className="grid gap-3 md:grid-cols-2">
          {activeSongs.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {activeTab === "likes" && "No liked songs yet."}
              {activeTab === "saved" && "No saved songs yet."}
              {activeTab === "history" && "No listening history yet."}
            </p>
          ) : (
            activeSongs.map((song) => (
              <SongCard key={song.id} song={song} queue={activeSongs} />
            ))
          )}
        </section>
      ) : (
        <section className="space-y-4">
          {playlists.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <p className="text-sm text-zinc-400">No playlists yet.</p>
            </div>
          ) : (
            playlists.map((playlist) => {
              const songs = playlistsMap.get(playlist.id) ?? [];
              return (
                <article
                  key={playlist.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-white">
                      {playlist.name}
                    </h2>
                    <span className="text-xs text-zinc-500">
                      {songs.length} tracks
                    </span>
                  </div>
                  {songs.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      This playlist is empty.
                    </p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {songs.slice(0, 6).map((song) => (
                        <SongCard
                          key={`${playlist.id}-${song.id}`}
                          song={song}
                          queue={songs}
                        />
                      ))}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
