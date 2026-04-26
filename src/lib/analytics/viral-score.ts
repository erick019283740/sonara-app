import { computeTrendingScore } from "@/lib/algorithms/trending";

export type ViralMetrics = {
  stream_count: number;
  likes_count: number;
  shares_count: number;
  external_click_count: number;
  plays_24h: number;
  plays_7d_excl_24h: number;
  follower_boost: number;
};

/** Shares per lifetime stream — rough viral efficiency. */
export function computePlayToShareRatio(streamCount: number, sharesCount: number): number {
  if (!streamCount) return sharesCount > 0 ? 1 : 0;
  return sharesCount / streamCount;
}

/** External taps / shares — optional funnel metric for future campaigns. */
export function computeClickToShareRatio(
  sharesCount: number,
  externalClicks: number
): number {
  if (!sharesCount) return externalClicks > 0 ? 1 : 0;
  return externalClicks / sharesCount;
}

export function computeViralMomentum(metrics: ViralMetrics): number {
  const base = computeTrendingScore({
    stream_count: metrics.stream_count,
    likes_count: metrics.likes_count,
    shares_count: metrics.shares_count,
    recent_plays_24h: metrics.plays_24h,
    recent_plays_7d_excl_24h: metrics.plays_7d_excl_24h,
    follower_boost: metrics.follower_boost,
  });
  const shareLift = metrics.shares_count * 2.2;
  const outbound = metrics.external_click_count * 0.8;
  return base + shareLift + outbound;
}

/** UI badge threshold — tune with product; compares to normalized trending inputs. */
export function isHotTrending(score: number, threshold = 48): boolean {
  return score >= threshold;
}
