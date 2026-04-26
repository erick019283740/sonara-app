"use client";

import { usePlayer } from "@/contexts/player-context";
import { formatTime } from "@/lib/format";
import { StreamInfo } from "@/components/player/stream-info";
import Image from "next/image";

export function FullPlayer() {
  const {
    current,
    expanded,
    setExpanded,
    isPlaying,
    togglePlay,
    skipNext,
    currentTime,
    duration,
    seek,
    queueIndex,
    queue,
    canCountStream,
    previewRemaining,
  } = usePlayer();

  if (!current || !expanded) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-zinc-900 via-zinc-950 to-black">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-sm text-zinc-400 hover:text-white"
        >
          ↓ Minimize
        </button>
        <span className="text-xs text-zinc-500">
          {queue.length ? `${queueIndex + 1} / ${queue.length}` : ""}
        </span>
        <span className="w-16" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-32">
        <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-zinc-800 shadow-2xl shadow-violet-950/50">
          {current.cover_url ? (
            <Image
              src={current.cover_url}
              alt=""
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 384px"
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-6xl text-zinc-600">
              ♪
            </div>
          )}
        </div>
        <h2 className="mt-8 max-w-md text-center text-2xl font-semibold text-white">
          {current.title}
        </h2>
        <p className="mt-1 text-zinc-400">
          {Array.isArray(current.artist)
            ? current.artist[0]?.stage_name
            : current.artist?.stage_name}
        </p>
        <div className="mt-8 w-full max-w-md">
          <StreamInfo />
          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
            <span>
              {canCountStream
                ? "✓ Stream counted"
                : `${Math.max(0, 30 - Math.floor(currentTime))}s until stream counts`}
            </span>
            <span>{previewRemaining}s preview left</span>
          </div>
          <div
            className="h-1.5 w-full cursor-pointer rounded-full bg-zinc-800"
            onPointerDown={(e) => {
              const el = e.currentTarget;
              const rect = el.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              seek(Math.max(0, Math.min(duration, ratio * duration)));
            }}
          >
            <div
              className="h-full rounded-full bg-violet-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-zinc-500">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
        <div className="mt-10 flex items-center gap-8">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl text-zinc-900"
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            onClick={skipNext}
            className="text-sm text-zinc-400 hover:text-white"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
