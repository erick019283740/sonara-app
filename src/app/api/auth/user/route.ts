import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyRateLimit } from "@/lib/redis/rateLimiter";

export async function GET(request: NextRequest) {
  // Apply rate limiting to auth endpoints (10 req/min)
  const rateLimitResponse = await applyRateLimit(
    request,
    "/api/auth",
    null
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      return NextResponse.json(
        { user: null, error: "auth_error" },
        { status: 401 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { user: null, error: "unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email ?? null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in GET /api/auth/user:", error);
    return NextResponse.json(
      { user: null, error: "internal_server_error" },
      { status: 500 }
    );
  }
}
