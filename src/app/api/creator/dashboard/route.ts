import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { growthService } from "@/lib/services/growthService";

type DashboardQuery = {
  artistUserId?: string | null;
  songsLimit?: number;
  bypassCache?: boolean;
};

function parsePositiveInt(raw: string | null, fallback: number, max = 200): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, value);
}

function parseBool(raw: string | null, fallback = false): boolean {
  if (raw === null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function getArtistUserIdFromArtistId(artistId: string): Promise<string | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("artists")
    .select("user_id")
    .eq("id", artistId)
    .maybeSingle();

  if (error || !data) return null;
  return (data.user_id as string) ?? null;
}

function parseQuery(request: NextRequest): DashboardQuery {
  const sp = request.nextUrl.searchParams;
  return {
    artistUserId: sp.get("artistUserId"),
    songsLimit: parsePositiveInt(sp.get("songsLimit"), 50, 200),
    bypassCache: parseBool(sp.get("bypassCache"), false),
  };
}

/**
 * GET /api/creator/dashboard
 * Returns creator dashboard metrics:
 * - total earnings
 * - stream analytics
 * - follower growth
 * - viral score per song
 */
export async function GET(request: NextRequest) {
  try {
    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const q = parseQuery(request);
    let targetArtistUserId = q.artistUserId?.trim() || authUserId;

    const requestedArtistId = request.nextUrl.searchParams.get("artistId");
    if (requestedArtistId && !q.artistUserId) {
      const resolved = await getArtistUserIdFromArtistId(requestedArtistId.trim());
      if (!resolved) {
        return NextResponse.json({ error: "artist_not_found" }, { status: 404 });
      }
      targetArtistUserId = resolved;
    }

    // Access control: allow own dashboard by default.
    // Optional override can be enabled for internal/admin use by env flag.
    const allowCrossArtistRead = process.env.ALLOW_CROSS_ARTIST_DASHBOARD_READ === "true";
    if (!allowCrossArtistRead && targetArtistUserId !== authUserId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const dashboard = await growthService.getCreatorDashboard(
      targetArtistUserId,
      q.songsLimit ?? 50,
    );

    let leaderboard = null as Awaited<ReturnType<typeof growthService.getLeaderboard>> | null;
    if (q.bypassCache) {
      leaderboard = await growthService.getLeaderboard({
        limit: 10,
        bypassCache: true,
      });
    } else {
      leaderboard = await growthService.getLeaderboard({ limit: 10 });
    }

    const songViralMetrics = dashboard.songs.map((song, index) => ({
      rankByViral: index + 1,
      songId: song.songId,
      title: song.title,
      viralScore: song.viralScore,
      shareBoostScore: song.shareBoostScore,
      streamCount: song.streamCount,
      likesCount: song.likesCount,
      sharesCount: song.sharesCount,
      createdAt: song.createdAt,
    }));

    return NextResponse.json(
      {
        ok: true,
        endpoint: "/api/creator/dashboard",
        generatedAt: new Date().toISOString(),
        artist: {
          artistId: dashboard.artistId,
          artistUserId: dashboard.artistUserId,
          stageName: dashboard.stageName,
        },
        earnings: {
          total: dashboard.totalEarnings,
          last30d: dashboard.earnings30d,
        },
        analytics: {
          totalFollowers: dashboard.totalFollowers,
          followerGrowth30d: dashboard.followerGrowth30d,
          streams30d: dashboard.streams30d,
          shares30d: dashboard.shares30d,
          avgViralScore: dashboard.avgViralScore,
          topSongViralScore: dashboard.topSongViralScore,
        },
        songs: songViralMetrics,
        dailyMetrics: dashboard.dailyMetrics,
        leaderboardTop10: leaderboard,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/creator/dashboard:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
