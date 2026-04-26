import { createClient } from "@supabase/supabase-js";
import { Decimal } from "decimal.js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function processEarningsAggregation(): Promise<void> {
  try {
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1
    ).padStart(2, "0")}`;

    // Get all artists
    const { data: artists, error: artistsError } = await supabase
      .from("artists")
      .select("user_id")
      .limit(10000);

    if (artistsError || !artists) return;

    // Process each artist
    for (const artist of artists) {
      try {
        // Get pending earnings for this month
        const { data: ledgerEntries } = await supabase
          .from("earnings_ledger")
          .select("id, amount")
          .eq("artist_id", artist.user_id)
          .eq("status", "pending")
          .like("created_at", `${currentMonth}%`);

        if (!ledgerEntries || ledgerEntries.length === 0) continue;

        // Mark as posted
        const entryIds = ledgerEntries.map((e) => e.id);
        await supabase
          .from("earnings_ledger")
          .update({
            status: "posted",
            posted_at: new Date().toISOString(),
          })
          .in("id", entryIds);
      } catch (err) {
        console.error(`Error processing earnings for artist ${artist.user_id}:`, err);
      }
    }
  } catch (err) {
    console.error("Error in earnings aggregation:", err);
  }
}

export async function processMonthlyPayouts(): Promise<void> {
  try {
    const now = new Date();
    const previousMonth = `${now.getFullYear()}-${String(
      now.getMonth()
    ).padStart(2, "0")}`;

    // Get all artists
    const { data: artists, error } = await supabase
      .from("artists")
      .select("user_id")
      .limit(10000);

    if (error || !artists) return;

    // Create payouts for previous month
    for (const artist of artists) {
      try {
        // Check if payout already exists
        const { data: existing } = await supabase
          .from("payouts")
          .select("id")
          .eq("artist_id", artist.user_id)
          .eq("month", previousMonth)
          .eq("status", "processed")
          .single();

        if (existing) continue;

        // Get monthly total
        const { data: ledgerEntries } = await supabase
          .from("earnings_ledger")
          .select("amount")
          .eq("artist_id", artist.user_id)
          .eq("status", "posted")
          .like("created_at", `${previousMonth}%`);

        if (!ledgerEntries || ledgerEntries.length === 0) continue;

        const totalAmount = ledgerEntries.reduce(
          (sum, entry) => sum + parseFloat(entry.amount),
          0
        );

        if (totalAmount <= 0) continue;

        // Create payout record
        await supabase.from("payouts").insert({
          artist_id: artist.user_id,
          amount: totalAmount.toString(),
          currency: "USD",
          status: "pending",
          month: previousMonth,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`Error creating payout for artist ${artist.user_id}:`, err);
      }
    }
  } catch (err) {
    console.error("Error in monthly payout processing:", err);
  }
}

export async function archiveOldStreamData(): Promise<void> {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Archive old streams
    await supabase
      .from("streams")
      .delete()
      .lt("created_at", threeMonthsAgo.toISOString())
      .limit(10000);

  } catch (err) {
    console.error("Error archiving old stream data:", err);
  }
}

export async function cleanupExpiredSessions(): Promise<void> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await supabase
      .from("session_data")
      .delete()
      .lt("last_activity_at", thirtyDaysAgo.toISOString());
  } catch (err) {
    console.error("Error cleaning up expired sessions:", err);
  }
}

export class EarningsProcessor {
  static async lockPayoutForArtist(
    artistId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<{ success: boolean; payoutId?: string; error?: string }> {
    try {
      const { data: summary } = await supabase
        .from("earnings_monthly_summary")
        .select("gross_earnings")
        .eq("artist_id", artistId)
        .gte("created_at", periodStart)
        .lte("created_at", periodEnd);

      if (!summary || summary.length === 0) {
        return { success: false, error: "No earnings found for period" };
      }

      const totalAmount = summary.reduce(
        (sum, s) => new Decimal(s.gross_earnings).plus(sum),
        new Decimal("0"),
      );

      const { data: lock, error: lockError } = await supabase
        .from("payout_locks")
        .insert({
          artist_id: artistId,
          period_start: periodStart.split("T")[0],
          period_end: periodEnd.split("T")[0],
          total_amount: totalAmount.toString(),
          status: "locked",
        })
        .select("id")
        .single();

      if (lockError) {
        return { success: false, error: "Failed to create payout lock" };
      }

      return { success: true, payoutId: lock.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
