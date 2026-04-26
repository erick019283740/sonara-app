import { getPayPalApiBase, getPayPalClientId, getPayPalSecret } from "./config";

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = getPayPalClientId();
  const secret = getPayPalSecret();
  if (!clientId || !secret) {
    throw new Error("PayPal credentials are not configured");
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5000) {
    return cachedToken.value;
  }

  const base = getPayPalApiBase();
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const raw = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!res.ok || !raw.access_token) {
    throw new Error(raw.error ?? `PayPal token error (${res.status})`);
  }

  const ttlMs = (raw.expires_in ?? 300) * 1000;
  cachedToken = { value: raw.access_token, expiresAt: now + ttlMs };
  return raw.access_token;
}

type CreateOrderInput = {
  valueEur: string;
  artistId: string;
  userId: string;
};

export async function paypalCreateOrder(input: CreateOrderInput) {
  const token = await getPayPalAccessToken();
  const base = getPayPalApiBase();
  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.artistId,
          description: "SONARA artist support",
          custom_id: input.userId,
          amount: {
            currency_code: "EUR",
            value: input.valueEur,
          },
        },
      ],
    }),
  });

  const data = (await res.json()) as {
    id?: string;
    status?: string;
    links?: { href: string; rel: string; method: string }[];
    message?: string;
    details?: unknown;
  };

  if (!res.ok || !data.id) {
    const msg =
      typeof data.message === "string"
        ? data.message
        : `PayPal create order failed (${res.status})`;
    throw new Error(msg);
  }

  const approvalUrl = data.links?.find(
    (l) => l.rel === "approve" || l.rel === "payer-action"
  )?.href;

  return { id: data.id, status: data.status, approvalUrl };
}

export async function paypalCaptureOrder(orderId: string) {
  const token = await getPayPalAccessToken();
  const base = getPayPalApiBase();
  const res = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });

  const data = (await res.json()) as PayPalOrderCaptureResponse & {
    details?: { issue?: string }[];
    name?: string;
  };

  if (!res.ok) {
    const issue = data.details?.[0]?.issue ?? data.name;
    if (issue === "ORDER_ALREADY_CAPTURED") {
      return paypalGetOrder(orderId);
    }
    const msg =
      typeof data.message === "string"
        ? data.message
        : `PayPal capture failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

export async function paypalGetOrder(orderId: string) {
  const token = await getPayPalAccessToken();
  const base = getPayPalApiBase();
  const res = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  return (await res.json()) as PayPalOrderCaptureResponse;
}

export type PayPalOrderCaptureResponse = {
  id?: string;
  status?: string;
  message?: string;
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    payments?: {
      captures?: {
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
      }[];
    };
  }[];
};

export function extractVerifiedEurDonation(order: PayPalOrderCaptureResponse): {
  artistId: string;
  payerUserId: string;
  amountEur: number;
  captureId: string | null;
} | null {
  const unit = order.purchase_units?.[0];
  if (!unit?.reference_id || !unit.custom_id) return null;

  const capture = unit.payments?.captures?.[0];
  const valueRaw = capture?.amount?.value;
  const currency = capture?.amount?.currency_code;
  if (!valueRaw || !currency || currency.toUpperCase() !== "EUR") return null;

  const amountEur = Number(valueRaw);
  if (!Number.isFinite(amountEur) || amountEur <= 0) return null;

  return {
    artistId: unit.reference_id,
    payerUserId: unit.custom_id,
    amountEur,
    captureId: capture?.id ?? null,
  };
}
