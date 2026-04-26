"use client";

import Image from "next/image";
import { memo, useCallback, useMemo } from "react";
import type { Song } from "@/types/database";
import Controls from "@/components/player/Controls";

type SongCardProps = {
  song: Song;
  index: number;
  active: boolean;

  isPlaying?: boolean;
  isLiked?: boolean;
  isFollowed?: boolean;
  isSupporting?: boolean;
  likeCount?: number;

  onTogglePlayPause?: (songId: string) => void;
  onToggleLike?: (song: Song) => void | Promise<void>;
  onToggleFollow?: (song: Song) => void | Promise<void>;
  onSupportArtist?: (song: Song) => void | Promise<void>;
};

function getArtistName(song: Song): string {
  const a = song.artist;
  if (!a) return "Unknown Artist";
  if (Array.isArray(a)) return a[0]?.stage_name ?? "Unknown Artist";
  return a.stage_name ?? "Unknown Artist";
}

function formatCompact(n?: number): string {
  const v = Number.isFinite(n) ? Number(n) : 0;
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}

function SongCardComponent({
  song,
  index,
  active,
  isPlaying = false,
  isLiked = false,
  isFollowed = false,
  isSupporting = false,
  likeCount,
  onTogglePlayPause,
  onToggleLike,
  onToggleFollow,
  onSupportArtist,
}: SongCardProps) {
  const artistName = useMemo(() => getArtistName(song), [song]);
  const resolvedLikes = useMemo(
    () =>
      Number.isFinite(likeCount)
        ? Number(likeCount)
        : Number(song.likes_count ?? 0),
    [likeCount, song.likes_count],
  );
  const resolvedStreams = useMemo(
    () => Number(song.stream_count ?? 0),
    [song.stream_count],
  );

  const handleTogglePlayPause = useCallback(() => {
    onTogglePlayPause?.(song.id);
  }, [onTogglePlayPause, song.id]);

  const handleToggleLike = useCallback(() => {
    void onToggleLike?.(song);
  }, [onToggleLike, song]);

  const handleToggleFollow = useCallback(() => {
    void onToggleFollow?.(song);
  }, [onToggleFollow, song]);

  const handleSupport = useCallback(() => {
    void onSupportArtist?.(song);
  }, [onSupportArtist, song]);

  const onBackdropPointerUp = useCallback(() => {
    handleTogglePlayPause();
  }, [handleTogglePlayPause]);

  return (
    <article
      data-song-index={index}
      className="relative h-[100dvh] w-full overflow-hidden bg-black text-white"
      aria-label={`${song.title} by ${artistName}`}
    >
      <button
        type="button"
        className="absolute inset-0 z-10 h-full w-full cursor-default touch-manipulation bg-transparent"
        onPointerUp={onBackdropPointerUp}
        aria-label={isPlaying ? "Pause track" : "Play track"}
      />

      {song.cover_url ? (
        <Image
          src={song.cover_url}
          alt={song.title}
          fill
          priority={active}
          sizes="100vw"
          className={`object-cover transition-transform duration-500 ${
            active ? "scale-100" : "scale-[1.035]"
          }`}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black" />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/15 to-black/80" />

      <div className="absolute bottom-0 left-0 right-0 z-20 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pr-24 sm:pr-28">
        <h2 className="line-clamp-2 text-2xl font-bold leading-tight">
          {song.title}
        </h2>
        <p className="mt-1 text-sm text-zinc-200">@{artistName}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
          <span>{formatCompact(resolvedStreams)} streams</span>
          <span>•</span>
          <span>{formatCompact(resolvedLikes)} likes</span>
          {song.genre ? (
            <>
              <span>•</span>
              <span>{song.genre}</span>
            </>
          ) : null}
        </div>
      </div>

      <Controls
        song={song}
        onLike={handleToggleLike}
        onFollow={handleToggleFollow}
        onSupport={handleSupport}
        likeCount={resolvedLikes}
        streamCount={resolvedStreams}
        isLiked={isLiked}
        isFollowed={isFollowed}
        isSupported={isSupporting}
      />
    </article>
  );
}

export const SongCard = memo(
  SongCardComponent,
  (prev, next) =>
    prev.song.id === next.song.id &&
    prev.index === next.index &&
    prev.active === next.active &&
    prev.isPlaying === next.isPlaying &&
    prev.isLiked === next.isLiked &&
    prev.isFollowed === next.isFollowed &&
    prev.isSupporting === next.isSupporting &&
    prev.likeCount === next.likeCount,
);

SongCard.displayName = "SongCard";

export default SongCard;
