import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireAdminApi } from "@/lib/admin/auth";
import { getFraudMetrics } from "@/lib/admin/metrics";

export const dynamic = "force-dynamic";

type SeverityFilter = "all" | "low" | "medium" | "high";

function parseSeverity(input: string | null): SeverityFilter {
  if (input === "low" || input === "medium" || input === "high") return input;
  return "all";
}

function parseUserId(input: string | null): string | undefined {
  if (!input) return undefined;
  const value = input.trim();
  return value.length > 0 ? value : undefined;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminApi();

    const searchParams = request.nextUrl.searchParams;
    const severity = parseSeverity(searchParams.get("severity"));
    const userId = parseUserId(searchParams.get("userId"));

    const metrics = await getFraudMetrics({
      severity,
      userId,
    });

    return NextResponse.json(
      {
        ok: true,
        filters: {
          severity,
          userId: userId ?? null,
        },
        ...metrics,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
