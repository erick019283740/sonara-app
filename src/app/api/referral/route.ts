import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import referralService from "@/lib/services/referralService";

type ReferralRequestBody = {
  referralCode?: string;
  invitedUserId?: string;
  action?: "generate" | "redeem";
};

function normalizeCode(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().toUpperCase();
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: ReferralRequestBody;
    try {
      body = (await request.json()) as ReferralRequestBody;
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const action = body.action ?? "redeem";

    if (action === "generate") {
      const referralCode = await referralService.ensureReferralCode(user.id);

      return NextResponse.json(
        {
          ok: true,
          action: "generate",
          referralCode,
        },
        { status: 200 },
      );
    }

    const referralCode = normalizeCode(body.referralCode);
    if (!referralCode) {
      return NextResponse.json({ error: "referralCode_required" }, { status: 400 });
    }

    const invitedUserId = (body.invitedUserId ?? user.id).trim();
    if (!invitedUserId) {
      return NextResponse.json({ error: "invitedUserId_required" }, { status: 400 });
    }

    const result = await referralService.redeemReferralCode({
      referralCode,
      invitedUserId,
    });

    if (!result.ok) {
      const message = result.error ?? "failed";
      const status =
        message === "not_found" || message === "invalid_referral_code"
          ? 404
          : message === "self_referral_not_allowed"
            ? 400
            : 409;

      return NextResponse.json(
        {
          ok: false,
          action: "redeem",
          error: message,
        },
        { status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        action: "redeem",
        inviterUserId: result.inviterUserId ?? null,
        invitedUserId: result.invitedUserId ?? invitedUserId,
        referralId: result.referralId ?? null,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in POST /api/referral:", error);
    return NextResponse.json({ error: "internal_server_error" }, { status: 500 });
  }
}
