import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyRateLimit } from "@/lib/redis/rateLimiter";

export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResponse = await applyRateLimit(
    request,
    "/api/donations",
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
    artist_id?: string;
    amount?: number;
  };
  if (!body.artist_id || typeof body.amount !== "number") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("register_donation", {
    p_artist_id: body.artist_id,
    p_amount: body.amount,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    payment_id?: string;
  } | null;

  if (!result?.ok) {
    return NextResponse.json(
      { error: result?.error ?? "failed" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, payment_id: result.payment_id });
}
