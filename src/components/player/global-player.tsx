/**
 * Global Player Component
 * Persistent bottom player with RAF progress, queue system
 */

"use client";

import { OptimizedProgressBar } from "@/components/player/optimized-progress-bar";
import { IconButton, Avatar, Button } from "@/components/ui";
import { Play, Pause, SkipForward, SkipBack, List } from "lucide-react";
import { usePlayer } from "@/contexts/player-context";
import { formatTime } from "@/lib/format";

export function GlobalPlayer() {
  const {
    current,
    isPlaying,
    currentTime,
    duration,
    togglePlay,
    skipNext,
    seek,
    setExpanded,
  } = usePlayer();

  if (!current) return null;
  const coverUrl = current.cover_url || "";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-zinc-950/95 backdrop-blur-lg">
      {/* Progress Bar */}
      <OptimizedProgressBar
        currentTime={currentTime}
        duration={duration}
        onSeek={seek}
      />

      {/* Player Content */}
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2">
        {/* Song Info */}
        <button
          onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-zinc-800/50 rounded-lg p-2 transition-colors"
        >
          <Avatar src={coverUrl} alt={current.title} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white truncate">{current.title}</p>
            <p className="text-xs text-zinc-400 truncate">
              {Array.isArray(current.artist) 
                ? current.artist[0]?.stage_name || "Artist"
                : current.artist?.stage_name || "Artist"
              }
            </p>
          </div>
        </button>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <IconButton size="sm" variant="ghost" onClick={() => { /* skipBack not in context */ }}>
            <SkipBack className="w-4 h-4" />
          </IconButton>
          <IconButton size="md" variant="solid" onClick={togglePlay}>
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </IconButton>
          <IconButton size="sm" variant="ghost" onClick={skipNext}>
            <SkipForward className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Time */}
        <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-400 min-w-[100px] justify-end">
          <span>{formatTime(currentTime)}</span>
          <span>/</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Queue Toggle */}
        <IconButton size="sm" variant="ghost">
          <List className="w-4 h-4" />
        </IconButton>

        {/* Support Artist Button */}
        <Button size="sm" variant="secondary">
          Support
        </Button>
      </div>
    </div>
  );
}
