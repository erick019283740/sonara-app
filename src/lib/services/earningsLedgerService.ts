import { createClient } from "@supabase/supabase-js";
import { Decimal } from "decimal.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Monetary precision: store and process money as Decimal, round to 2dp for cent-safe operations.
const CENTS_DP = 2;
const CURRENCY = "USD";
const ARTIST_STREAM_SPLIT = new Decimal("0.60");
const ARTIST_DONATION_SPLIT = new Decimal("0.90");

function toDecimal(
  value: string | number | Decimal | null | undefined,
): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return value instanceof Decimal ? value : new Decimal(value);
}

function toCents(value: string | number | Decimal): Decimal {
  return toDecimal(value).toDecimalPlaces(CENTS_DP, Decimal.ROUND_HALF_UP);
}

function monthRange(month: string): { periodStart: string; periodEnd: string } {
  // expects YYYY-MM
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    throw new Error(`Invalid month format "${month}". Expected YYYY-MM`);
  }

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));

  return {
    periodStart: start.toISOString().slice(0, 10), // YYYY-MM-DD
    periodEnd: end.toISOString().slice(0, 10), // YYYY-MM-DD
  };
}

function normalizeLedgerAmount(
  transactionType: string,
  amount: string | number | Decimal,
): Decimal {
  const cents = toCents(amount);
  if (transactionType === "payout" || transactionType === "refund") {
    // payouts/refunds reduce artist balance in ledger
    return cents.negated();
  }
  return cents;
}

type TransactionType =
  | "stream"
  | "donation"
  | "payout"
  | "adjustment"
  | "refund";

export interface LedgerEntry {
  id: string;
  artistId: string;
  transactionType: TransactionType;
  amount: Decimal;
  currency: string;
  metadata: Record<string, unknown> | null;
  status: "pending" | "posted" | "settled" | "reversed";
  createdAt: string;
  postedAt?: string;
}

