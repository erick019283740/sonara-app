"use client";

import { usePlayer } from "@/contexts/player-context";
import { useUser } from "@/contexts/user-context";
import type { Song } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { ShareSongButton } from "@/components/song/share-song-button";
import { isHotTrending } from "@/lib/analytics/viral-score";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  song: Song;
  queue?: Song[];
  /** When set (e.g. explore trending), shows a lightweight “Trending” chip. */
  trendingScore?: number;
};

function stageName(song: Song) {
  const a = song.artist;
  if (!a) return "Artist";
  if (Array.isArray(a)) return a[0]?.stage_name ?? "Artist";
  return a.stage_name;
}

export function SongCard({ song, queue, trendingScore }: Props) {
  const { playSong, current, isPlaying, togglePlay, pause } = usePlayer();
  const { user } = useUser();
  const supabase = useMemo(() => createClient(), []);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);

  const active = current?.id === song.id;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: like }, { data: sav }] = await Promise.all([
        supabase
          .from("song_likes")
          .select("id")
          .eq("song_id", song.id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("saved_songs")
          .select("id")
          .eq("song_id", song.id)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (!cancelled) {
        setLiked(!!like);
        setSaved(!!sav);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [song.id, supabase, user]);

  const onPlay = useCallback(() => {
    if (active && isPlaying) {
      togglePlay();
      return;
    }
    if (active && !isPlaying) {
      togglePlay();
      return;
    }
    playSong(song, queue);
  }, [active, isPlaying, playSong, queue, song, togglePlay]);

  const toggleLike = useCallback(async () => {
    if (!user) return;
    if (liked) {
      await supabase
        .from("song_likes")
        .delete()
        .eq("song_id", song.id)
        .eq("user_id", user.id);
      setLiked(false);
    } else {
      await supabase.from("song_likes").insert({
        song_id: song.id,
        user_id: user.id,
      });
      setLiked(true);
    }
  }, [liked, song.id, supabase, user]);

  const toggleSaved = useCallback(async () => {
    if (!user) return;
    if (saved) {
      await supabase
        .from("saved_songs")
        .delete()
        .eq("song_id", song.id)
        .eq("user_id", user.id);
      setSaved(false);
    } else {
      await supabase.from("saved_songs").insert({
        song_id: song.id,
        user_id: user.id,
      });
      setSaved(true);
    }
  }, [saved, song.id, supabase, user]);

  return (
    <div className="group flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-3 transition hover:border-violet-500/40">
      <button
        type="button"
        onClick={onPlay}
        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-zinc-800"
      >
        {song.cover_url ? (
          <Image
            src={song.cover_url}
            alt=""
            fill
            className="object-cover"
            sizes="80px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-zinc-600">
            ♪
          </div>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-lg text-white opacity-0 transition group-hover:opacity-100">
          {active && isPlaying ? "❚❚" : "▶"}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/song/${song.id}`}
            className="truncate font-medium text-white hover:text-violet-200"
          >
            {song.title}
          </Link>
          {typeof trendingScore === "number" && isHotTrending(trendingScore) && (
            <span className="shrink-0 rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-200">
              Trending
            </span>
          )}
        </div>
        <p className="truncate text-sm text-zinc-400">{stageName(song)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link
            href={`/artist/${song.artist_id}`}
            className="text-xs text-violet-300 hover:underline"
          >
            View artist
          </Link>
          <span className="text-xs text-zinc-500">
            {song.stream_count} streams · {song.genre}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleLike()}
            disabled={!user}
            className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            {liked ? "♥ Liked" : "♡ Like"}
          </button>
          <button
            type="button"
            onClick={() => void toggleSaved()}
            disabled={!user}
            className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            {saved ? "Saved" : "Save"}
          </button>
          <ShareSongButton songId={song.id} title={song.title} />
          {active && (
            <button
              type="button"
              onClick={() => pause()}
              className="rounded-lg border border-white/20 px-2 py-1 text-xs text-zinc-300"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
