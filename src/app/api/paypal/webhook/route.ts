import { recordDonationIfNew } from "@/lib/paypal/record-donation";
import { paypalGetOrder } from "@/lib/paypal/server";
import { verifyPayPalWebhookSignature } from "@/lib/paypal/verify-webhook";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PayPalWebhookEnvelope = {
  id?: string;
  event_type?: string;
  resource?: PayPalCaptureResource;
  resource_type?: string;
};

type PayPalCaptureResource = {
  id?: string;
  amount?: { currency_code?: string; value?: string };
  supplementary_data?: {
    related_ids?: { order_id?: string };
  };
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getOrderIdFromCapture(resource: PayPalCaptureResource): string | null {
  const oid = resource.supplementary_data?.related_ids?.order_id?.trim();
  return oid || null;
}

export async function POST(request: Request) {
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let event: PayPalWebhookEnvelope;
  try {
    event = JSON.parse(rawText) as PayPalWebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventType = event.event_type ?? "unknown";
  console.log("[paypal:webhook] received", eventType, event.id ?? "");

  const verified = await verifyPayPalWebhookSignature(event, request.headers);
  if (!verified) {
    console.warn("[paypal:webhook] signature verification failed", eventType);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  console.log("[paypal:webhook] signature verified", eventType);

  if (eventType === "CHECKOUT.ORDER.APPROVED") {
    console.log(
      "[paypal:webhook] CHECKOUT.ORDER.APPROVED ignored (await PAYMENT.CAPTURE.COMPLETED)"
    );
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
    console.log("[paypal:webhook] event ignored (no handler)", eventType);
    return NextResponse.json({ ok: true, ignored: true });
  }

  const resource = event.resource;
  if (!isRecord(resource)) {
    console.warn("[paypal:webhook] missing resource");
    return NextResponse.json({ error: "missing_resource" }, { status: 400 });
  }

  const capture = resource as PayPalCaptureResource;
  const captureId = capture.id?.trim();
  const orderId = getOrderIdFromCapture(capture);
  const currency = capture.amount?.currency_code;
  const valueRaw = capture.amount?.value;

  if (!captureId || !orderId || !valueRaw || !currency) {
    console.warn("[paypal:webhook] incomplete capture payload", {
      captureId,
      orderId,
      valueRaw,
      currency,
    });
    return NextResponse.json({ error: "incomplete_capture" }, { status: 400 });
  }

  if (currency.toUpperCase() !== "EUR") {
    console.warn("[paypal:webhook] unsupported currency", currency);
    return NextResponse.json({ error: "unsupported_currency" }, { status: 400 });
  }

  const amountEur = Number(valueRaw);
  if (!Number.isFinite(amountEur) || amountEur <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  let orderJson;
  try {
    orderJson = await paypalGetOrder(orderId);
  } catch (e) {
    console.error("[paypal:webhook] paypalGetOrder failed", e);
    return NextResponse.json({ error: "order_lookup_failed" }, { status: 500 });
  }

  const unit = orderJson.purchase_units?.[0];
  const artistId = unit?.reference_id?.trim();
  const userId = unit?.custom_id?.trim();

  if (!artistId || !userId) {
    console.warn("[paypal:webhook] order missing reference_id/custom_id", orderId);
    return NextResponse.json({ error: "order_context_missing" }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[paypal:webhook] admin client misconfigured", e);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const result = await recordDonationIfNew(admin, {
    userId,
    artistId,
    amountEur,
    paypalOrderId: orderId,
    paypalCaptureId: captureId,
  });

  if (!result.ok) {
    console.error("[paypal:webhook] record failed", result.message);
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  if (result.status === "duplicate") {
    console.log("[paypal:webhook] duplicate ignored", { orderId, captureId });
    return NextResponse.json({ ok: true, duplicate: true });
  }

  console.log("[paypal:webhook] payment processed", {
    orderId,
    captureId,
    amountEur,
    artistId,
    userId,
  });

  return NextResponse.json({ ok: true, processed: true });
}
