import type { SupabaseClient } from "@supabase/supabase-js";

export type RecordDonationResult =
  | { ok: true; status: "inserted" }
  | { ok: true; status: "duplicate" }
  | { ok: false; message: string };

export type RecordDonationInput = {
  userId: string;
  artistId: string;
  amountEur: number;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
};

/**
 * Idempotent donation + earnings (90% artist). payment_id stored as capture id when present,
 * else order id. Duplicate = existing row with same payment_id as either capture or order id.
 */
export async function recordDonationIfNew(
  admin: SupabaseClient,
  input: RecordDonationInput
): Promise<RecordDonationResult> {
  const { userId, artistId, amountEur, paypalOrderId, paypalCaptureId } = input;

  if (!Number.isFinite(amountEur) || amountEur <= 0) {
    return { ok: false, message: "invalid_amount" };
  }

  const orParts: string[] = [];
  if (paypalCaptureId) orParts.push(`payment_id.eq.${paypalCaptureId}`);
  if (paypalOrderId) orParts.push(`payment_id.eq.${paypalOrderId}`);

  if (orParts.length > 0) {
    const { data: existing, error: exErr } = await admin
      .from("donations")
      .select("id")
      .or(orParts.join(","))
      .limit(1)
      .maybeSingle();

    if (exErr) return { ok: false, message: exErr.message };
    if (existing) return { ok: true, status: "duplicate" };
  }

  const paymentId = paypalCaptureId ?? paypalOrderId;
  if (!paymentId) {
    return { ok: false, message: "missing_payment_id" };
  }

  const { data: artistRow, error: aErr } = await admin
    .from("artists")
    .select("id")
    .eq("id", artistId)
    .maybeSingle();

  if (aErr) return { ok: false, message: aErr.message };
  if (!artistRow) return { ok: false, message: "artist_not_found" };

  const artistShare = Math.round(amountEur * 0.9 * 10000) / 10000;

  const { error: dErr } = await admin.from("donations").insert({
    user_id: userId,
    artist_id: artistId,
    amount: amountEur,
    payment_id: paymentId,
  });

  if (dErr) return { ok: false, message: dErr.message };

  const { error: eErr } = await admin.from("earnings").insert({
    artist_id: artistId,
    amount: artistShare,
    source: "donation",
  });

  if (eErr) return { ok: false, message: eErr.message };

  return { ok: true, status: "inserted" };
}
