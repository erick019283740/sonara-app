/**
 * Batch Aggregation Service
 * Processes uncounted streams → creates revenue_events + updates stats
 * Designed to run every 30-60 seconds via cron or edge function
 *
 * GUARANTEES:
 *   - 1 valid stream = exactly 1 revenue_event
 *   - Suspicious streams are NEVER monetized
 *   - Stats are incremental only (no live COUNT)
 *   - Revenue events are immutable (DB trigger blocks UPDATE/DELETE)
 */

"use server";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

const BATCH_SIZE = 500;
const STREAM_GROSS = 0.01;
const ARTIST_CUT = 0.7;
const PLATFORM_CUT = 0.3;

export interface BatchResult {
  processed: number;
  revenueEventsCreated: number;
  alreadyExisted: number;
  suspiciousSkipped: number;
  errors: string[];
  durationMs: number;
  idempotent: boolean;
}

export interface IntegrityCheckResult {
  intact: boolean;
  streamsCounted: number;
  positiveEvents: number;
  reversalEvents: number;
  netEvents: number;
  orphanedStreams: number;
  orphanedRevenue: number;
  suspiciousPendingReview: number;
  match: boolean;
  revenueMatch: boolean;
  netArtistRevenue: number;
  statsArtistRevenue: number;
}

/**
 * Run batch processing via DB RPC
 * This is the PRIMARY method - uses the atomic process_stream_batch function
 */