export interface PayoutHistoryItem {
  id: string;
  artistId: string;
  amount: Decimal;
  currency: string;
  status: "locked" | "processing" | "paid" | "failed" | "reverted";
  periodStart: string;
  periodEnd: string;
  externalPayoutId?: string | null;
  processedAt?: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export async function recordStreamEarning(
  artistId: string,
  streamId: string,
  songId: string,
  grossAmount: Decimal,
): Promise<void> {
  const gross = toCents(grossAmount);
  const artistAmount = toCents(gross.mul(ARTIST_STREAM_SPLIT));
  const platformAmount = toCents(gross.minus(artistAmount));

  const txId = `stream_${streamId}`;

  const { error: ledgerErr } = await supabase.from("earnings_ledger").upsert(
    {
      artist_id: artistId,
      transaction_type: "stream",
      amount: artistAmount.toString(),
      currency: CURRENCY,
      source_id: streamId,
      source_metadata: { stream_id: streamId, song_id: songId },
      status: "posted",
      transaction_id: txId,
      posted_at: new Date().toISOString(),
      created_by: "system",
    },
    { onConflict: "transaction_id", ignoreDuplicates: true },
  );

  if (ledgerErr) {
    throw new Error(`Failed to record stream earning: ${ledgerErr.message}`);
  }

  const { error: platformErr } = await supabase
    .from("platform_earnings")
    .insert({
      amount: platformAmount.toString(),
      currency: CURRENCY,
      source_type: "stream",
      source_id: streamId,
      period_date: new Date().toISOString().slice(0, 10),
    });

  if (platformErr) {
    throw new Error(
      `Failed to record platform stream earning: ${platformErr.message}`,
    );
  }
}

export async function recordDonation(
  artistId: string,
  donationId: string,
  grossAmount: Decimal,
): Promise<void> {
  const gross = toCents(grossAmount);
  const artistAmount = toCents(gross.mul(ARTIST_DONATION_SPLIT));
  const platformAmount = toCents(gross.minus(artistAmount));

  const txId = `donation_${donationId}`;

  const { error: ledgerErr } = await supabase.from("earnings_ledger").upsert(
    {
      artist_id: artistId,
      transaction_type: "donation",
      amount: artistAmount.toString(),
      currency: CURRENCY,
      source_id: donationId,
      source_metadata: { donation_id: donationId },
      status: "posted",
      transaction_id: txId,
      posted_at: new Date().toISOString(),
      created_by: "system",
    },
    { onConflict: "transaction_id", ignoreDuplicates: true },
  );

  if (ledgerErr) {
    throw new Error(`Failed to record donation: ${ledgerErr.message}`);
  }

  const { error: platformErr } = await supabase
    .from("platform_earnings")
    .insert({
      amount: platformAmount.toString(),
      currency: CURRENCY,
      source_type: "donation",
      source_id: donationId,
      period_date: new Date().toISOString().slice(0, 10),
    });

  if (platformErr) {
    throw new Error(
      `Failed to record platform donation earning: ${platformErr.message}`,
    );
  }
}

export async function getArtistBalance(artistId: string): Promise<Decimal> {
  const { data, error } = await supabase
    .from("earnings_ledger")
    .select("transaction_type, amount")
    .eq("artist_id", artistId)
    .in("status", ["posted", "settled"]);

  if (error) {
    throw new Error(`Failed to load artist balance: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row) => {
    const amt = normalizeLedgerAmount(
      String(row.transaction_type),
      row.amount as string,
    );
    return sum.plus(amt);
  }, new Decimal(0));
}

export async function getMonthlyEarnings(
  artistId: string,
  month: string,
): Promise<Decimal> {
  const [year, monthNum] = month.split("-");
  if (!year || !monthNum) throw new Error(`Invalid month format "${month}"`);

  const startDate = `${year}-${monthNum}-01T00:00:00.000Z`;
  const endDate = new Date(
    Date.UTC(Number(year), Number(monthNum), 0, 23, 59, 59, 999),
  ).toISOString();

  const { data, error } = await supabase
    .from("earnings_ledger")
    .select("transaction_type, amount")
    .eq("artist_id", artistId)
    .in("status", ["posted", "settled"])
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  if (error) {
    throw new Error(`Failed to get monthly earnings: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row) => {
    const amount = normalizeLedgerAmount(
      String(row.transaction_type),
      row.amount as string,
    );
    return sum.plus(amount);
  }, new Decimal(0));
}

/**
 * Creates a DB-backed payout lock.
 * - Enforced by unique(artist_id, period_start, period_end) in payout_locks table
 * - Returns null if a lock already exists or amount is <= 0
 */
export async function createPayout(
  artistId: string,
  month: string,
): Promise<string | null> {
  const { periodStart, periodEnd } = monthRange(month);
  const amount = toCents(await getMonthlyEarnings(artistId, month));

  if (amount.lte(0)) return null;

  // Anti double payout lock: if exists for this period, do not create another.
  const { data: existing, error: existingErr } = await supabase
    .from("payout_locks")
    .select("id, status")
    .eq("artist_id", artistId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Failed to check payout lock: ${existingErr.message}`);
  }

  if (existing?.id) {
    return null;
  }

  const { data: lock, error: lockErr } = await supabase
    .from("payout_locks")
    .insert({
      artist_id: artistId,
      period_start: periodStart,
      period_end: periodEnd,
      total_amount: amount.toString(),
      status: "locked",
      payout_method: "manual",
    })
    .select("id")
    .single();

  if (lockErr) {
    // unique violation fallback: treat as already locked
    if (lockErr.code === "23505") return null;
    throw new Error(`Failed to create payout lock: ${lockErr.message}`);
  }

  return lock.id as string;
}

/**
 * Processes payout lock with state transition and ledger entry.
 * Uses optimistic status transition (locked|failed -> processing -> paid|failed).
 */
export async function processPayout(
  payoutLockId: string,
  externalPayoutId?: string,
): Promise<boolean> {
  // Step 1: move lock into processing state only if currently lockable
  const { data: lock, error: lockErr } = await supabase
    .from("payout_locks")
    .select("id, artist_id, total_amount, status")
    .eq("id", payoutLockId)
    .maybeSingle();

  if (lockErr || !lock) {
    return false;
  }

  if (!["locked", "failed"].includes(String(lock.status))) {
    return false;
  }

  const nowIso = new Date().toISOString();

  const { error: toProcessingErr } = await supabase
    .from("payout_locks")
    .update({
      status: "processing",
      processed_at: nowIso,
      external_payout_id: externalPayoutId ?? null,
      updated_at: nowIso,
    })
    .eq("id", payoutLockId)
    .in("status", ["locked", "failed"]);

  if (toProcessingErr) {
    return false;
  }

  // Step 2: write immutable payout ledger entry (negative impact on balance)
  const payoutAmount = toCents(lock.total_amount as string);
  const payoutTxId = `payout_lock_${payoutLockId}`;

  const { error: ledgerErr } = await supabase.from("earnings_ledger").upsert(
    {
      artist_id: lock.artist_id,
      transaction_type: "payout",
      amount: payoutAmount.toString(), // normalized as deduction by balance calculators
      currency: CURRENCY,
      source_id: payoutLockId,
      source_metadata: {
        payout_lock_id: payoutLockId,
        external_payout_id: externalPayoutId ?? null,
      },
      status: "settled",
      transaction_id: payoutTxId,
      posted_at: nowIso,
      settled_at: nowIso,
      created_by: "system",
    },
    { onConflict: "transaction_id", ignoreDuplicates: true },
  );

  if (ledgerErr) {
    await supabase
      .from("payout_locks")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", payoutLockId);
    return false;
  }

  // Step 3: mark paid
  const { error: paidErr } = await supabase
    .from("payout_locks")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", payoutLockId)
    .eq("status", "processing");

  if (paidErr) {
    return false;
  }

  return true;
}

export async function getPayoutHistory(
  artistId: string,
  limit = 12,
): Promise<PayoutHistoryItem[]> {
  const { data, error } = await supabase
    .from("payout_locks")
    .select(
      "id, artist_id, total_amount, status, payout_method, external_payout_id, period_start, period_end, processed_at, paid_at, created_at",
    )
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get payout history: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    artistId: String(row.artist_id),
    amount: toCents(row.total_amount as string),
    currency: CURRENCY,
    status: row.status as PayoutHistoryItem["status"],
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    externalPayoutId: (row.external_payout_id as string | null) ?? null,
    processedAt: (row.processed_at as string | null) ?? null,
    paidAt: (row.paid_at as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
}

export async function getMonthlyBreakdown(
  artistId: string,
): Promise<{ month: string; amount: string }[]> {
  const { data, error } = await supabase
    .from("earnings_ledger")
    .select("created_at, transaction_type, amount")
    .eq("artist_id", artistId)
    .in("status", ["posted", "settled"])
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to get monthly breakdown: ${error.message}`);
  }

  const breakdown: Record<string, Decimal> = {};

  for (const row of data ?? []) {
    const createdAt = String(row.created_at);
    const month = createdAt.slice(0, 7);
    const normalized = normalizeLedgerAmount(
      String(row.transaction_type),
      row.amount as string,
    );

    if (!breakdown[month]) breakdown[month] = new Decimal(0);
    breakdown[month] = breakdown[month].plus(normalized);
  }

  return Object.entries(breakdown)
    .map(([month, amount]) => ({
      month,
      amount: toCents(amount).toString(),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}
