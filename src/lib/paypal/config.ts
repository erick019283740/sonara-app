export function getPayPalApiBase() {
  if (process.env.PAYPAL_API_BASE) {
    return process.env.PAYPAL_API_BASE.replace(/\/$/, "");
  }
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function getPayPalClientId() {
  return process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";
}

export function getPayPalSecret() {
  return process.env.PAYPAL_SECRET ?? "";
}

export function getPayPalWebhookId() {
  return process.env.PAYPAL_WEBHOOK_ID ?? "";
}
