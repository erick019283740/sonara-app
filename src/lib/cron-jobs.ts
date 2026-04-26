"use server";

import { createClient } from "@supabase/supabase-js";
import {
  batchRecalculateTrendingScores,
  getSongsNeedingRecalc,
} from "@/lib/services/trendService";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function recalculateTrendingScores(): Promise<{
  success: boolean;
  updatedCount: number;
  error?: string;
}> {
  try {
    const songIds = await getSongsNeedingRecalc(24);

    if (songIds.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const updatedCount = await batchRecalculateTrendingScores(songIds);

    return { success: true, updatedCount };
  } catch (error) {
    console.error("Error in recalculateTrendingScores:", error);
    return {
      success: false,
      updatedCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function archiveOldData(daysToKeep: number = 90): Promise<{
  success: boolean;
  deletedCount: number;
  error?: string;
}> {
  try {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("streams")
      .delete()
      .lt("created_at", cutoffDate.toISOString())
      .select("id");

    if (error) {
      return {
        success: false,
        deletedCount: 0,
        error: error.message,
      };
    }

    return { success: true, deletedCount: data?.length || 0 };
  } catch (error) {
    console.error("Error in archiveOldData:", error);
    return {
      success: false,
      deletedCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function updateMonthlyEarnings(): Promise<{
  success: boolean;
  updatedCount: number;
  error?: string;
}> {
  try {
    const { data: artists, error } = await supabase
      .from("earnings")
      .select("artist_id, earnings_this_month");

    if (error) {
      return { success: false, updatedCount: 0, error: error.message };
    }

    for (const artist of artists || []) {
      await supabase
        .from("earnings")
        .update({
          earnings_last_month: artist.earnings_this_month,
          earnings_this_month: 0,
        })
        .eq("artist_id", artist.artist_id);
    }

    return { success: true, updatedCount: artists?.length || 0 };
  } catch (error) {
    console.error("Error in updateMonthlyEarnings:", error);
    return {
      success: false,
      updatedCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
