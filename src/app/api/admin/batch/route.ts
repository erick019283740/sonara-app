import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  runStreamBatch,
  verifyRevenueIntegrity,
  getBatchStatus,
  flagStreamSuspicious,
} from "@/lib/services/batchAggregationService";
import { applyRateLimit } from "@/lib/redis/rateLimiter";

/**
 * Admin authorization helper
 * - Verifies authenticated user server-side
 * - Checks admin role from DB (not client-only)
 * - Supports internal API key for service-to-service calls
 */
async function verifyAdminAccess(request: NextRequest): Promise<{
  authorized: boolean;
  userId?: string;
  error?: NextResponse;
}> {
  // Check for internal API key (service-to-service)
  const apiKey = request.headers.get("x-internal-api-key");
  const internalKey = process.env.INTERNAL_API_KEY;

  if (internalKey && apiKey === internalKey) {
    return { authorized: true, userId: "service_role" };
  }

  // Standard auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      authorized: false,
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  // Server-side role verification (NOT client-only)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    console.warn(`[AdminAPI] Unauthorized access attempt by user ${user.id} (role: ${profile?.role || "unknown"})`);
    return {
      authorized: false,
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  return { authorized: true, userId: user.id };
}

/**
 * POST /api/admin/batch
 * Run batch processing for uncounted streams
 * Admin-only endpoint, strict rate limit
 */
export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, "/api/admin/batch", null);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await verifyAdminAccess(request);
  if (!auth.authorized || auth.error) return auth.error!;

  const body = await request.json().catch(() => ({}));
  const batchSize = typeof body.batchSize === "number" ? Math.min(body.batchSize, 1000) : 500;

  const result = await runStreamBatch(batchSize);

  // Log to admin audit trail
  try {
    const supabase = await createClient();
    await supabase.from("admin_audit_log").insert({
      admin_user_id: auth.userId === "service_role" ? null : auth.userId,
      action: "run_batch",
      target_type: "stream",
      target_id: "00000000-0000-0000-0000-000000000000",
      details: { batchSize, processed: result.processed, revenueEventsCreated: result.revenueEventsCreated },
      ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    });
  } catch {
    // Audit log failure should not block the response
  }

  return NextResponse.json({ ok: true, ...result });
}

/**
 * GET /api/admin/batch
 * Get batch processing status + integrity check
 * Admin-only endpoint
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, "/api/admin/batch", null);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await verifyAdminAccess(request);
  if (!auth.authorized || auth.error) return auth.error!;

  const [status, integrity] = await Promise.all([
    getBatchStatus(),
    verifyRevenueIntegrity(),
  ]);

  return NextResponse.json({ ok: true, status, integrity });
}

/**
 * PATCH /api/admin/batch
 * Flag a stream as suspicious (fraud reversal via negative event)
 * Admin-only endpoint, creates negative revenue event (never DELETE)
 */
export async function PATCH(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, "/api/admin/batch", null);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await verifyAdminAccess(request);
  if (!auth.authorized || auth.error) return auth.error!;

  const body = await request.json().catch(() => ({})) as {
    streamId?: string;
    reason?: string;
  };

  if (!body.streamId || !body.reason) {
    return NextResponse.json(
      { error: "streamId and reason are required" },
      { status: 400 }
    );
  }

  const result = await flagStreamSuspicious(body.streamId, body.reason);

  // Log to admin audit trail
  try {
    const supabase = await createClient();
    await supabase.from("admin_audit_log").insert({
      admin_user_id: auth.userId === "service_role" ? null : auth.userId,
      action: "flag_stream_suspicious",
      target_type: "stream",
      target_id: body.streamId,
      details: { reason: body.reason, result },
      ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    });
  } catch {
    // Audit log failure should not block the response
  }

  return NextResponse.json({ ...result, ok: result.ok });
}
