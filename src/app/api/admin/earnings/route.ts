import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireAdminApi } from "@/lib/admin/auth";
import { getEarningsMetrics } from "@/lib/admin/metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EarningsQuery = {
  includeTopArtists: boolean;
  includePayouts: boolean;
  topArtistsLimit: number;
  payoutsLimit: number;
};

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  min = 1,
  max = 500,
): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseQuery(request: NextRequest): EarningsQuery {
  const sp = request.nextUrl.searchParams;

  return {
    includeTopArtists: parseBoolean(sp.get("includeTopArtists"), true),
    includePayouts: parseBoolean(sp.get("includePayouts"), true),
    topArtistsLimit: parsePositiveInt(sp.get("topArtistsLimit"), 10, 1, 100),
    payoutsLimit: parsePositiveInt(sp.get("payoutsLimit"), 50, 1, 500),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminApi();

    const query = parseQuery(request);
    const metrics = await getEarningsMetrics();

    const response = {
      summary: metrics.summary,
      topArtists: query.includeTopArtists
        ? metrics.topArtists.slice(0, query.topArtistsLimit)
        : [],
      payouts: query.includePayouts
        ? metrics.payouts.slice(0, query.payoutsLimit)
        : [],
      meta: {
        generatedAt: metrics.generatedAt,
        includeTopArtists: query.includeTopArtists,
        includePayouts: query.includePayouts,
        topArtistsLimit: query.topArtistsLimit,
        payoutsLimit: query.payoutsLimit,
      },
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
