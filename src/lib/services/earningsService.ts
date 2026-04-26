"use server";

import { createClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { Earnings, StreamPayout } from "@/types/monetization";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

const STREAM_VALUE = new Decimal("0.01");
const ARTIST_CUT = new Decimal("0.60"); // 60/40 split
const PLATFORM_CUT = new Decimal("0.40");
const DECIMAL_PRECISION = 4;

type NumericLike = number | string | Decimal | null | undefined;

type ProcessStreamEarningsOptions = {
  suspicious?: boolean;
  riskScore?: number;
  severity?: "low" | "medium" | "high";
  blockReason?: string;
};

type MigrationSummary = {
  updatedRows: number;
  dryRun: boolean;
  notes: string[];
};

type EarningsRow = {
  artist_id: string;
  total_earnings: NumericLike;
  platform_fee: NumericLike;
  earnings_this_month: NumericLike;
  earnings_last_month: NumericLike;
  updated_at: string;
};

type StreamPayoutRow = {
  id: string;
  artist_id: string;
  song_id: string;
  stream_id: string;
  payout_amount: NumericLike;
  payout_date: string;
  status: "pending" | "completed" | "failed";
};

function toDecimal(value: NumericLike): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return value instanceof Decimal ? value : new Decimal(value);
}

function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(DECIMAL_PRECISION, Decimal.ROUND_HALF_UP);
}

function asNumber(value: NumericLike): number {
  return roundMoney(toDecimal(value)).toNumber();
}

function splitStreamValue(streamValue: Decimal = STREAM_VALUE): {
  artistPayout: Decimal;
  platformFee: Decimal;
} {
  const value = roundMoney(streamValue);
  const artistPayout = roundMoney(value.mul(ARTIST_CUT));
  const platformFee = roundMoney(value.mul(PLATFORM_CUT));
  return { artistPayout, platformFee };
}

async function isStreamBlockedByFraud(): Promise<{
  blocked: boolean;
  suspicious: boolean;
  riskScore: number;
  severity: "low" | "medium" | "high" | null;
}> {
  return { blocked: false, suspicious: false, riskScore: 0, severity: null };
}

async function markPayoutBlocked(params: {
  artistId: string;
  songId: string;
  streamId: string;
  blockReason: string;
  suspicious?: boolean;
  riskScore?: number;
  severity?: "low" | "medium" | "high";
}): Promise<void> {
  await supabase.from("stream_payouts").insert({
    artist_id: params.artistId,
    song_id: params.songId,
    stream_id: params.streamId,
    payout_amount: 0,
    status: "failed",
    block_reason: params.blockReason,
    suspicious: params.suspicious ?? false,
    risk_score: params.riskScore ?? 0,
    severity: params.severity ?? "medium",
    revenue_split_version: "60_40",
    updated_at: new Date().toISOString(),
    payout_date: new Date().toISOString(),
  });
}

export async function processStreamEarnings(
  artistId: string,
  songId: string,
  streamId: string,
  options: ProcessStreamEarningsOptions = {},
): Promise<boolean> {
  try {
    const fraudState = await isStreamBlockedByFraud();
    const shouldBlock =
      fraudState.blocked || options.suspicious === true || false;

    if (shouldBlock) {
      await markPayoutBlocked({
        artistId,
        songId,
        streamId,
        blockReason:
          options.blockReason ??
          (fraudState.blocked
            ? "blocked_by_fraud_detection"
            : "suspicious_stream"),
        suspicious: options.suspicious ?? fraudState.suspicious,
        riskScore: options.riskScore ?? fraudState.riskScore,
        severity: options.severity ?? fraudState.severity ?? "medium",
      });
      return false;
    }

    const { artistPayout, platformFee } = splitStreamValue(STREAM_VALUE);

    const { error: payoutError } = await supabase
      .from("stream_payouts")
      .insert({
        artist_id: artistId,
        song_id: songId,
        stream_id: streamId,
        payout_amount: artistPayout.toNumber(),
        status: "completed",
        suspicious: false,
        risk_score: options.riskScore ?? fraudState.riskScore ?? 0,
        severity: options.severity ?? fraudState.severity ?? "low",
        revenue_split_version: "60_40",
        updated_at: new Date().toISOString(),
        payout_date: new Date().toISOString(),
      });

    if (payoutError) return false;

    const { data: existingEarnings } = await supabase
      .from("earnings")
      .select(
        "artist_id,total_earnings,platform_fee,earnings_this_month,earnings_last_month,updated_at",
      )
      .eq("artist_id", artistId)
      .maybeSingle<EarningsRow>();

    if (existingEarnings) {
      const totalEarnings = roundMoney(
        toDecimal(existingEarnings.total_earnings).add(artistPayout),
      );
      const platformFees = roundMoney(
        toDecimal(existingEarnings.platform_fee).add(platformFee),
      );
      const thisMonth = roundMoney(
        toDecimal(existingEarnings.earnings_this_month).add(artistPayout),
      );

      const { error: updateError } = await supabase
        .from("earnings")
        .update({
          total_earnings: totalEarnings.toNumber(),
          platform_fee: platformFees.toNumber(),
          earnings_this_month: thisMonth.toNumber(),
          updated_at: new Date().toISOString(),
        })
        .eq("artist_id", artistId);

      return !updateError;
    }

    const { error: insertError } = await supabase.from("earnings").insert({
      artist_id: artistId,
      total_earnings: artistPayout.toNumber(),
      platform_fee: platformFee.toNumber(),
      earnings_this_month: artistPayout.toNumber(),
      earnings_last_month: 0,
      revenue_split_version: "60_40",
      updated_at: new Date().toISOString(),
    });

    return !insertError;
  } catch (error) {
    console.error("Error in processStreamEarnings:", error);
    return false;
  }
}

