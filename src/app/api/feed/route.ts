import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  getForYouFeedResponse,
  recordFeedInteraction,
  type ForYouOptions,
} from "@/lib/services/feedService";

type InteractionRequestBody = {
  userId?: string;
  songId?: string;
  sessionId?: string | null;
  source?: "feed" | "song" | "artist" | "search" | "other";
  watchTimeSeconds?: number;
  totalDurationSeconds?: number;
  liked?: boolean;
  shared?: boolean;
  followed?: boolean;
  replayed?: boolean;
  skipped?: boolean;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function parsePositiveInt(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

function parseBool(raw: string | null, fallback = false): boolean {
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * GET /api/feed/for-you
 * Returns personalized ranked feed with score breakdown.
 */
export async function GET(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname;
    if (!path.endsWith("/api/feed/for-you") && !path.endsWith("/api/feed")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const limit = parsePositiveInt(sp.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const sessionId = sp.get("sessionId");
    const bypassCache = parseBool(sp.get("bypassCache"), false);

    const options: ForYouOptions = {
      limit,
      sessionId,
      bypassCache,
    };

    const feed = await getForYouFeedResponse(authUserId, options);

    return NextResponse.json(
      {
        ok: true,
        endpoint: "/api/feed/for-you",
        generatedAt: feed.generatedAt,
        cacheHit: feed.cacheHit,
        userId: feed.userId,
        limit: feed.limit,
        songs: feed.songs.map((song, index) => ({
          rank: index + 1,
          songId: song.songId,
          title: song.title,
          artistId: song.artistId ?? song.artist_id ?? null,
          coverUrl: song.coverUrl ?? null,
          trendingScore: song.trendingScore,
          plays24h: song.plays24h,
          likes: song.likes,
          shares: song.shares,
          isNewSong: song.isNewSong,
          daysSinceUpload: song.daysSinceUpload,
          scoreBreakdown: song.scoreBreakdown,
          algorithmMeta: song.algorithmMeta,
        })),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=5, stale-while-revalidate=20",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/feed/for-you:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/feed/for-you
 * Feedback loop endpoint: records interaction and adapts future ranking.
 */
export async function POST(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname;
    if (!path.endsWith("/api/feed/for-you") && !path.endsWith("/api/feed")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as InteractionRequestBody;

    const songId = (body.songId ?? "").trim();
    if (!songId) {
      return NextResponse.json({ error: "songId_required" }, { status: 400 });
    }

    const watchTimeSeconds = Number(body.watchTimeSeconds ?? 0);
    const totalDurationSeconds = Number(body.totalDurationSeconds ?? 0);

    if (!Number.isFinite(watchTimeSeconds) || watchTimeSeconds < 0) {
      return NextResponse.json(
        { error: "invalid_watchTimeSeconds" },
        { status: 400 },
      );
    }

    if (
      !Number.isFinite(totalDurationSeconds) ||
      totalDurationSeconds <= 0 ||
      totalDurationSeconds > 60 * 60
    ) {
      return NextResponse.json(
        { error: "invalid_totalDurationSeconds" },
        { status: 400 },
      );
    }

    await recordFeedInteraction({
      userId: authUserId,
      songId,
      sessionId: body.sessionId ?? null,
      source: body.source ?? "feed",
      watchTimeSeconds,
      totalDurationSeconds,
      liked: Boolean(body.liked ?? false),
      shared: Boolean(body.shared ?? false),
      followed: Boolean(body.followed ?? false),
      replayed: Boolean(body.replayed ?? false),
      skipped: Boolean(body.skipped ?? false),
    });

    return NextResponse.json(
      {
        ok: true,
        endpoint: "/api/feed/for-you",
        feedbackAccepted: true,
        userId: authUserId,
        songId,
        recordedAt: new Date().toISOString(),
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Error in POST /api/feed/for-you:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }
}
