import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EarningsProcessor } from "@/lib/workers/earningsProcessor";

const PERIODS = new Set(["lifetime", "month", "year"]);

async function resolveActor() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role?: string | null }>();

  return {
    userId: user.id,
    isAdmin: String(profile?.role ?? "").toLowerCase() === "admin",
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const artistId = searchParams.get("artistId");
    const period = searchParams.get("period") || "lifetime";

    if (!artistId) {
      return NextResponse.json(
        { error: "artistId required" },
        { status: 400 }
      );
    }
    if (!PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: artist } = await admin
      .from("artists")
      .select("id, user_id")
      .eq("id", artistId)
      .maybeSingle<{ id: string; user_id: string }>();

    if (!artist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    if (!actor.isAdmin && artist.user_id !== actor.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let query = admin
      .from("earnings_ledger")
      .select("amount, status, created_at, transaction_type")
      .eq("artist_id", artistId)
      .eq("status", "posted");

    if (period === "month") {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      query = query.gte("created_at", monthStart);
    } else if (period === "year") {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
      query = query.gte("created_at", yearStart);
    }

    const { data: ledger, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch earnings" },
        { status: 500 }
      );
    }

    const total = (ledger || []).reduce(
      (sum, entry) => sum + parseFloat(entry.amount),
      0
    );

    const breakdown = {
      streams: (ledger || [])
        .filter((e) => e.transaction_type === "stream")
        .reduce((sum, e) => sum + parseFloat(e.amount), 0),
      donations: (ledger || [])
        .filter((e) => e.transaction_type === "donation")
        .reduce((sum, e) => sum + parseFloat(e.amount), 0),
    };

    // Get monthly summary if exists
    const now = new Date();
    const { data: monthlySummary } = await admin
      .from("earnings_monthly_summary")
      .select("*")
      .eq("artist_id", artistId)
      .eq("year", now.getFullYear())
      .eq("month", now.getMonth() + 1)
      .single();

    return NextResponse.json({
      artistId,
      period,
      total,
      breakdown,
      monthlySummary: monthlySummary || null,
      transactionCount: (ledger || []).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in GET /api/earnings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { artistId, action } = body;

    if (!artistId || !action) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (action === "request_payout") {
      const admin = createAdminClient();
      const { data: artist } = await admin
        .from("artists")
        .select("id, user_id")
        .eq("id", artistId)
        .maybeSingle<{ id: string; user_id: string }>();

      if (!artist) {
        return NextResponse.json({ error: "Artist not found" }, { status: 404 });
      }
      if (!actor.isAdmin && artist.user_id !== actor.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const periodStart = body.periodStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const periodEnd = body.periodEnd || new Date().toISOString();

      const result = await EarningsProcessor.lockPayoutForArtist(
        artistId,
        periodStart,
        periodEnd
      );

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Failed to lock payout" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        payoutId: result.payoutId,
        message: "Payout locked and queued for processing",
      });
    }

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error in POST /api/earnings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
