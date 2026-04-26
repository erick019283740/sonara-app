import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ShareRequestBody = {
  song_id?: string;
};

type ShareBoostMeta = {
  total_shares: number;
  boost_multiplier: number;
  first_24h: {
    active: boolean;
    shares_in_window: number;
    window_start: string | null;
    window_end: string | null;
  };
};

const FIRST_24H_MS = 24 * 60 * 60 * 1000;
const BASE_MULTIPLIER = 1;
const MAX_MULTIPLIER = 3;
const LOG_BOOST_FACTOR = 0.25;

function computeBoostMultiplier(
  totalShares: number,
  first24hShares: number,
): number {
  const raw =
    BASE_MULTIPLIER +
    Math.log10(Math.max(1, totalShares)) * LOG_BOOST_FACTOR +
    Math.log10(Math.max(1, first24hShares)) * (LOG_BOOST_FACTOR * 1.4);

  return Math.min(MAX_MULTIPLIER, Number(raw.toFixed(4)));
}

function getWindow(createdAt: string) {
  const start = new Date(createdAt);
  const end = new Date(start.getTime() + FIRST_24H_MS);
  const now = Date.now();

  return {
    start,
    end,
    isActive: now <= end.getTime(),
  };
}

/**
 * Share endpoint with "share-to-boost" support:
 * - increments shares_count
 * - tracks first-24h share window activity
 * - stores boost metadata in `songs.share_boost_meta` (jsonb)
 *
 * Requires `songs` table fields:
 * - shares_count int (already used in this project)
 * - share_boost_meta jsonb (recommended)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ShareRequestBody;
    const songId = body.song_id?.trim();

    if (!songId) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: row, error: selErr } = await admin
      .from("songs")
      .select("id, created_at, shares_count, share_boost_meta")
      .eq("id", songId)
      .maybeSingle();

    if (selErr) {
      return NextResponse.json({ error: selErr.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const nextShares = (row.shares_count ?? 0) + 1;
    const createdAt = row.created_at as string;
    const { start, end, isActive } = getWindow(createdAt);

    const prevMeta = (row.share_boost_meta ?? {}) as Partial<ShareBoostMeta>;
    const prevFirst24hShares = prevMeta.first_24h?.shares_in_window ?? 0;
    const nextFirst24hShares = isActive
      ? prevFirst24hShares + 1
      : prevFirst24hShares;

    const nextMeta: ShareBoostMeta = {
      total_shares: nextShares,
      boost_multiplier: computeBoostMultiplier(nextShares, nextFirst24hShares),
      first_24h: {
        active: isActive,
        shares_in_window: nextFirst24hShares,
        window_start: start.toISOString(),
        window_end: end.toISOString(),
      },
    };

    const { error: upErr } = await admin
      .from("songs")
      .update({
        shares_count: nextShares,
        share_boost_meta: nextMeta,
      })
      .eq("id", songId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      shares_count: nextShares,
      share_boost: {
        multiplier: nextMeta.boost_multiplier,
        first_24h_active: nextMeta.first_24h.active,
        shares_in_first_24h: nextMeta.first_24h.shares_in_window,
      },
    });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
