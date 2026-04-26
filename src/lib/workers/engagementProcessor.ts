import { createClient } from "@supabase/supabase-js";
import { Decimal } from "decimal.js";
import { cacheInvalidate, updateMicroTrendingScore } from "./trendingProcessor";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function processLikeEvent(
  userId: string,
  songId: string,
  liked: boolean
): Promise<void> {
  try {
    // Check if like exists
    const { data: existing } = await supabase
      .from("user_likes")
      .select("id")
      .eq("user_id", userId)
      .eq("song_id", songId)
      .single();

    if (liked && !existing) {
      // Add like
      await supabase.from("user_likes").insert({
        user_id: userId,
        song_id: songId,
        created_at: new Date().toISOString(),
      });

      // Update metrics
      await supabase
        .from("song_metrics")
        .update({ likes: new Decimal(1) })
        .eq("song_id", songId)
        .single()
        .then(() =>
          supabase
            .from("song_metrics")
            .select("likes")
            .eq("song_id", songId)
            .single()
        )
        .then((result) => {
          if (result.data) {
            updateMicroTrendingScore(songId, new Decimal("0.25"));
          }
        });
    } else if (!liked && existing) {
      // Remove like
      await supabase
        .from("user_likes")
        .delete()
        .eq("user_id", userId)
        .eq("song_id", songId);

      // Update metrics
      await supabase
        .from("song_metrics")
        .update({ likes: -1 })
        .eq("song_id", songId);

      updateMicroTrendingScore(songId, new Decimal("-0.25"));
    }

    // Invalidate cache
    await cacheInvalidate(songId);
  } catch (err) {
    console.error("Error processing like event:", err);
  }
}

export async function processFollowEvent(
  userId: string,
  artistId: string,
  followed: boolean
): Promise<void> {
  try {
    if (followed) {
      await supabase.from("artist_followers").insert({
        user_id: userId,
        artist_id: artistId,
        created_at: new Date().toISOString(),
      });

      // Update artist metrics
      await supabase
        .from("artist_metrics")
        .update({ followers: 1 })
        .eq("artist_id", artistId);
    } else {
      await supabase
        .from("artist_followers")
        .delete()
        .eq("user_id", userId)
        .eq("artist_id", artistId);

      // Update artist metrics
      await supabase
        .from("artist_metrics")
        .update({ followers: -1 })
        .eq("artist_id", artistId);
    }
  } catch (err) {
    console.error("Error processing follow event:", err);
  }
}

export async function processSupportEvent(
  userId: string,
  artistId: string,
  amount: Decimal,
  currency: string = "USD"
): Promise<void> {
  try {
    const artistAmount = amount.times("0.9");

    // Record support transaction
    await supabase.from("support_transactions").insert({
      supporter_id: userId,
      artist_id: artistId,
      amount: amount.toString(),
      currency: currency,
      artist_cut: artistAmount.toString(),
      created_at: new Date().toISOString(),
    });

    // Record earnings ledger
    await supabase.from("earnings_ledger").insert({
      artist_id: artistId,
      transaction_type: "donation",
      amount: artistAmount.toString(),
      currency: currency,
      metadata: { support_type: "artist_support", supporter_id: userId },
      status: "posted",
      created_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error processing support event:", err);
  }
}

export async function trackUserInteraction(
  userId: string,
  songId: string,
  interactionType: "play" | "skip" | "like" | "share",
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabase.from("user_interactions").insert({
      user_id: userId,
      song_id: songId,
      interaction_type: interactionType,
      metadata: metadata,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error tracking user interaction:", err);
  }
}

export async function trackFeedImpression(
  userId: string,
  songId: string,
  feedType: string,
  position: number
): Promise<void> {
  try {
    await supabase.from("feed_impressions").insert({
      user_id: userId,
      song_id: songId,
      feed_type: feedType,
      position: position,
      viewed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error tracking feed impression:", err);
  }
}
