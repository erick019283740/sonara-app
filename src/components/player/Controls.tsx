"use client";

import { memo, useCallback, useMemo } from "react";
import type { Song } from "@/types/database";
import { usePlayerStore, playerSelectors } from "@/store/playerStore";

type ControlsProps = {
  song: Song;
  onLike: () => void;
  onFollow: () => void;
  onSupport: () => void;
  likeCount?: number;
  streamCount?: number;
  className?: string;
  disabled?: boolean;
  showStats?: boolean;
  isLiked?: boolean;
  isFollowed?: boolean;
  isSupported?: boolean;
};

function triggerHaptic(intensity: "light" | "medium" | "heavy" = "light") {
  if (typeof window === "undefined") return;

  const nav = window.navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };

  const ms = intensity === "light" ? 8 : intensity === "medium" ? 16 : 28;
  nav.vibrate?.(ms);
}

function formatCompact(n?: number) {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    Number(n ?? 0),
  );
}

function ControlsBase({
  song,
  onLike,
  onFollow,
  onSupport,
  likeCount = 0,
  streamCount = 0,
  className,
  disabled = false,
  showStats = true,
  isLiked,
  isFollowed,
  isSupported,
}: ControlsProps) {
  const isPlaying = usePlayerStore(playerSelectors.isPlaying);
  const currentSongId = usePlayerStore(playerSelectors.currentSongId);
  const actions = usePlayerStore(
    useCallback(
      (s) => ({
        togglePlay: s.togglePlay,
        setCurrentSongById: s.setCurrentSongById,
        play: s.play,
      }),
      [],
    ),
  );

  const active = currentSongId === song.id;

  const liked = usePlayerStore(
    useMemo(() => (state) => (typeof isLiked === "boolean" ? isLiked : Boolean(state.interactions.likedSongIds[song.id])), [isLiked, song.id]),
  );
  const followed = usePlayerStore(
    useMemo(
      () =>
        (state) =>
          typeof isFollowed === "boolean"
            ? isFollowed
            : Boolean(state.interactions.followedArtistIds[song.artist_id]),
      [isFollowed, song.artist_id],
    ),
  );
  const supported = usePlayerStore(
    useMemo(
      () =>
        (state) =>
          typeof isSupported === "boolean"
            ? isSupported
            : Boolean(state.interactions.supportedArtistIds[song.artist_id]),
      [isSupported, song.artist_id],
    ),
  );

  const handlePlayPause = useCallback(() => {
    if (disabled) return;
    triggerHaptic("light");

    if (!active) {
      actions.setCurrentSongById(song.id);
      actions.play();
      return;
    }
    actions.togglePlay();
  }, [actions, active, disabled, song.id]);

  const handleLike = useCallback(() => {
    if (disabled) return;
    triggerHaptic("medium");
    onLike();
  }, [disabled, onLike]);

  const handleFollow = useCallback(() => {
    if (disabled) return;
    triggerHaptic("light");
    onFollow();
  }, [disabled, onFollow]);

  const handleSupport = useCallback(() => {
    if (disabled) return;
    triggerHaptic("heavy");
    onSupport();
  }, [disabled, onSupport]);

  return (
    <div
      className={[
        "pointer-events-auto absolute right-3 z-30 flex select-none flex-col items-center gap-3",
        "bottom-[max(5rem,env(safe-area-inset-bottom))] sm:right-4",
        className ?? "",
      ]
        .join(" ")
        .trim()}
      aria-label="Floating player controls"
    >
      <button
        type="button"
        onClick={handlePlayPause}
        disabled={disabled}
        className={[
          "group relative flex h-14 w-14 items-center justify-center rounded-full",
          "border border-white/20 bg-black/55 text-white shadow-xl backdrop-blur-md",
          "active:scale-[0.96] transition-transform duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
        aria-label={active && isPlaying ? "Pause" : "Play"}
      >
        <span className="text-xl leading-none">{active && isPlaying ? "❚❚" : "▶"}</span>
      </button>

      <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/35 px-2 py-2 backdrop-blur-md">
        <button
          type="button"
          onClick={handleLike}
          disabled={disabled}
          className={[
            "group flex h-12 w-12 items-center justify-center rounded-full",
            liked ? "bg-pink-500/25 text-pink-300 border border-pink-300/40" : "bg-white/10 text-white border border-white/15",
            "active:scale-[0.94] transition-all duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          ].join(" ")}
          aria-pressed={liked}
          aria-label={liked ? "Unlike song" : "Like song"}
        >
          <span className="text-lg">{liked ? "♥" : "♡"}</span>
        </button>
        {showStats && <span className="text-[11px] font-medium text-white/90">{formatCompact(likeCount)}</span>}
      </div>

      <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/35 px-2 py-2 backdrop-blur-md">
        <button
          type="button"
          onClick={handleFollow}
          disabled={disabled}
          className={[
            "group flex h-12 w-12 items-center justify-center rounded-full",
            followed
              ? "bg-cyan-500/25 text-cyan-200 border border-cyan-300/40"
              : "bg-white/10 text-white border border-white/15",
            "active:scale-[0.94] transition-all duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          ].join(" ")}
          aria-pressed={followed}
          aria-label={followed ? "Following artist" : "Follow artist"}
        >
          <span className="text-lg">{followed ? "✓" : "+"}</span>
        </button>
        <span className="text-[10px] font-medium uppercase tracking-wide text-white/80">Follow</span>
      </div>

      <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/35 px-2 py-2 backdrop-blur-md">
        <button
          type="button"
          onClick={handleSupport}
          disabled={disabled}
          className={[
            "group flex h-12 w-12 items-center justify-center rounded-full",
            supported
              ? "bg-amber-500/25 text-amber-200 border border-amber-300/40"
              : "bg-white/10 text-white border border-white/15",
            "active:scale-[0.94] transition-all duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          ].join(" ")}
          aria-pressed={supported}
          aria-label={supported ? "Supported artist" : "Support artist"}
        >
          <span className="text-lg">❤</span>
        </button>
        <span className="text-[10px] font-medium uppercase tracking-wide text-white/80">Support</span>
      </div>

      {showStats && (
        <div className="mt-1 rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[11px] text-white/90 backdrop-blur">
          {formatCompact(streamCount)} streams
        </div>
      )}
    </div>
  );
}

export const Controls = memo(ControlsBase);
export default Controls;
