"use client";

import { usePlayer } from "@/contexts/player-context";

const STREAM_THRESHOLD_SECONDS = 30;

export function StreamInfo() {
  const { isPlaying, canCountStream, currentTime, previewRemaining } =
    usePlayer();

  if (!isPlaying) return null;

  const listenedSeconds = Math.max(0, Math.floor(currentTime));
  const secondsUntilCounted = Math.max(
    0,
    STREAM_THRESHOLD_SECONDS - listenedSeconds,
  );
  const progressPercent = Math.min(
    100,
    (Math.min(listenedSeconds, STREAM_THRESHOLD_SECONDS) /
      STREAM_THRESHOLD_SECONDS) *
      100,
  );

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3">
      {canCountStream ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-green-400">
            ✓ Stream wird gezählt! Danke für deine Unterstützung.
          </p>
          <p className="text-[11px] text-zinc-400">
            Preview endet in {previewRemaining}s
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-300">
            Stream zählt nach 30 Sekunden ({secondsUntilCounted}s übrig)
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-400">
            Preview endet in {previewRemaining}s
          </p>
        </div>
      )}
    </div>
  );
}