export async function getArtistEarnings(
  artistId: string,
): Promise<Earnings | null> {
  const { data, error } = await supabase
    .from("earnings")
    .select(
      "artist_id,total_earnings,platform_fee,earnings_this_month,earnings_last_month,updated_at",
    )
    .eq("artist_id", artistId)
    .maybeSingle<EarningsRow>();

  if (error || !data) {
    return {
      artistId,
      totalEarnings: 0,
      platformFee: 0,
      earningsThisMonth: 0,
      earningsLastMonth: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    artistId: data.artist_id,
    totalEarnings: asNumber(data.total_earnings),
    platformFee: asNumber(data.platform_fee),
    earningsThisMonth: asNumber(data.earnings_this_month),
    earningsLastMonth: asNumber(data.earnings_last_month),
    updatedAt: data.updated_at,
  };
}

export async function getPlatformTotalEarnings(): Promise<{
  totalArtistPayouts: number;
  totalPlatformFees: number;
}> {
  const { data, error } = await supabase
    .from("earnings")
    .select("total_earnings,platform_fee");

  if (error) {
    return { totalArtistPayouts: 0, totalPlatformFees: 0 };
  }

  const totals = (data || []).reduce(
    (acc, row) => {
      acc.totalArtistPayouts = roundMoney(
        acc.totalArtistPayouts.add(toDecimal(row.total_earnings)),
      );
      acc.totalPlatformFees = roundMoney(
        acc.totalPlatformFees.add(toDecimal(row.platform_fee)),
      );
      return acc;
    },
    {
      totalArtistPayouts: new Decimal(0),
      totalPlatformFees: new Decimal(0),
    },
  );

  return {
    totalArtistPayouts: totals.totalArtistPayouts.toNumber(),
    totalPlatformFees: totals.totalPlatformFees.toNumber(),
  };
}

export async function getArtistMonthlyBreakdown(artistId: string): Promise<{
  thisMonth: number;
  lastMonth: number;
  monthGrowth: number;
}> {
  const earnings = await getArtistEarnings(artistId);

  if (!earnings) {
    return { thisMonth: 0, lastMonth: 0, monthGrowth: 0 };
  }

  const thisMonth = toDecimal(earnings.earningsThisMonth);
  const lastMonth = toDecimal(earnings.earningsLastMonth);

  const growth = lastMonth.gt(0)
    ? thisMonth.minus(lastMonth).div(lastMonth).mul(100)
    : new Decimal(0);

  return {
    thisMonth: asNumber(thisMonth),
    lastMonth: asNumber(lastMonth),
    monthGrowth: growth.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
  };
}

export async function getTopEarningArtists(
  limit: number = 20,
): Promise<Earnings[]> {
  const { data, error } = await supabase
    .from("earnings")
    .select(
      "artist_id,total_earnings,platform_fee,earnings_this_month,earnings_last_month,updated_at",
    )
    .order("total_earnings", { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data as EarningsRow[]).map((row) => ({
    artistId: row.artist_id,
    totalEarnings: asNumber(row.total_earnings),
    platformFee: asNumber(row.platform_fee),
    earningsThisMonth: asNumber(row.earnings_this_month),
    earningsLastMonth: asNumber(row.earnings_last_month),
    updatedAt: row.updated_at,
  }));
}

export async function getArtistPayoutHistory(
  artistId: string,
  limit: number = 50,
): Promise<StreamPayout[]> {
  const { data, error } = await supabase
    .from("stream_payouts")
    .select("id,artist_id,song_id,stream_id,payout_amount,payout_date,status")
    .eq("artist_id", artistId)
    .order("payout_date", { ascending: false })
    .limit(limit);

  if (error) return [];

  return ((data || []) as StreamPayoutRow[]).map((row) => ({
    id: row.id,
    artistId: row.artist_id,
    songId: row.song_id,
    streamId: row.stream_id,
    payoutAmount: asNumber(row.payout_amount),
    payoutDate: row.payout_date,
    status: row.status,
  }));
}

/**
 * Safe migration helper:
 * Recalculates platform_fee as 40/60 counterpart of historical total_earnings.
 * Keeps artist payouts unchanged and only harmonizes fee accounting.
 */
export async function migrateRevenueSplitTo6040(
  dryRun: boolean = true,
): Promise<MigrationSummary> {
  const notes: string[] = [];
  const { data, error } = await supabase
    .from("earnings")
    .select("artist_id,total_earnings,platform_fee");

  if (error) {
    return {
      updatedRows: 0,
      dryRun,
      notes: [`failed_to_fetch_rows:${error.message}`],
    };
  }

  let updatedRows = 0;

  for (const row of data || []) {
    const artistTotal = toDecimal(row.total_earnings);
    if (artistTotal.lte(0)) continue;

    const gross = artistTotal.div(ARTIST_CUT); // artist share is 60% now
    const expectedPlatformFee = roundMoney(gross.mul(PLATFORM_CUT));
    const currentPlatformFee = roundMoney(toDecimal(row.platform_fee));
    const delta = expectedPlatformFee.minus(currentPlatformFee).abs();

    // only update if meaningful delta
    if (delta.lt(new Decimal("0.0001"))) continue;

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from("earnings")
        .update({
          platform_fee: expectedPlatformFee.toNumber(),
          revenue_split_version: "60_40",
          updated_at: new Date().toISOString(),
        })
        .eq("artist_id", row.artist_id);

      if (updateError) {
        notes.push(`update_failed:${row.artist_id}:${updateError.message}`);
        continue;
      }
    }

    updatedRows += 1;
  }

  notes.push(
    dryRun
      ? "dry_run_completed_no_writes"
      : "migration_completed_platform_fee_rebalanced_to_60_40",
  );

  return { updatedRows, dryRun, notes };
}

/**
 * Safe migration helper:
 * Rewrites completed payout rows to 60/40 payout amount (idempotent on stream_id).
 * Requires stream_payouts.revenue_split_version and unique stream_id for best safety.
 */
export async function migrateStreamPayoutsTo6040(
  dryRun: boolean = true,
  batchSize: number = 500,
): Promise<MigrationSummary> {
  const notes: string[] = [];
  let updatedRows = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("stream_payouts")
      .select("id,stream_id,payout_amount,status")
      .eq("status", "completed")
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      notes.push(`fetch_failed:${error.message}`);
      break;
    }

    const rows = (data || []) as Array<{
      id: string;
      stream_id: string;
      payout_amount: NumericLike;
      status: "pending" | "completed" | "failed";
    }>;

    if (rows.length === 0) break;

    for (const row of rows) {
      // expected completed artist payout per stream with 60/40
      const expected = splitStreamValue(STREAM_VALUE).artistPayout;
      const current = roundMoney(toDecimal(row.payout_amount));
      if (expected.equals(current)) continue;

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("stream_payouts")
          .update({
            payout_amount: expected.toNumber(),
            revenue_split_version: "60_40",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (upErr) {
          notes.push(`row_update_failed:${row.id}:${upErr.message}`);
          continue;
        }
      }

      updatedRows += 1;
    }

    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  notes.push(
    dryRun
      ? "dry_run_completed_no_payout_updates"
      : "stream_payouts_migrated_to_60_40",
  );

  return { updatedRows, dryRun, notes };
}