export async function runStreamBatch(
  batchSize: number = BATCH_SIZE
): Promise<BatchResult> {
  const start = Date.now();
  const errors: string[] = [];

  try {
    const { data, error } = await supabase.rpc("process_stream_batch", {
      p_batch_size: batchSize,
    });

    if (error) {
      errors.push(`RPC error: ${error.message}`);
      return {
        processed: 0,
        revenueEventsCreated: 0,
        alreadyExisted: 0,
        suspiciousSkipped: 0,
        errors,
        durationMs: Date.now() - start,
        idempotent: false,
      };
    }

    const result = data as {
      processed: number;
      revenue_events_created: number;
      already_existed: number;
      suspicious_skipped: number;
      batch_size: number;
      idempotent: boolean;
    };

    return {
      processed: result.processed,
      revenueEventsCreated: result.revenue_events_created,
      alreadyExisted: result.already_existed,
      suspiciousSkipped: result.suspicious_skipped,
      errors,
      durationMs: Date.now() - start,
      idempotent: result.idempotent,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown batch error";
    errors.push(msg);
    return {
      processed: 0,
      revenueEventsCreated: 0,
      alreadyExisted: 0,
      suspiciousSkipped: 0,
      errors,
      durationMs: Date.now() - start,
      idempotent: false,
    };
  }
}

/**
 * Verify revenue integrity
 * Checks that every counted stream has exactly 1 revenue event
 */
export async function verifyRevenueIntegrity(): Promise<IntegrityCheckResult> {
  const { data, error } = await supabase.rpc("verify_revenue_integrity");

  if (error) {
    return {
      intact: false,
      streamsCounted: -1,
      positiveEvents: -1,
      reversalEvents: -1,
      netEvents: -1,
      orphanedStreams: -1,
      orphanedRevenue: -1,
      suspiciousPendingReview: -1,
      match: false,
      revenueMatch: false,
      netArtistRevenue: -1,
      statsArtistRevenue: -1,
    };
  }

  return (data as unknown) as IntegrityCheckResult;
}

/**
 * Flag a stream as suspicious (admin action)
 * Reverses any revenue already counted for that stream
 */
export async function flagStreamSuspicious(
  streamId: string,
  reason: string
): Promise<{ ok: boolean; revenueReversed: boolean }> {
  const { data, error } = await supabase.rpc("flag_stream_suspicious", {
    p_stream_id: streamId,
    p_reason: reason,
  });

  if (error) {
    console.error("[BatchService] flagStreamSuspicious error:", error);
    return { ok: false, revenueReversed: false };
  }

  const result = data as { ok: boolean; stream_id: string; revenue_reversed: boolean };
  return { ok: result.ok, revenueReversed: result.revenue_reversed };
}

/**
 * Get batch processing status
 */
export async function getBatchStatus(): Promise<{
  unprocessedStreams: number;
  suspiciousStreams: number;
  totalRevenueEvents: number;
  lastBatchResult: BatchResult | null;
}> {
  // Count unprocessed valid streams
  const { count: unprocessed } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("is_valid", true)
    .eq("is_suspicious", false)
    .eq("revenue_counted", false);

  // Count suspicious streams pending review
  const { count: suspicious } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("is_suspicious", true)
    .eq("revenue_counted", false);

  // Total revenue events
  const { count: totalRevenue } = await supabase
    .from("revenue_events")
    .select("id", { count: "exact", head: true });

  return {
    unprocessedStreams: unprocessed || 0,
    suspiciousStreams: suspicious || 0,
    totalRevenueEvents: totalRevenue || 0,
    lastBatchResult: null,
  };
}

/**
 * Process streams with client-side logic (fallback if RPC unavailable)
 * This handles the batch processing in TypeScript when the DB RPC is not yet migrated
 */
export async function runStreamBatchClientSide(
  batchSize: number = BATCH_SIZE
): Promise<BatchResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0;
  let revenueEventsCreated = 0;
  let alreadyExisted = 0;
  let suspiciousSkipped = 0;

  try {
    // Step 1: Fetch unprocessed valid streams
    const { data: streams, error: fetchError } = await supabase
      .from("streams")
      .select("id, song_id, user_id, seconds_played, created_at")
      .eq("is_valid", true)
      .eq("is_suspicious", false)
      .eq("revenue_counted", false)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (fetchError) {
      errors.push(`Fetch error: ${fetchError.message}`);
      return { processed: 0, revenueEventsCreated: 0, alreadyExisted: 0, suspiciousSkipped: 0, errors, durationMs: Date.now() - start, idempotent: false };
    }

    if (!streams || streams.length === 0) {
      return { processed: 0, revenueEventsCreated: 0, alreadyExisted: 0, suspiciousSkipped: 0, errors, durationMs: Date.now() - start, idempotent: true };
    }

    // Step 2: Process each stream
    for (const stream of streams) {
      // Resolve artist_id from song
      const { data: song } = await supabase
        .from("songs")
        .select("artist_id")
        .eq("id", stream.song_id)
        .maybeSingle();

      if (!song?.artist_id) {
        // Orphaned song - mark as processed but skip revenue
        await supabase
          .from("streams")
          .update({ revenue_counted: true, processed_at: new Date().toISOString() })
          .eq("id", stream.id);
        continue;
      }

      const artistShare = Math.round(STREAM_GROSS * ARTIST_CUT * 1000000) / 1000000;
      const platformShare = Math.round(STREAM_GROSS * PLATFORM_CUT * 1000000) / 1000000;

      // Step 3: Create revenue event (idempotent - ignore if already exists)
      const { error: revError } = await supabase
        .from("revenue_events")
        .insert({
          stream_id: stream.id,
          artist_id: song.artist_id,
          amount_gross: STREAM_GROSS,
          amount_artist: artistShare,
          amount_platform: platformShare,
          source: "stream",
          revenue_split_version: "70_30",
        });

      if (revError) {
        // Check if it's a unique constraint violation (already exists = idempotent)
        if (revError.message?.includes("duplicate") || revError.message?.includes("unique") || revError.code === "23505") {
          alreadyExisted++;
        } else {
          errors.push(`Revenue event error for stream ${stream.id}: ${revError.message}`);
          continue;
        }
      } else {
        revenueEventsCreated++;
      }

      // Step 4: Update song_stats (incremental)
      await supabase
        .from("song_stats")
        .upsert(
          {
            song_id: stream.song_id,
            total_streams: 1,
            total_playtime_seconds: stream.seconds_played,
            stream_revenue: artistShare,
          },
          { onConflict: "song_id" }
        );

      // Increment song_stats (upsert doesn't add, so we update)
      const { data: currentStats } = await supabase
        .from("song_stats")
        .select("total_streams, total_playtime_seconds, stream_revenue")
        .eq("song_id", stream.song_id)
        .maybeSingle();

      if (currentStats) {
        await supabase
          .from("song_stats")
          .update({
            total_streams: (currentStats.total_streams || 0) + 1,
            total_playtime_seconds: (currentStats.total_playtime_seconds || 0) + stream.seconds_played,
            stream_revenue: (currentStats.stream_revenue || 0) + artistShare,
            updated_at: new Date().toISOString(),
          })
          .eq("song_id", stream.song_id);
      }

      // Step 5: Update artist_stats (incremental)
      const { data: currentArtistStats } = await supabase
        .from("artist_stats")
        .select("total_streams, total_playtime_seconds, total_stream_revenue")
        .eq("artist_id", song.artist_id)
        .maybeSingle();

      if (currentArtistStats) {
        await supabase
          .from("artist_stats")
          .update({
            total_streams: (currentArtistStats.total_streams || 0) + 1,
            total_playtime_seconds: (currentArtistStats.total_playtime_seconds || 0) + stream.seconds_played,
            total_stream_revenue: (currentArtistStats.total_stream_revenue || 0) + artistShare,
            updated_at: new Date().toISOString(),
          })
          .eq("artist_id", song.artist_id);
      } else {
        await supabase.from("artist_stats").insert({
          artist_id: song.artist_id,
          total_streams: 1,
          total_playtime_seconds: stream.seconds_played,
          total_stream_revenue: artistShare,
        });
      }

      // Step 6: Mark stream as processed
      await supabase
        .from("streams")
        .update({
          revenue_counted: true,
          processed_at: new Date().toISOString(),
        })
        .eq("id", stream.id);

      processed++;
    }

    // Count suspicious skipped
    const { count: suspCount } = await supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("is_suspicious", true)
      .eq("revenue_counted", false);

    suspiciousSkipped = suspCount || 0;

    return {
      processed,
      revenueEventsCreated,
      alreadyExisted,
      suspiciousSkipped,
      errors,
      durationMs: Date.now() - start,
      idempotent: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown batch error";
    errors.push(msg);
    return { processed, revenueEventsCreated, alreadyExisted, suspiciousSkipped, errors, durationMs: Date.now() - start, idempotent: false };
  }
}
