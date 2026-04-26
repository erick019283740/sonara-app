"use client";

import { ShareSongButton } from "@/components/song/share-song-button";
import { SupportArtistButton } from "@/components/paypal/support-artist-button";
import { usePlayer } from "@/contexts/player-context";
import { useUser } from "@/contexts/user-context";
import type { Song } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  songs: Song[];
  /** Shown while parent prepares data (optional). */
  loading?: boolean;
};

function stageName(song: Song) {
  const a = song.artist;
  if (!a) return "Artist";
  if (Array.isArray(a)) return a[0]?.stage_name ?? "Artist";
  return a.stage_name;
}

function artistId(song: Song) {
  return song.artist_id;
}

function SwipeSlide({
  song,
  index,
  isActive,
  liked,
  onToggleLike,
  likeDisabled,
}: {
  song: Song;
  index: number;
  isActive: boolean;
  liked: boolean;
  onToggleLike: () => void;
  likeDisabled: boolean;
}) {
  return (
    <div
      data-index={index}
      className="relative h-[calc(100dvh-3.5rem)] w-full shrink-0 snap-start snap-always overflow-hidden bg-black"
    >
      {song.cover_url ? (
        <Image
          src={song.cover_url}
          alt={song.title}
          fill
          className={`object-cover transition duration-500 ease-out ${
            isActive ? "scale-100 opacity-100" : "scale-[1.03] opacity-85"
          }`}
          sizes="100vw"
          priority={index < 2}
          loading={index < 3 ? "eager" : "lazy"}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-900" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

      <div
        className={`absolute inset-x-0 bottom-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] transition duration-500 ${
          isActive ? "translate-y-0 opacity-100" : "translate-y-2 opacity-90"
        }`}
      >
        <p className="line-clamp-2 text-2xl font-semibold text-white drop-shadow-lg">
          {song.title}
        </p>
        <Link
          href={`/artist/${song.artist_id}`}
          className="mt-1 inline-block text-sm text-zinc-200 drop-shadow hover:text-white"
        >
          {stageName(song)}
        </Link>
        <p className="mt-1 text-xs text-zinc-400">{song.genre}</p>
        <p className="mt-1 text-xs text-zinc-300/90">
          {song.stream_count} streams · {song.likes_count} likes
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleLike}
            disabled={likeDisabled}
            className="rounded-full bg-white/15 px-4 py-2 text-sm text-white backdrop-blur disabled:opacity-40"
          >
            {liked ? "♥ Liked" : "♡ Like"}
          </button>
          <ShareSongButton songId={song.id} title={song.title} />
          <div className="scale-95 origin-left">
            <SupportArtistButton
              artistId={artistId(song)}
              artistName={stageName(song)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[calc(100dvh-3.5rem)] animate-pulse rounded-2xl bg-zinc-800/80"
        />
      ))}
    </div>
  );
}

