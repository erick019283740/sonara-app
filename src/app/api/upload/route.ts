import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyRateLimit } from "@/lib/redis/rateLimiter";

export async function POST(request: NextRequest) {
  // Apply rate limiting (3 requests per minute)
  const rateLimitResponse = await applyRateLimit(
    request,
    "/api/upload",
    null
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    title?: string;
    description?: string;
    genre?: string;
    audioUrl?: string;
    coverUrl?: string;
  };

  if (!body.title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }

  // Upload logic would be here
  return NextResponse.json({ ok: true });
}
