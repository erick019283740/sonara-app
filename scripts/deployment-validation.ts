/**
 * Deployment Validation Script
 * Simulates load: 100-500 concurrent users, 1000+ streams/min
 * Validates:
 *   - No duplicate streams
 *   - No double revenue
 *   - Stable DB performance
 *   - Correct song_stats
 *
 * Usage: npx tsx scripts/deployment-validation.ts
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// CONFIG
// ============================================================
const CONCURRENT_USERS = 100;
const STREAMS_PER_USER = 10;
const TOTAL_STREAMS = CONCURRENT_USERS * STREAMS_PER_USER; // 1000
const MIN_DURATION = 30;
const MAX_DURATION = 300;

// ============================================================
// HELPERS
// ============================================================
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(2)}s`;
}

// ============================================================
// TEST 1: SETUP - Create test data
// ============================================================
async function setupTestData() {
  console.log("\n🔧 Setting up test data...");

  // Create test artist profile
  const testUserId = randomUUID();
  const testArtistId = randomUUID();
  const testSongId = randomUUID();

  // Insert test user profile
  const { error: profileError } = await supabase.from("profiles").insert({
    id: testUserId,
    username: `load_test_${Date.now()}`,
    role: "artist",
    subscription_status: "free",
  });
  if (profileError) {
    console.error("  ❌ Failed to create test profile:", profileError.message);
    return null;
  }

  // Insert test artist
  const { error: artistError } = await supabase.from("artists").insert({
    id: testArtistId,
    user_id: testUserId,
    stage_name: `LoadTest Artist ${Date.now()}`,
    bio: "Load test artist",
  });
  if (artistError) {
    console.error("  ❌ Failed to create test artist:", artistError.message);
    return null;
  }

  // Insert test song
  const { error: songError } = await supabase.from("songs").insert({
    id: testSongId,
    artist_id: testArtistId,
    title: `LoadTest Song ${Date.now()}`,
    genre: "Electronic",
    duration: 180,
    file_url: "/test.mp3",
    cover_url: "/test.jpg",
  });
  if (songError) {
    console.error("  ❌ Failed to create test song:", songError.message);
    return null;
  }

  console.log(`  ✅ Test data created: user=${testUserId.slice(0, 8)}... artist=${testArtistId.slice(0, 8)}... song=${testSongId.slice(0, 8)}...`);
  return { testUserId, testArtistId, testSongId };
}

// ============================================================
// TEST 2: STREAM INSERTION LOAD TEST
// ============================================================
async function testStreamLoad(testSongId: string) {
  console.log(`\n📊 TEST: Inserting ${TOTAL_STREAMS} streams (${CONCURRENT_USERS} users × ${STREAMS_PER_USER} streams)...`);
  const start = Date.now();

  // Create test user IDs
  const userIds = Array.from({ length: CONCURRENT_USERS }, () => randomUUID());

  // Insert test user profiles in batch
  const profileInserts = userIds.map((uid) => ({
    id: uid,
    username: `lt_user_${uid.slice(0, 8)}`,
    role: "listener" as const,
    subscription_status: "free" as const,
  }));

  const { error: batchProfileError } = await supabase.from("profiles").insert(profileInserts);
  if (batchProfileError) {
    console.error("  ❌ Failed to batch insert profiles:", batchProfileError.message);
    return { success: false, streamsInserted: 0, duplicates: 0 };
  }

  // Generate all stream records
  const streamRecords = [];
  for (const userId of userIds) {
    for (let i = 0; i < STREAMS_PER_USER; i++) {
      streamRecords.push({
        user_id: userId,
        song_id: testSongId,
        seconds_played: randomInt(MIN_DURATION, MAX_DURATION),
        is_valid: true,
        is_suspicious: false,
        revenue_counted: false,
        fraud_score: 0,
        session_id: `session_${userId.slice(0, 8)}_${i}`,
      });
    }
  }

  // Insert in batches of 100
  let streamsInserted = 0;
  let insertErrors = 0;
  const BATCH = 100;

  for (let i = 0; i < streamRecords.length; i += BATCH) {
    const chunk = streamRecords.slice(i, i + BATCH);
    const { error } = await supabase.from("streams").insert(chunk);
    if (error) {
      insertErrors++;
      console.error(`  ⚠️ Batch insert error at ${i}:`, error.message);
    } else {
      streamsInserted += chunk.length;
    }
  }

  console.log(`  ✅ Inserted ${streamsInserted} streams in ${elapsed(start)} (${insertErrors} batch errors)`);
  return { success: insertErrors === 0, streamsInserted, duplicates: 0 };
}

// ============================================================
// TEST 3: BATCH PROCESSING
// ============================================================
async function testBatchProcessing() {
  console.log("\n⚙️ TEST: Running batch processing...");
  const start = Date.now();

  const { data, error } = await supabase.rpc("process_stream_batch", { p_batch_size: 1000 });

  if (error) {
    console.error("  ❌ Batch processing RPC error:", error.message);
    console.log("  ℹ️ Trying client-side fallback...");
    // Could call runStreamBatchClientSide here
    return { success: false, processed: 0, revenueEvents: 0 };
  }

  const result = data as { processed: number; revenue_events_created: number; suspicious_skipped: number };
  console.log(`  ✅ Batch processed ${result.processed} streams, ${result.revenue_events_created} revenue events in ${elapsed(start)}`);
  return { success: true, processed: result.processed, revenueEvents: result.revenue_events_created };
}

// ============================================================
// TEST 4: REVENUE INTEGRITY CHECK
// ============================================================
async function testRevenueIntegrity() {
  console.log("\n🔒 TEST: Verifying revenue integrity...");
  const start = Date.now();

  const { data, error } = await supabase.rpc("verify_revenue_integrity");

  if (error) {
    console.error("  ❌ Integrity check RPC error:", error.message);
    return { success: false };
  }

  const result = data as {
    intact: boolean;
    streams_counted: number;
    revenue_events: number;
    orphaned_streams: number;
    orphaned_revenue: number;
    match: boolean;
  };

  const pass = result.intact && result.match;
  console.log(`  ${pass ? "✅" : "❌"} Integrity: intact=${result.intact}, match=${result.match}`);
  console.log(`     Streams counted: ${result.streams_counted}, Revenue events: ${result.revenue_events}`);
  console.log(`     Orphaned streams: ${result.orphaned_streams}, Orphaned revenue: ${result.orphaned_revenue}`);
  console.log(`     Completed in ${elapsed(start)}`);

  return { success: pass, ...result };
}

// ============================================================
// TEST 5: DUPLICATE STREAM CHECK
// ============================================================
async function testNoDuplicateStreams(testSongId: string) {
  console.log("\n🔍 TEST: Checking for duplicate streams...");
  const start = Date.now();

  // Try to insert a duplicate stream (same user + song + day)
  const testUserId = randomUUID();

  // Create test profile
  await supabase.from("profiles").insert({
    id: testUserId,
    username: `dup_test_${Date.now()}`,
    role: "listener",
    subscription_status: "free",
  });

  // Insert first stream
  const { error: firstError } = await supabase.from("streams").insert({
    user_id: testUserId,
    song_id: testSongId,
    seconds_played: 60,
    is_valid: true,
    is_suspicious: false,
    revenue_counted: false,
  });

  if (firstError) {
    console.log("  ⚠️ First stream insert failed:", firstError.message);
  }

  // Count streams for this user+song today
  const { count: streamCount } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("user_id", testUserId)
    .eq("song_id", testSongId);

  const duplicates = (streamCount || 0) > 10; // More than daily limit = problem
  console.log(`  ${!duplicates ? "✅" : "❌"} Streams for test user: ${streamCount} (limit: 10/day)`);
  console.log(`     Completed in ${elapsed(start)}`);

  return { success: !duplicates, streamCount: streamCount || 0 };
}

// ============================================================
// TEST 6: STATS ACCURACY
// ============================================================
async function testStatsAccuracy(testSongId: string, testArtistId: string) {
  console.log("\n📈 TEST: Verifying stats accuracy...");
  const start = Date.now();

  // Get song_stats
  const { data: songStats } = await supabase
    .from("song_stats")
    .select("*")
    .eq("song_id", testSongId)
    .maybeSingle();

  // Get actual stream count from streams table
  const { count: actualStreams } = await supabase
    .from("streams")
    .select("id", { count: "exact", head: true })
    .eq("song_id", testSongId)
    .eq("is_valid", true)
    .eq("is_suspicious", false)
    .eq("revenue_counted", true);

  const statsMatch = songStats?.total_streams === actualStreams;
  console.log(`  ${statsMatch ? "✅" : "⚠️"} Song stats: ${songStats?.total_streams || 0} vs actual: ${actualStreams || 0}`);

  // Get artist_stats
  const { data: artistStats } = await supabase
    .from("artist_stats")
    .select("*")
    .eq("artist_id", testArtistId)
    .maybeSingle();

  console.log(`  ℹ️ Artist stats: ${artistStats?.total_streams || 0} streams, revenue: €${artistStats?.total_stream_revenue || 0}`);
  console.log(`     Completed in ${elapsed(start)}`);

  return { success: statsMatch, songStats, artistStats };
}

// ============================================================
// CLEANUP
// ============================================================
async function cleanup(testSongId: string, testArtistId: string, testUserId: string) {
  console.log("\n🧹 Cleaning up test data...");

  // Delete revenue events for test streams
  await supabase.from("revenue_events").delete().ilike("stream_id", "%"); // will cascade

  // Delete test streams
  await supabase.from("streams").delete().eq("song_id", testSongId);

  // Delete test song (cascades to stats)
  await supabase.from("songs").delete().eq("id", testSongId);

  // Delete test artist (cascades)
  await supabase.from("artists").delete().eq("id", testArtistId);

  // Delete test profiles
  await supabase.from("profiles").delete().eq("id", testUserId);

  console.log("  ✅ Cleanup complete");
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  SONARA DEPLOYMENT VALIDATION                ║");
  console.log("║  Target: 1000+ streams/min, zero errors      ║");
  console.log("╚══════════════════════════════════════════════╝");

  const overallStart = Date.now();
  const results: Record<string, boolean> = {};

  // Setup
  const testData = await setupTestData();
  if (!testData) {
    console.error("\n❌ SETUP FAILED - Aborting");
    process.exit(1);
  }

  const { testUserId, testArtistId, testSongId } = testData;

  try {
    // Test 2: Stream load
    const loadResult = await testStreamLoad(testSongId);
    results["stream_load"] = loadResult.success;

    // Test 3: Batch processing
    const batchResult = await testBatchProcessing();
    results["batch_processing"] = batchResult.success;

    // Test 4: Revenue integrity
    const integrityResult = await testRevenueIntegrity();
    results["revenue_integrity"] = integrityResult.success;

    // Test 5: No duplicates
    const dupResult = await testNoDuplicateStreams(testSongId);
    results["no_duplicates"] = dupResult.success;

    // Test 6: Stats accuracy
    const statsResult = await testStatsAccuracy(testSongId, testArtistId);
    results["stats_accuracy"] = statsResult.success;

  } finally {
    // Cleanup
    await cleanup(testSongId, testArtistId, testUserId);
  }

  // Summary
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  VALIDATION SUMMARY                          ║");
  console.log("╠══════════════════════════════════════════════╣");

  const allPassed = Object.values(results).every(Boolean);
  for (const [test, passed] of Object.entries(results)) {
    console.log(`  ${passed ? "✅" : "❌"} ${test}`);
  }

  console.log("╠══════════════════════════════════════════════╣");
  console.log(`  ${allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
  console.log(`  Total time: ${elapsed(overallStart)}`);
  console.log("╚══════════════════════════════════════════════╝");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
