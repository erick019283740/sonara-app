"use client";

import { StreamInfo } from "@/components/player/stream-info";
import { usePlayer } from "@/contexts/player-context";
import { formatTime } from "@/lib/format";
import Image from "next/image";

export function MiniPlayer() {
  const {
    current,
    isPlaying,
    togglePlay,
    skipNext,
    currentTime,
    duration,
    seek,
    setExpanded,
    canCountStream,
    previewRemaining,
  } = usePlayer();

  if (!current) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-zinc-950/95 backdrop-blur-lg">
      <div
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        className="h-1 w-full cursor-pointer bg-zinc-800"
        onPointerDown={(e) => {
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          seek(Math.max(0, Math.min(duration, ratio * duration)));
        }}
      >
        <div
          className="h-full bg-violet-500 transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
            {current.cover_url ? (
              <Image
                src={current.cover_url}
                alt=""
                fill
                className="object-cover"
                sizes="48px"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg text-zinc-500">
                ♪
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {current.title}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {Array.isArray(current.artist)
                ? current.artist[0]?.stage_name
                : current.artist?.stage_name}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-900 hover:bg-zinc-100"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            onClick={skipNext}
            className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-white"
          >
            Skip
          </button>
        </div>
        <div className="hidden w-44 shrink-0 text-right text-[10px] text-zinc-500 sm:block">
          <div>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          <div className="mt-0.5">
            {canCountStream
              ? "✓ Stream counted"
              : `${Math.max(0, 30 - Math.floor(currentTime))}s until count`}
            {" · "}
            {previewRemaining}s left
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl px-3 pb-2">
        <StreamInfo />
        <p className="mt-1 text-[10px] text-zinc-500 sm:hidden">
          {canCountStream
            ? "✓ Stream counted"
            : `${Math.max(0, 30 - Math.floor(currentTime))}s until count`}
          {" · "}
          {previewRemaining}s left
        </p>
      </div>
    </div>
  );
}
