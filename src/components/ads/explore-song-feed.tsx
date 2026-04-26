"use client";

import { BannerAd } from "@/components/ads/banner-ad";
import { SongCard } from "@/components/song/song-card";
import type { Song } from "@/types/database";
import type { ReactNode } from "react";

const AD_EVERY = 8;

type Props = {
  songs: Song[];
  showAds: boolean;
  trendingScores?: Record<string, number>;
};

/**
 * Song grid for Explore with occasional AdSense banners (free users only).
 * Ads never touch the player — only interleaved in this feed.
 */
export function ExploreSongFeed({ songs, showAds, trendingScores }: Props) {
  if (!songs.length) {
    return null;
  }

  const nodes: ReactNode[] = [];

  songs.forEach((s, i) => {
    nodes.push(
      <SongCard
        key={s.id}
        song={s}
        queue={songs}
        trendingScore={trendingScores?.[s.id]}
      />
    );

    const isBreakpoint = (i + 1) % AD_EVERY === 0;
    const hasMore = i < songs.length - 1;
    if (showAds && isBreakpoint && hasMore) {
      nodes.push(
        <div key={`ad-${s.id}`} className="col-span-full">
          <BannerAd enabled className="my-1 min-h-[90px]" />
        </div>
      );
    }
  });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {nodes}
    </div>
  );
}
