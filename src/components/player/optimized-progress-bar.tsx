/**
 * Optimized Progress Bar
 * Uses requestAnimationFrame for smooth updates, no re-renders on every tick
 */

"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

export function OptimizedProgressBar({ currentTime, duration, onSeek }: Props) {
  const progressRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);

  // Smooth progress updates using RAF
  useEffect(() => {
    if (isDragging) return;

    const updateProgress = () => {
      const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
      setDisplayProgress(progress);
      rafRef.current = requestAnimationFrame(updateProgress);
    };

    rafRef.current = requestAnimationFrame(updateProgress);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [currentTime, duration, isDragging]);

  // Handle seek
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newTime = Math.max(0, Math.min(duration, ratio * duration));
    setDisplayProgress((newTime / duration) * 100);
    onSeek(newTime);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newTime = Math.max(0, Math.min(duration, ratio * duration));
    setDisplayProgress((newTime / duration) * 100);
    onSeek(newTime);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  return (
    <div
      ref={progressRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
      className="h-1 w-full cursor-pointer bg-zinc-800"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className="h-full bg-violet-500 will-change-transform"
        style={{ width: `${displayProgress}%` }}
      />
    </div>
  );
}
