import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import referralService from "@/lib/services/referralService";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      );
    }

    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const stats = await referralService.getReferralStats(user.id, limit);

    return NextResponse.json(
      {
        ok: true,
        userId: stats.userId,
        referralCode: stats.referralCode,
        invitedTotal: stats.invitedTotal,
        convertedTotal: stats.convertedTotal,
        pendingTotal: stats.pendingTotal,
        conversionRate:
          stats.invitedTotal > 0
            ? Number(((stats.convertedTotal / stats.invitedTotal) * 100).toFixed(2))
            : 0,
        rewardsEarned: stats.rewardsEarned,
        recentInvites: stats.recentInvites,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=20, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/referral/stats:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
