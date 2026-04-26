"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "@/types/database";
import { SongCard } from "@/components/player/SongCard";
import { usePlayer } from "@/hooks/usePlayer";
import { useUser } from "@/contexts/user-context";

type FeedProps = {
  initialSongs?: Song[];
  className?: string;
  pageSize?: number;
  preloadThreshold?: number;
  windowRadius?: number;
};

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PRELOAD_THRESHOLD = 4;
const DEFAULT_WINDOW_RADIUS = 3;

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

const Feed = memo(function Feed({
  initialSongs = [],
  className,
  pageSize = DEFAULT_PAGE_SIZE,
  preloadThreshold = DEFAULT_PRELOAD_THRESHOLD,
  windowRadius = DEFAULT_WINDOW_RADIUS,
}: FeedProps) {
  const { user } = useUser();

  const {
    queue,
    currentSongId,
    currentIndex,
    activeFeedIndex,
    isPlaying,
    interactions,
    networkStatus,
    bufferStatus,
    error,
    hasMoreFeed,
    setQueue,
    setActiveFeedIndex,
    play,
    pause,
    togglePlay,
    preloadSong,
    toggleLike,
    toggleFollowArtist,
    supportArtist,
    ensureRealtimeFeedSync,
    fetchMoreFeedSongs,
  } = usePlayer();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const [isFetching, setIsFetching] = useState(false);
  const [hydrateDone, setHydrateDone] = useState(false);

  const songs = queue.length ? queue : initialSongs;

  useEffect(() => {
    if (hydrateDone) return;
    if (!songs.length) return;

    setQueue(songs, 0);
    play();
    setHydrateDone(true);
  }, [hydrateDone, songs, setQueue, play]);

  useEffect(() => {
    const unsub = ensureRealtimeFeedSync();
    return () => {
      unsub?.();
    };
  }, [ensureRealtimeFeedSync]);

  const visibleRange = useMemo(() => {
    if (!songs.length) return { start: 0, end: -1 };
    const pivot = clamp(activeFeedIndex, 0, songs.length - 1);
    return {
      start: clamp(pivot - windowRadius, 0, songs.length - 1),
      end: clamp(pivot + windowRadius, 0, songs.length - 1),
    };
  }, [songs.length, activeFeedIndex, windowRadius]);

  const loadMore = useCallback(async () => {
    if (isFetching || !hasMoreFeed) return;
    setIsFetching(true);
    try {
      const next = await fetchMoreFeedSongs(pageSize);
      if (!next.length) return;
      setQueue([...songs, ...next], currentIndex);
    } finally {
      setIsFetching(false);
    }
  }, [
    isFetching,
    hasMoreFeed,
    fetchMoreFeedSongs,
    pageSize,
    setQueue,
    songs,
    currentIndex,
  ]);

  useEffect(() => {
    if (!songs.length) return;
    if (songs.length - 1 - activeFeedIndex <= preloadThreshold) {
      void loadMore();
    }
  }, [activeFeedIndex, songs.length, preloadThreshold, loadMore]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!songs.length) return;

    const root = containerRef.current;

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        let best: { idx: number; ratio: number } | null = null;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number(
            (entry.target as HTMLElement).dataset.index ?? "-1",
          );
          if (!Number.isFinite(idx) || idx < 0) continue;
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { idx, ratio: entry.intersectionRatio };
          }
        }

        if (!best) return;
        if (best.ratio < 0.58) return;

        if (best.idx !== activeFeedIndex) {
          setActiveFeedIndex(best.idx);
        }
      },
      {
        root,
        threshold: [0.2, 0.4, 0.58, 0.75, 0.9],
      },
    );

    const items = root.querySelectorAll<HTMLElement>("[data-feed-item='1']");
    items.forEach((el) => observerRef.current?.observe(el));

    return () => {
      observerRef.current?.disconnect();
    };
  }, [songs.length, activeFeedIndex, setActiveFeedIndex]);

  useEffect(() => {
    const activeSong = songs[activeFeedIndex];
    if (!activeSong) return;

    play();

    const nextA = songs[activeFeedIndex + 1];
    const nextB = songs[activeFeedIndex + 2];

    if (nextA) preloadSong(nextA);
    if (nextB) preloadSong(nextB);
  }, [activeFeedIndex, songs, preloadSong, play]);

  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) pause();
      else play();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [pause, play]);

  const handleTogglePlayPause = (songId: string) => {
    if (currentSongId === songId) {
      togglePlay();
      return;
    }
    const idx = songs.findIndex((s) => s.id === songId);
    if (idx >= 0) {
      setActiveFeedIndex(idx);
    }
  };

  const handleToggleLike = async (song: Song) => {
    if (!user) return;
    await toggleLike(song, user.id);
  };

  const handleToggleFollow = async (song: Song) => {
    const followed = Boolean(interactions.followedArtistIds[song.artist_id]);
    await toggleFollowArtist(song.artist_id, followed);
  };

  const handleSupportArtist = async (song: Song) => {
    if (!user) return;
    await supportArtist(song.artist_id, 5, user.id);
  };

  return (
    <section className={className ?? ""}>
      <div
        ref={containerRef}
        className="relative h-[100dvh] w-full overflow-y-auto overscroll-y-contain snap-y snap-mandatory bg-black"
        style={{ scrollbarWidth: "none" }}
      >
        {songs.map((song, idx) => {
          const inWindow = idx >= visibleRange.start && idx <= visibleRange.end;
          const active = idx === activeFeedIndex;

          return (
            <div
              key={song.id}
              data-feed-item="1"
              data-index={idx}
              className="h-[100dvh] w-full snap-start"
            >
              {inWindow ? (
                <SongCard
                  song={song}
                  index={idx}
                  active={active}
                  isPlaying={active && isPlaying}
                  isLiked={Boolean(interactions.likedSongIds[song.id])}
                  isFollowed={Boolean(
                    interactions.followedArtistIds[song.artist_id],
                  )}
                  isSupporting={Boolean(
                    interactions.supportedArtistIds[song.artist_id],
                  )}
                  likeCount={song.likes_count}
                  onTogglePlayPause={handleTogglePlayPause}
                  onToggleLike={handleToggleLike}
                  onToggleFollow={handleToggleFollow}
                  onSupportArtist={handleSupportArtist}
                />
              ) : (
                <div className="h-full w-full bg-black" />
              )}
            </div>
          );
        })}

        {isFetching && (
          <div className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-zinc-200 backdrop-blur">
            Loading more…
          </div>
        )}

        {!hasMoreFeed && songs.length > 0 && (
          <div className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-zinc-400 backdrop-blur">
            You reached the end
          </div>
        )}

        {(networkStatus === "offline" ||
          networkStatus === "slow" ||
          bufferStatus === "buffering") && (
          <div className="pointer-events-none fixed top-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-zinc-200 backdrop-blur">
            {networkStatus === "offline"
              ? "Offline mode"
              : networkStatus === "slow"
                ? "Slow network"
                : "Buffering…"}
          </div>
        )}

        {error && (
          <div className="fixed top-14 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-lg border border-red-500/50 bg-red-950/80 px-3 py-2 text-xs text-red-100 backdrop-blur">
            {error}
          </div>
        )}
      </div>
    </section>
  );
});

export default Feed;
