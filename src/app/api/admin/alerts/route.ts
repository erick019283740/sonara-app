import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, adminErrorResponse } from "@/lib/admin/auth";
import { getAlertsMetrics } from "@/lib/admin/metrics";

type SeverityFilter = "all" | "low" | "medium" | "high";

function parseSeverity(input: string | null): SeverityFilter {
  if (!input) return "all";
  const v = input.trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high" || v === "all") {
    return v;
  }
  return "all";
}

function parseLimit(input: string | null, fallback = 100): number {
  if (!input) return fallback;
  const n = Number.parseInt(input, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, n));
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminApi();

    const search = request.nextUrl.searchParams;
    const severity = parseSeverity(search.get("severity"));
    const limit = parseLimit(search.get("limit"), 100);

    const metrics = await getAlertsMetrics({ severity, limit });

    return NextResponse.json(
      {
        ok: true,
        filters: { severity, limit },
        ...metrics,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=5, stale-while-revalidate=20",
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
