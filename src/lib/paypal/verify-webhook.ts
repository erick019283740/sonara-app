import { getPayPalApiBase, getPayPalWebhookId } from "./config";
import { getPayPalAccessToken } from "./server";

/**
 * Verifies a PayPal webhook using POST /v1/notifications/verify-webhook-signature.
 * @see https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post
 */
export async function verifyPayPalWebhookSignature(
  webhookEvent: unknown,
  headers: Headers
): Promise<boolean> {
  const webhookId = getPayPalWebhookId();
  if (!webhookId) {
    console.error("[paypal:webhook] PAYPAL_WEBHOOK_ID is not configured");
    return false;
  }

  const transmissionId = headers.get("paypal-transmission-id");
  const transmissionTime = headers.get("paypal-transmission-time");
  const certUrl = headers.get("paypal-cert-url");
  const authAlgo = headers.get("paypal-auth-algo");
  const transmissionSig = headers.get("paypal-transmission-sig");

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    console.warn("[paypal:webhook] Missing PayPal transmission headers");
    return false;
  }

  const token = await getPayPalAccessToken();
  const base = getPayPalApiBase();
  const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }),
  });

  const data = (await res.json()) as {
    verification_status?: string;
    verificationStatus?: string;
    name?: string;
    message?: string;
  };

  if (!res.ok) {
    console.error(
      "[paypal:webhook] verify-webhook-signature failed",
      res.status,
      data?.name ?? data?.message ?? data
    );
    return false;
  }

  const status = data.verification_status ?? data.verificationStatus;
  const ok = status === "SUCCESS";
  if (!ok) {
    console.error("[paypal:webhook] verification_status not SUCCESS:", status, data);
  }
  return ok;
}
