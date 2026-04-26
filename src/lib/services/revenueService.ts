/**
 * Revenue Service
 * Immutable ledger operations, revenue calculation, audit queries
 * All monetization flows must go through this service
 */

"use server";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

export interface RevenueReport {
  artistId: string;
  period: { from: string; to: string };
  streams: { count: number; revenue: number };
  donations: { count: number; revenue: number };
  adRevenue: number;
  totalRevenue: number;
}

export interface LedgerEntry {
  id: string;
  transactionType: string;
  artistId: string;
  songId: string | null;
  streamId: string | null;
  donationId: string | null;
  amountGross: number;
  amountArtist: number;
  amountPlatform: number;
  source: string;
  revenueSplitVersion: string;
  createdAt: string;
}

const STREAM_GROSS = 0.01;
const ARTIST_CUT_STREAM = 0.7;
const PLATFORM_CUT_STREAM = 0.3;

/**
 * Calculate revenue split for a stream
 */
export function calculateStreamRevenue(): {
  gross: number;
  artist: number;
  platform: number;
} {
  const gross = STREAM_GROSS;
  const artist = Math.round(gross * ARTIST_CUT_STREAM * 10000) / 10000;
  const platform = Math.round(gross * PLATFORM_CUT_STREAM * 10000) / 10000;
  return { gross, artist, platform };
}

/**
 * Calculate revenue split for a donation
 */
export function calculateDonationRevenue(amount: number): {
  gross: number;
  artist: number;
  platform: number;
} {
  const artist = Math.round(amount * 0.9 * 10000) / 10000;
  const platform = Math.round(amount * 0.1 * 10000) / 10000;
  return { gross: amount, artist, platform };
}

/**
 * Get revenue ledger for artist (immutable audit trail)
 */
export async function getArtistLedger(
  artistId: string,
  options: {
    from?: string;
    to?: string;
    transactionType?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ entries: LedgerEntry[]; total: number }> {
  const { from, to, transactionType, limit = 100, offset = 0 } = options;

  let query = supabase
    .from("revenue_events")
    .select("*", { count: "exact" })
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);
  if (transactionType) query = query.eq("source", transactionType);

  const { data, error, count } = await query;

  if (error) {
    console.error("[RevenueService] getArtistLedger error:", error);
    throw new Error("Failed to fetch ledger");
  }

  const entries: LedgerEntry[] = (data || []).map((row) => ({
    id: row.id,
    transactionType: row.source,
    artistId: row.artist_id,
    songId: null,
    streamId: row.stream_id,
    donationId: row.donation_id,
    amountGross: parseFloat(row.amount_gross),
    amountArtist: parseFloat(row.amount_artist),
    amountPlatform: parseFloat(row.amount_platform),
    source: row.source,
    revenueSplitVersion: row.revenue_split_version,
    createdAt: row.created_at,
  }));

  return { entries, total: count || 0 };
}

/**
 * Get aggregated revenue report for artist
 */
export async function getArtistRevenueReport(
  artistId: string,
  from?: string,
  to?: string
): Promise<RevenueReport> {
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  // Fetch from revenue_events (immutable source)
  const { data: ledger } = await supabase
    .from("revenue_events")
    .select("source, amount_artist")
    .eq("artist_id", artistId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const entries = ledger || [];

  let streamRevenue = 0;
  let streamCount = 0;
  let donationRevenue = 0;
  let donationCount = 0;
  let adRevenue = 0;

  for (const entry of entries) {
    const amount = parseFloat(entry.amount_artist) || 0;
    switch (entry.source) {
      case "stream":
        streamRevenue += amount;
        streamCount++;
        break;
      case "donation":
        donationRevenue += amount;
        donationCount++;
        break;
      case "ad_impression":
      case "ad_click":
        adRevenue += amount;
        break;
    }
  }

  return {
    artistId,
    period: { from: fromDate, to: toDate },
    streams: { count: streamCount, revenue: Math.round(streamRevenue * 10000) / 10000 },
    donations: { count: donationCount, revenue: Math.round(donationRevenue * 10000) / 10000 },
    adRevenue: Math.round(adRevenue * 10000) / 10000,
    totalRevenue: Math.round((streamRevenue + donationRevenue + adRevenue) * 10000) / 10000,
  };
}

/**
 * Get platform-wide revenue summary (admin only)
 */
export async function getPlatformRevenueSummary(
  from?: string,
  to?: string
): Promise<{
  totalGross: number;
  totalArtist: number;
  totalPlatform: number;
  byType: Record<string, { gross: number; artist: number; platform: number }>;
}> {
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  const { data } = await supabase
    .from("revenue_events")
    .select("source, amount_gross, amount_artist, amount_platform")
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const entries = data || [];

  let totalGross = 0;
  let totalArtist = 0;
  let totalPlatform = 0;
  const byType: Record<string, { gross: number; artist: number; platform: number }> = {};

  for (const entry of entries) {
    const gross = parseFloat(entry.amount_gross) || 0;
    const artist = parseFloat(entry.amount_artist) || 0;
    const platform = parseFloat(entry.amount_platform) || 0;

    totalGross += gross;
    totalArtist += artist;
    totalPlatform += platform;

    const type = entry.source;
    if (!byType[type]) {
      byType[type] = { gross: 0, artist: 0, platform: 0 };
    }
    byType[type].gross += gross;
    byType[type].artist += artist;
    byType[type].platform += platform;
  }

  return {
    totalGross: Math.round(totalGross * 10000) / 10000,
    totalArtist: Math.round(totalArtist * 10000) / 10000,
    totalPlatform: Math.round(totalPlatform * 10000) / 10000,
    byType,
  };
}

/**
 * Verify ledger integrity
 * Checks that artist earnings match ledger totals
 */
export async function verifyLedgerIntegrity(artistId: string): Promise<{
  valid: boolean;
  earningsTotal: number;
  ledgerTotal: number;
  discrepancy: number;
}> {
  const { data: earnings } = await supabase
    .from("earnings")
    .select("amount")
    .eq("artist_id", artistId);

  const { data: ledger } = await supabase
    .from("revenue_events")
    .select("amount_artist")
    .eq("artist_id", artistId);

  const earningsTotal = (earnings || []).reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const ledgerTotal = (ledger || []).reduce((sum, l) => sum + parseFloat(l.amount_artist), 0);

  const discrepancy = Math.abs(earningsTotal - ledgerTotal);

  return {
    valid: discrepancy < 0.0001,
    earningsTotal: Math.round(earningsTotal * 10000) / 10000,
    ledgerTotal: Math.round(ledgerTotal * 10000) / 10000,
    discrepancy: Math.round(discrepancy * 10000) / 10000,
  };
}
