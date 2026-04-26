/**
 * Home / Feed Page
 * TikTok-style vertical feed with autoplay, infinite scroll
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button, IconButton, Avatar, Badge } from "@/components/ui";
import { Play, Pause, Heart, MessageCircle, Share2 } from "lucide-react";
import { usePlayer } from "@/contexts/player-context";
import type { Song } from "@/types/database";

export default function FeedPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const { current, isPlaying, playSong, togglePlay } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  const loadSongs = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      // Simulate API call - replace with actual API
      const mockSongs: Song[] = Array.from({ length: 20 }, (_, i) => ({
        id: `song-${pageNum}-${i}`,
        title: `Song ${pageNum * 20 + i + 1}`,
        description: "A great song",
        artist_id: `artist-${i}`,
        file_url: `/song-${i}.mp3`,
        cover_url: `/placeholder-cover-${i}.jpg`,
        genre: ["Pop", "Rock", "Hip-Hop", "Electronic", "Jazz"][i % 5],
        duration: 180,
        stream_count: Math.floor(Math.random() * 10000),
        likes_count: Math.floor(Math.random() * 1000),
        status: "active",
        created_at: new Date().toISOString(),
      }));

      if (pageNum === 0) {
        setSongs(mockSongs);
      } else {
        setSongs((prev) => [...prev, ...mockSongs]);
      }

      setHasMore(pageNum < 5); // Simulate 5 pages
    } catch (error) {
      console.error("Failed to load songs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial songs once on mount
  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      void loadSongs(0);
    }
  }, [loadSongs]);

  const loadMore = () => {
    if (!hasMore || loading) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadSongs(nextPage);
  };

  const handlePlaySong = (song: Song) => {
    if (current?.id === song.id) {
      togglePlay();
    } else {
      playSong(song, songs);
    }
  };

  const renderSongCard = (song: Song, index: number) => {
    const isActive = current?.id === song.id;
    const isPlayingCurrent = isActive && isPlaying;
    const coverUrl = song.cover_url || "";

    return (
      <div
        key={song.id}
        className="relative w-full h-screen snap-start bg-zinc-950 flex items-center justify-center"
      >
        {/* Background blur */}
        {coverUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-30 blur-3xl"
            style={{ backgroundImage: `url(${coverUrl})` }}
          />
        )}

        {/* Content */}
        <div className="relative z-10 w-full max-w-lg mx-auto px-4">
          {/* Song Cover */}
          <div className="relative aspect-square rounded-2xl overflow-hidden mb-6 shadow-2xl">
            {coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl}
                alt={song.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            )}
            {/* Play overlay */}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-200">
              <button
                onClick={() => handlePlaySong(song)}
                className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-all duration-200"
              >
                {isPlayingCurrent ? (
                  <Pause className="w-10 h-10 text-white" />
                ) : (
                  <Play className="w-10 h-10 text-white ml-1" />
                )}
              </button>
            </div>
          </div>

          {/* Song Info */}
          <div className="space-y-2 mb-6">
            <h2 className="text-3xl font-bold text-white">{song.title}</h2>
            <div className="flex items-center gap-2">
              <Avatar src={coverUrl} alt={"Artist"} size="sm" />
              <p className="text-zinc-400 text-lg">Artist</p>
              <Badge variant="default">{song.genre}</Badge>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-around">
            <IconButton size="lg" variant="ghost">
              <Heart className="w-6 h-6" />
            </IconButton>
            <IconButton size="lg" variant="ghost">
              <MessageCircle className="w-6 h-6" />
            </IconButton>
            <IconButton size="lg" variant="ghost">
              <Share2 className="w-6 h-6" />
            </IconButton>
          </div>

          {/* Stats */}
          <div className="mt-6 flex items-center gap-4 text-zinc-500 text-sm">
            <span>{song.stream_count.toLocaleString()} streams</span>
          </div>
        </div>

        {/* Ad Placeholder */}
        {index % 10 === 0 && index > 0 && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-800/50 backdrop-blur-sm rounded-lg border border-white/10">
            <span className="text-xs text-zinc-400">Sponsored</span>
          </div>
        )}
      </div>
    );
  };

  if (loading && songs.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-400">Loading feed...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-screen overflow-y-scroll snap-y snap-mandatory scroll-smooth bg-zinc-950"
      style={{ scrollSnapType: "y mandatory" }}
    >
      {songs.map((song, index) => renderSongCard(song, index))}
      
      {/* Load More */}
      {hasMore && (
        <div className="h-screen snap-start flex items-center justify-center">
          <Button onClick={loadMore} loading={loading} size="lg">
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
