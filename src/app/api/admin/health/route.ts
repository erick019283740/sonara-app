import { NextRequest, NextResponse } from "next/server";
import { collectRevenueHealthMetrics, quickRevenueHealthCheck } from "@/lib/monitoring/revenueHealthMonitor";

/**
 * GET /api/admin/health
 * Real-time revenue health metrics
 * Admin-only (or internal API key)
 */
export async function GET(request: NextRequest) {
  // Check for internal API key or admin auth
  const apiKey = request.headers.get("x-internal-api-key");
  const internalKey = process.env.INTERNAL_API_KEY;

  // Quick mode for /api/health integration
  const sp = request.nextUrl.searchParams;
  const quick = sp.get("quick") === "true";

  // Allow internal API key or public quick check
  if (!internalKey || apiKey !== internalKey) {
    // For non-quick mode, require admin auth
    if (!quick) {
      const { createClient } = await import("@/lib/supabase/server");
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "admin") {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
  }

  if (quick) {
    const health = await quickRevenueHealthCheck();
    return NextResponse.json(health);
  }

  const metrics = await collectRevenueHealthMetrics();
  return NextResponse.json(metrics);
}
