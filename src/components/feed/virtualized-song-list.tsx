/**
 * Virtualized Song List
 * Only renders visible items for smooth scrolling performance
 */

"use client";

import { useEffect, useRef, useState } from "react";

interface Song {
  id: string;
  title: string;
  artist: string;
  cover_url: string;
  [key: string]: unknown;
}

interface Props {
  songs: Song[];
  renderItem: (song: Song, index: number) => React.ReactNode;
  itemHeight: number;
  overscan?: number;
}

export function VirtualizedSongList({
  songs,
  renderItem,
  itemHeight,
  overscan = 3,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    container.addEventListener("scroll", handleScroll);
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    songs.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleSongs = songs.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;
  const totalHeight = songs.length * itemHeight;

  return (
    <div
      ref={containerRef}
      className="overflow-auto"
      style={{ height: containerHeight }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleSongs.map((song, index) =>
            renderItem(song, startIndex + index)
          )}
        </div>
      </div>
    </div>
  );
}
