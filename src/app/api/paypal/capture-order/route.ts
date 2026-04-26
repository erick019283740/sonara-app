import { recordDonationIfNew } from "@/lib/paypal/record-donation";
import { extractVerifiedEurDonation, paypalCaptureOrder } from "@/lib/paypal/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

/**
 * Optional client-side fallback after PayPal approves payment.
 * Source of truth for recording donations is the webhook; this path dedupes
 * against the same PayPal order/capture ids.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { orderID?: string };
    const orderId = body.orderID?.trim();
    if (!orderId) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const orderJson = await paypalCaptureOrder(orderId);

    if (orderJson.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "payment_not_completed", status: orderJson.status },
        { status: 409 }
      );
    }

    const verified = extractVerifiedEurDonation(orderJson);
    if (!verified) {
      return NextResponse.json({ error: "invalid_paypal_payload" }, { status: 502 });
    }

    if (verified.payerUserId !== user.id) {
      return NextResponse.json({ error: "payer_mismatch" }, { status: 403 });
    }

    const admin = createAdminClient();
    const gross = verified.amountEur;
    const artistShare = Math.round(gross * 0.9 * 10000) / 10000;

    const result = await recordDonationIfNew(admin, {
      userId: user.id,
      artistId: verified.artistId,
      amountEur: gross,
      paypalOrderId: orderId,
      paypalCaptureId: verified.captureId,
    });

    if (!result.ok) {
      console.error("[paypal:capture-order] record failed", result.message);
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    if (result.status === "duplicate") {
      console.log("[paypal:capture-order] duplicate ignored (webhook or prior insert)", {
        orderId,
        captureId: verified.captureId,
      });
      return NextResponse.json({
        ok: true,
        duplicate: true,
        fallback: true,
        amount_eur: gross,
        artist_share_eur: artistShare,
        capture_id: verified.captureId,
      });
    }

    console.log("[paypal:capture-order] fallback insert completed", {
      orderId,
      captureId: verified.captureId,
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      fallback: true,
      amount_eur: gross,
      artist_share_eur: artistShare,
      capture_id: verified.captureId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "capture_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
