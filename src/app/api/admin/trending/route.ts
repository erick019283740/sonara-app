import { NextRequest, NextResponse } from "next/server";
import { withAdminGuard } from "@/lib/admin/auth";
import { getTrendingMetrics, type TimeRange } from "@/lib/admin/metrics";

function parseLimit(value: string | null): number {
  if (!value) return 50;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, n);
}

function parseRange(value: string | null): TimeRange {
  const raw = (value ?? "").trim();
  if (raw === "5m") return "5m";
  if (raw === "15m") return "15m";
  if (raw === "1h") return "1h";
  if (raw === "24h") return "24h";
  if (raw === "7d") return "7d";
  if (raw === "30d") return "30d";
  return "24h";
}

function parseIncludeViral(value: string | null): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

export async function GET(request: NextRequest) {
  try {
    return await withAdminGuard(async () => {
      const params = request.nextUrl.searchParams;

      const limit = parseLimit(params.get("limit"));
      const range = parseRange(params.get("range"));
      const includeViral = parseIncludeViral(params.get("includeViral"));

      const metrics = await getTrendingMetrics();

      const topTrending = metrics.topTrending.slice(0, limit);
      const fastestGrowing = metrics.fastestGrowing.slice(0, limit);
      const viralSpikes = includeViral ? metrics.viralSpikes.slice(0, limit) : [];

      return NextResponse.json(
        {
          ok: true,
          range,
          generatedAt: metrics.generatedAt,
          counts: {
            topTrending: topTrending.length,
            fastestGrowing: fastestGrowing.length,
            viralSpikes: viralSpikes.length,
          },
          topTrending,
          fastestGrowing,
          viralSpikes,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "private, max-age=5, stale-while-revalidate=25",
          },
        },
      );
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;

    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Internal server error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
