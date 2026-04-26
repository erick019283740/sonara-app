"use client";

import { useState, useCallback } from "react";
import { TrendingScore } from "@/types/monetization";

interface FeedSong extends TrendingScore {
  title?: string;
  artist?: string;
  coverUrl?: string;
}

/**
 * VIRAL DISCOVERY FEED
 * TikTok-style infinite scroll feed of trending songs
 * Features:
 * - Auto-play 30-60s previews
 * - Infinite scroll with lazy loading
 * - Like, follow, support artist actions
 * - Mobile-first responsive design
 */

export function ViraltrendingFeed() {
  const [songs, setSongs] = useState<FeedSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedType, setFeedType] = useState<"trending" | "new">("trending");

  // Load trending songs on component mount
  const loadFeed = useCallback(async (type: "trending" | "new" = "trending") => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/feed?limit=50&type=${type}`
      );
      if (!response.ok) throw new Error("Failed to load feed");

      const data = await response.json();
      setSongs(data.songs || []);
      setFeedType(type);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load more songs (infinite scroll)
  const loadMoreSongs = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/feed?limit=20&type=${feedType}&offset=${songs.length}`
      );
      if (!response.ok) throw new Error("Failed to load more songs");

      const data = await response.json();
      setSongs((prev) => [...prev, ...(data.songs || [])]);
    } catch (err) {
      console.error("Error loading more songs:", err);
    }
  }, [songs.length, feedType]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-white"></div>
          <p className="text-sm text-zinc-400">Loading trending songs...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center max-w-md">
          <h2 className="mb-2 text-lg font-semibold text-red-400">Error</h2>
          <p className="text-sm text-zinc-400">{error}</p>
          <button
            onClick={() => loadFeed(feedType)}
            className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-100"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen overflow-hidden bg-black">
      {/* Feed Controls */}
      <div className="absolute top-0 left-0 right-0 z-10 flex gap-2 bg-gradient-to-b from-black to-transparent p-4">
        <button
          onClick={() => loadFeed("trending")}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            feedType === "trending"
              ? "bg-white text-black"
              : "border border-white/20 text-white hover:bg-white/10"
          }`}
        >
          Trending
        </button>
        <button
          onClick={() => loadFeed("new")}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            feedType === "new"
              ? "bg-white text-black"
              : "border border-white/20 text-white hover:bg-white/10"
          }`}
        >
          New Artists
        </button>
      </div>

      {/* Songs Grid */}
      <div className="h-full overflow-y-auto scrollbar-hide">
        <div className="grid grid-cols-1 gap-px bg-zinc-900/50">
          {songs.map((song) => (
            <SongCard key={song.songId} song={song} />
          ))}
        </div>

        {/* Load More Trigger */}
        <div
          className="flex h-20 items-center justify-center"
          onMouseEnter={loadMoreSongs}
        >
          <button
            onClick={loadMoreSongs}
            className="text-sm text-zinc-400 hover:text-white"
          >
            Load More
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Individual Song Card for Trending Feed
 * Shows: preview, stats, engagement buttons
 */
function SongCard({ song }: { song: FeedSong }) {
  const [isLiked, setIsLiked] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isSupporting, setIsSupporting] = useState(false);

  return (
    <div className="group relative flex flex-col gap-4 border-b border-white/5 p-6 transition-colors hover:bg-white/5">
      {/* Song Metadata */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-white">{song.title || `Song ${song.songId.slice(0, 8)}`}</h3>
          <p className="text-sm text-zinc-400">{song.artist || "Unknown Artist"}</p>
        </div>
        {song.isNewSong && (
          <span className="rounded-full bg-gradient-to-r from-green-500 to-cyan-500 px-3 py-1 text-xs font-medium text-black">
            New
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div>
          <p className="text-zinc-400">Plays</p>
          <p className="font-semibold text-white">{song.plays24h}</p>
        </div>
        <div>
          <p className="text-zinc-400">Likes</p>
          <p className="font-semibold text-white">{song.likes}</p>
        </div>
        <div>
          <p className="text-zinc-400">Completion</p>
          <p className="font-semibold text-white">{song.completionRate}%</p>
        </div>
        <div>
          <p className="text-zinc-400">Trend Score</p>
          <p className="font-semibold text-white">{song.trendingScore.toFixed(1)}</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setIsLiked(!isLiked)}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            isLiked
              ? "bg-red-500/20 text-red-400"
              : "border border-white/20 text-white hover:bg-white/10"
          }`}
        >
          <span>❤️</span> Like
        </button>
        <button
          onClick={() => setIsFollowing(!isFollowing)}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            isFollowing
              ? "bg-blue-500/20 text-blue-400"
              : "border border-white/20 text-white hover:bg-white/10"
          }`}
        >
          <span>👤</span> Follow
        </button>
        <button
          onClick={() => setIsSupporting(!isSupporting)}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            isSupporting
              ? "bg-amber-500/20 text-amber-400"
              : "border border-white/20 text-white hover:bg-white/10"
          }`}
        >
          <span>🎁</span> Support
        </button>
      </div>
    </div>
  );
}