export function SwipeMusicFeed({ songs, loading }: Props) {
  const { playSong, togglePlay, pause, current, isPlaying } = usePlayer();
  const { user } = useUser();
  const supabase = useMemo(() => createClient(), []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [liveStats, setLiveStats] = useState<
    Record<string, { likes_count: number; stream_count: number }>
  >({});
  const bootRef = useRef(false);

  useEffect(() => {
    if (!songs.length || bootRef.current) return;
    bootRef.current = true;
    activeRef.current = 0;
    setActiveIndex(0);
    playSong(songs[0], songs);
  }, [songs, playSong]);

  useEffect(() => {
    if (!user || !songs.length) return;
    let cancelled = false;
    (async () => {
      const ids = songs.map((s) => s.id);
      const { data } = await supabase
        .from("song_likes")
        .select("song_id")
        .eq("user_id", user.id)
        .in("song_id", ids);
      if (cancelled || !data) return;
      const map: Record<string, boolean> = {};
      for (const row of data) {
        if (row.song_id) map[row.song_id] = true;
      }
      setLikes(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [songs, supabase, user]);

  const setActiveIfChanged = useCallback(
    (i: number) => {
      if (i < 0 || i >= songs.length) return;
      if (activeRef.current === i) return;
      activeRef.current = i;
      setActiveIndex(i);
      playSong(songs[i], songs);
    },
    [playSong, songs],
  );

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !songs.length) return;

    const slides = () => root.querySelectorAll<HTMLElement>("[data-index]");
    let raf = 0;

    const obs = new IntersectionObserver(
      (entries) => {
        let best: { i: number; r: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number(e.target.getAttribute("data-index"));
          if (!Number.isFinite(i)) continue;
          const r = e.intersectionRatio;
          if (!best || r > best.r) best = { i, r };
        }
        if (best && best.r >= 0.52) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => setActiveIfChanged(best!.i));
        }
      },
      { root, threshold: [0.45, 0.52, 0.6, 0.75] },
    );

    slides().forEach((el) => obs.observe(el));
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [setActiveIfChanged, songs]);

  useEffect(() => {
    if (!songs.length) return;
    const next = songs[activeIndex + 1]?.file_url;
    const after = songs[activeIndex + 2]?.file_url;
    const links: HTMLLinkElement[] = [];
    for (const href of [next, after].filter(Boolean) as string[]) {
      const l = document.createElement("link");
      l.rel = "preload";
      l.as = "audio";
      l.href = href;
      document.head.appendChild(l);
      links.push(l);
    }
    return () => {
      links.forEach((l) => l.remove());
    };
  }, [activeIndex, songs]);

  useEffect(() => {
    if (!songs.length) return;

    const ids = songs.map((s) => s.id);
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("songs")
        .select("id, likes_count, stream_count")
        .in("id", ids);

      if (cancelled || !data) return;

      const next: Record<
        string,
        { likes_count: number; stream_count: number }
      > = {};
      for (const row of data) {
        const id = String(row.id);
        next[id] = {
          likes_count: Number(row.likes_count ?? 0),
          stream_count: Number(row.stream_count ?? 0),
        };
      }
      setLiveStats(next);
    })();

    const channel = supabase
      .channel(`swipe-live-${ids.slice(0, 20).join("-")}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "songs",
          filter: `id=in.(${ids.join(",")})`,
        },
        (payload) => {
          const row = payload.new as {
            id?: string;
            likes_count?: number;
            stream_count?: number;
          };

          if (!row?.id) return;

          setLiveStats((prev) => ({
            ...prev,
            [row.id as string]: {
              likes_count: Number(
                row.likes_count ?? prev[row.id as string]?.likes_count ?? 0,
              ),
              stream_count: Number(
                row.stream_count ?? prev[row.id as string]?.stream_count ?? 0,
              ),
            },
          }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [songs, supabase]);

  const toggleLike = useCallback(
    async (song: Song) => {
      if (!user) return;
      const id = song.id;
      const on = likes[id];
      if (on) {
        await supabase
          .from("song_likes")
          .delete()
          .eq("song_id", id)
          .eq("user_id", user.id);
        setLikes((m) => ({ ...m, [id]: false }));
        window.dispatchEvent(
          new CustomEvent("sonara:like-changed", {
            detail: {
              songId: id,
              userId: user.id,
              liked: false,
              source: "swipe-feed",
              timestamp: new Date().toISOString(),
            },
          }),
        );
      } else {
        await supabase
          .from("song_likes")
          .insert({ song_id: id, user_id: user.id });
        setLikes((m) => ({ ...m, [id]: true }));
        window.dispatchEvent(
          new CustomEvent("sonara:like-changed", {
            detail: {
              songId: id,
              userId: user.id,
              liked: true,
              source: "swipe-feed",
              timestamp: new Date().toISOString(),
            },
          }),
        );
      }
    },
    [likes, supabase, user],
  );

  const onPlayPause = useCallback(() => {
    if (
      !current ||
      !songs[activeIndex] ||
      current.id !== songs[activeIndex].id
    ) {
      playSong(songs[activeIndex], songs);
      return;
    }
    if (isPlaying) pause();
    else togglePlay();
  }, [activeIndex, current, isPlaying, pause, playSong, songs, togglePlay]);

  if (loading) {
    return <FeedSkeleton />;
  }

  if (!songs.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-zinc-400">
        Nothing to play here yet. Try another tab or upload music.
      </div>
    );
  }

  const activeSong = songs[activeIndex];
  const playingThis =
    !!current && !!activeSong && current.id === activeSong.id && isPlaying;

  return (
    <div className="relative -mx-4 flex flex-col md:-mx-4">
      <div className="sticky top-0 z-20 flex items-center justify-between px-3 py-2 pt-[max(0.25rem,env(safe-area-inset-top))]">
        <Link
          href="/explore?tab=trending"
          className="rounded-full bg-black/50 px-3 py-1.5 text-xs text-white backdrop-blur-md"
        >
          List view
        </Link>
        <span className="rounded-full bg-black/40 px-2 py-1 text-[10px] text-zinc-300 backdrop-blur">
          Swipe
        </span>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-y-contain scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden snap-y snap-mandatory"
      >
        {songs.map((song, i) => {
          const stats = liveStats[song.id];
          const songWithLiveStats: Song = {
            ...song,
            likes_count: stats?.likes_count ?? song.likes_count,
            stream_count: stats?.stream_count ?? song.stream_count,
          };

          return (
            <SwipeSlide
              key={song.id}
              song={songWithLiveStats}
              index={i}
              isActive={i === activeIndex}
              liked={!!likes[song.id]}
              likeDisabled={!user}
              onToggleLike={() => void toggleLike(song)}
            />
          );
        })}
      </div>

      <div className="pointer-events-none fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-30 flex justify-center md:bottom-[calc(6rem+env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/15 bg-black/55 px-4 py-2 backdrop-blur-md">
          <button
            type="button"
            onClick={onPlayPause}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-lg text-zinc-900"
            aria-label={playingThis ? "Pause" : "Play"}
          >
            {playingThis ? "❚❚" : "▶"}
          </button>
        </div>
      </div>
    </div>
  );
}
