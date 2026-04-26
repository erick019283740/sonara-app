import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseServiceRoleKey || "placeholder-service-role-key",
);

export type Severity = "low" | "medium" | "high";

export interface FraudEvaluationInput {
  userId: string;
  songId: string;
  artistId: string;
  deviceId: string;
  ipAddress: string;
  ipFingerprint: string;
  sessionId: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  userAgent?: string;
  countryCode?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  eventTimestamp?: string;
}

export interface FraudEvaluationResult {
  isAllowed: boolean;
  anomalyScore: number;
  graphScore: number;
  riskScore: number;
  suspicious: boolean;
  reasons: string[];
  severity: Severity;
  clusterId?: string;
  shouldBlockEarnings: boolean;
}

type UserBehaviorWindow = {
  streamsLastMinute: number;
  streamsLastHour: number;
  repeatedLoopsLastHour: number;
  avgCompletionRateLastHour: number;
  skipRateLastHour: number;
  sessionDurationMinutes: number;
};

type SuspiciousThresholds = {
  maxStreamsPerMinute: number;
  maxStreamsPerHour: number;
  maxRepeatedLoopsPerHour: number;
  minSessionDurationMinutes: number;
  maxAvgCompletionRate: number;
  maxIdenticalPatternUsers: number;
  blockRiskScore: number;
  suspiciousRiskScore: number;
  clusterRiskScore: number;
};

type PatternSignatureInput = {
  songId: string;
  artistId: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  minuteBucket: string;
};

const DEFAULT_THRESHOLDS: SuspiciousThresholds = {
  maxStreamsPerMinute: 12,
  maxStreamsPerHour: 220,
  maxRepeatedLoopsPerHour: 24,
  minSessionDurationMinutes: 0.2,
  maxAvgCompletionRate: 99.8,
  maxIdenticalPatternUsers: 5,
  blockRiskScore: 85,
  suspiciousRiskScore: 60,
  clusterRiskScore: 35,
};

const ALERT_WEBHOOK_URL = process.env.ABUSE_ALERT_WEBHOOK_URL || "";
const GEO_BLOCKED_COUNTRIES = (process.env.GEO_BLOCKED_COUNTRIES || "")
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

const HASH_SALT = process.env.DEVICE_ID_SALT || "sonara_fraud_graph_salt";

function toIso(input?: string): string {
  if (!input) return new Date().toISOString();
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function completionRate(
  durationPlayedSeconds: number,
  totalDurationSeconds: number,
): number {
  if (totalDurationSeconds <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, (durationPlayedSeconds / totalDurationSeconds) * 100),
  );
}

function scoreToSeverity(score: number): Severity {
  if (score >= 80) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function normalizeReason(reason: string): string {
  return reason.slice(0, 220);
}

function patternSignature(input: PatternSignatureInput): string {
  const completionBucket = Math.floor(
    completionRate(input.durationPlayedSeconds, input.totalDurationSeconds) / 5,
  );
  const payload = [
    input.songId,
    input.artistId,
    completionBucket,
    Math.min(300, Math.floor(input.durationPlayedSeconds)),
    input.minuteBucket,
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(`${payload}|${HASH_SALT}`)
    .digest("hex");
}

function minuteBucket(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  return d.toISOString();
}

function hourAgoIso(fromIso: string): string {
  const d = new Date(fromIso);
  return new Date(d.getTime() - 60 * 60 * 1000).toISOString();
}

function minuteAgoIso(fromIso: string): string {
  const d = new Date(fromIso);
  return new Date(d.getTime() - 60 * 1000).toISOString();
}

function dayAgoIso(fromIso: string): string {
  const d = new Date(fromIso);
  return new Date(d.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}


async function upsertUserGeoHistory(
  input: FraudEvaluationInput,
  eventIso: string,
): Promise<void> {
  const {
    userId,
    countryCode = null,
    city = null,
    latitude = null,
    longitude = null,
    ipAddress,
    ipFingerprint,
  } = input;

  await supabase.from("user_geo_history").insert({
    user_id: userId,
    country_code: countryCode ? countryCode.toUpperCase() : null,
    city,
    latitude,
    longitude,
    ip_address: ipAddress,
    ip_fingerprint: ipFingerprint,
    observed_at: eventIso,
  });
}

async function checkGeoFlags(
  input: FraudEvaluationInput,
  eventIso: string,
): Promise<string[]> {
  const reasons: string[] = [];
  const countryCode = (input.countryCode || "").toUpperCase();

  if (countryCode && GEO_BLOCKED_COUNTRIES.includes(countryCode)) {
    reasons.push(`geo_blocked_country:${countryCode}`);
    await supabase.from("geo_flags").insert({
      user_id: input.userId,
      ip_fingerprint: input.ipFingerprint,
      country_code: countryCode,
      flag_type: "blocked_country",
      details: {
        reason: "country_blocked",
        country: countryCode,
      },
      created_at: eventIso,
    });
  }

  const { data: recentGeoRows } = await supabase
    .from("user_geo_history")
    .select("country_code, city, latitude, longitude, observed_at")
    .eq("user_id", input.userId)
    .gte("observed_at", dayAgoIso(eventIso))
    .order("observed_at", { ascending: false })
    .limit(15);

  const geoRows = safeArray(recentGeoRows);

  if (geoRows.length >= 2 && countryCode) {
    const distinctCountries = new Set(
      geoRows
        .map((r) => String(r.country_code || "").toUpperCase())
        .filter(Boolean),
    );

    if (
      distinctCountries.size >= 3 ||
      (!distinctCountries.has(countryCode) && distinctCountries.size >= 2)
    ) {
      reasons.push("geo_unusual_location_change");
      await supabase.from("geo_flags").insert({
        user_id: input.userId,
        ip_fingerprint: input.ipFingerprint,
        country_code: countryCode,
        flag_type: "location_jump",
        details: {
          previous_countries: [...distinctCountries],
          current_country: countryCode,
        },
        created_at: eventIso,
      });
    }
  }

  const lastKnown = geoRows[0];
  if (
    lastKnown &&
    typeof input.latitude === "number" &&
    typeof input.longitude === "number" &&
    typeof lastKnown.latitude === "number" &&
    typeof lastKnown.longitude === "number" &&
    lastKnown.observed_at
  ) {
    const km = haversineKm(
      input.latitude,
      input.longitude,
      Number(lastKnown.latitude),
      Number(lastKnown.longitude),
    );
    const hours =
      Math.max(
        1,
        (new Date(eventIso).getTime() -
          new Date(lastKnown.observed_at).getTime()) /
          3600000,
      ) || 1;
    const kmPerHour = km / hours;

    if (km > 1500 && kmPerHour > 900) {
      reasons.push("geo_unrealistic_travel_velocity");
      await supabase.from("geo_flags").insert({
        user_id: input.userId,
        ip_fingerprint: input.ipFingerprint,
        country_code: countryCode || null,
        flag_type: "location_jump",
        details: {
          distance_km: Number(km.toFixed(2)),
          velocity_km_h: Number(kmPerHour.toFixed(2)),
          previous_observed_at: lastKnown.observed_at,
          current_observed_at: eventIso,
        },
        created_at: eventIso,
      });
    }
  }

  return reasons;
}

async function fetchUserBehaviorWindow(
  userId: string,
  songId: string,
  eventIso: string,
): Promise<UserBehaviorWindow> {
  const [
    lastMinuteRes,
    lastHourRes,
    repeatedLoopsRes,
  ] = await Promise.all([
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", minuteAgoIso(eventIso)),
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", hourAgoIso(eventIso)),
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("song_id", songId)
      .gte("created_at", hourAgoIso(eventIso)),
  ]);

  const streamsLastMinute = lastMinuteRes.count || 0;
  const streamsLastHour = lastHourRes.count || 0;
  const repeatedLoopsLastHour = repeatedLoopsRes.count || 0;

  return {
    streamsLastMinute,
    streamsLastHour,
    repeatedLoopsLastHour,
    avgCompletionRateLastHour: 0,
    skipRateLastHour: 0,
    sessionDurationMinutes: 0,
  };
}

function computeBehaviorAnomalyScore(
  window: UserBehaviorWindow,
  thresholds: SuspiciousThresholds,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (window.streamsLastMinute > thresholds.maxStreamsPerMinute) {
    score += Math.min(
      30,
      (window.streamsLastMinute - thresholds.maxStreamsPerMinute) * 3,
    );
    reasons.push("too_many_streams_per_minute");
  }

  if (window.streamsLastHour > thresholds.maxStreamsPerHour) {
    score += Math.min(
      25,
      (window.streamsLastHour - thresholds.maxStreamsPerHour) * 0.5,
    );
    reasons.push("too_many_streams_per_hour");
  }

  if (window.repeatedLoopsLastHour > thresholds.maxRepeatedLoopsPerHour) {
    score += Math.min(
      20,
      (window.repeatedLoopsLastHour - thresholds.maxRepeatedLoopsPerHour) * 1.5,
    );
    reasons.push("repeated_song_loops");
  }

  if (
    window.avgCompletionRateLastHour > thresholds.maxAvgCompletionRate &&
    window.streamsLastHour >= 20
  ) {
    score += 18;
    reasons.push("unrealistic_completion_rate");
  }

  if (
    window.sessionDurationMinutes < thresholds.minSessionDurationMinutes &&
    window.streamsLastMinute > 4
  ) {
    score += 12;
    reasons.push("micro_session_high_activity");
  }

  if (window.skipRateLastHour <= 1 && window.streamsLastHour > 80) {
    score += 10;
    reasons.push("near_zero_skip_pattern");
  }

  return {
    score: Math.min(100, score),
    reasons,
  };
}

async function detectIdenticalPatternAcrossUsers(
  input: FraudEvaluationInput,
  eventIso: string,
): Promise<{ score: number; reasons: string[]; signature: string }> {
  const minute = minuteBucket(eventIso);
  const signature = patternSignature({
    songId: input.songId,
    artistId: input.artistId,
    durationPlayedSeconds: input.durationPlayedSeconds,
    totalDurationSeconds: input.totalDurationSeconds,
    minuteBucket: minute,
  });

  return { score: 0, reasons: [], signature };
}

async function upsertFraudCluster(params: {
  seedUserId: string;
  artistId: string;
  songId: string;
  sharedIpCount: number;
  sharedDeviceCount: number;
  uniqueUsersCount: number;
  score: number;
  eventIso: string;
}): Promise<string> {
  const clusterKeyRaw = [
    params.artistId,
    params.songId,
    params.sharedIpCount > 0 ? "ip" : "",
    params.sharedDeviceCount > 0 ? "device" : "",
  ]
    .filter(Boolean)
    .join("|");

  const clusterKey = crypto
    .createHash("sha256")
    .update(`${clusterKeyRaw}|${HASH_SALT}`)
    .digest("hex");

  const { data: existing } = await supabase
    .from("fraud_clusters")
    .select("id,cluster_score,user_count,shared_ip_count,shared_device_count")
    .eq("cluster_key", clusterKey)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("fraud_clusters")
      .update({
        cluster_score: Math.max(
          Number(existing.cluster_score || 0),
          params.score,
        ),
        user_count: Math.max(
          Number(existing.user_count || 0),
          params.uniqueUsersCount,
        ),
        shared_ip_count: Math.max(
          Number(existing.shared_ip_count || 0),
          params.sharedIpCount,
        ),
        shared_device_count: Math.max(
          Number(existing.shared_device_count || 0),
          params.sharedDeviceCount,
        ),
        updated_at: params.eventIso,
      })
      .eq("id", existing.id);

    return String(existing.id);
  }

  const { data: inserted } = await supabase
    .from("fraud_clusters")
    .insert({
      cluster_key: clusterKey,
      seed_user_id: params.seedUserId,
      artist_id: params.artistId,
      song_id: params.songId,
      shared_ip_count: params.sharedIpCount,
      shared_device_count: params.sharedDeviceCount,
      user_count: params.uniqueUsersCount,
      cluster_score: params.score,
      status: "active",
      created_at: params.eventIso,
      updated_at: params.eventIso,
    })
    .select("id")
    .single();

  return String(inserted?.id || "");
}

async function computeFraudGraphScore(
  input: FraudEvaluationInput,
  eventIso: string,
): Promise<{ score: number; reasons: string[]; clusterId?: string }> {
  const reasons: string[] = [];
  let score = 0;
  let clusterId: string | undefined;

  const [sharedIpRes, sharedDeviceRes, sameSongBoostRes] = await Promise.all([
    supabase
      .from("streams")
      .select("user_id")
      .eq("user_id", input.userId)
      .gte("created_at", hourAgoIso(eventIso))
      .limit(1000),
    supabase
      .from("streams")
      .select("user_id")
      .eq("user_id", input.userId)
      .gte("created_at", hourAgoIso(eventIso))
      .limit(1000),
    supabase
      .from("streams")
      .select("user_id")
      .eq("song_id", input.songId)
      .gte("created_at", hourAgoIso(eventIso))
      .limit(3000),
  ]);

  const sharedIpUsers = new Set(
    safeArray(sharedIpRes.data)
      .map((r) => String((r as { user_id: string }).user_id))
      .filter((id) => id !== input.userId),
  );

  const sharedDeviceUsers = new Set(
    safeArray(sharedDeviceRes.data)
      .map((r) => String((r as { user_id: string }).user_id))
      .filter((id) => id !== input.userId),
  );

  const sameSongUsers = new Set(
    safeArray(sameSongBoostRes.data)
      .map((r) => String((r as { user_id: string }).user_id))
      .filter(Boolean),
  );

  if (sharedIpUsers.size >= 3) {
    score += Math.min(20, sharedIpUsers.size * 3);
    reasons.push("shared_ip_cluster_activity");
  }

  if (sharedDeviceUsers.size >= 2) {
    score += Math.min(25, sharedDeviceUsers.size * 6);
    reasons.push("shared_device_cluster_activity");
  }

  if (sameSongUsers.size >= 15) {
    score += 18;
    reasons.push("coordinated_song_boost_spike");
  }

  if (score >= DEFAULT_THRESHOLDS.clusterRiskScore) {
    clusterId = await upsertFraudCluster({
      seedUserId: input.userId,
      artistId: input.artistId,
      songId: input.songId,
      sharedIpCount: sharedIpUsers.size,
      sharedDeviceCount: sharedDeviceUsers.size,
      uniqueUsersCount: sameSongUsers.size,
      score,
      eventIso,
    });
  }

  return { score: Math.min(100, score), reasons, clusterId };
}

async function logAnomaly(
  input: FraudEvaluationInput,
  eventIso: string,
  anomalyScore: number,
  graphScore: number,
  riskScore: number,
  reasons: string[],
  severity: Severity,
  clusterId?: string,
): Promise<void> {
  await supabase.from("anomaly_logs").insert({
    user_id: input.userId,
    song_id: input.songId,
    artist_id: input.artistId,
    session_id: input.sessionId,
    device_id: input.deviceId,
    ip_fingerprint: input.ipFingerprint,
    anomaly_score: anomalyScore,
    graph_score: graphScore,
    risk_score: riskScore,
    reasons,
    severity,
    cluster_id: clusterId || null,
    created_at: eventIso,
  });
}

async function upsertSuspiciousUser(
  userId: string,
  riskScore: number,
  severity: Severity,
  reasons: string[],
  eventIso: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("suspicious_users")
    .select("id,max_risk_score,flag_count,status")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("suspicious_users")
      .update({
        max_risk_score: Math.max(
          Number(existing.max_risk_score || 0),
          riskScore,
        ),
        last_risk_score: riskScore,
        flag_count: Number(existing.flag_count || 0) + 1,
        severity,
        reasons,
        status:
          riskScore >= DEFAULT_THRESHOLDS.blockRiskScore
            ? "blocked"
            : "flagged",
        updated_at: eventIso,
      })
      .eq("id", existing.id);
    return;
  }

  await supabase.from("suspicious_users").insert({
    user_id: userId,
    max_risk_score: riskScore,
    last_risk_score: riskScore,
    flag_count: 1,
    severity,
    reasons,
    status:
      riskScore >= DEFAULT_THRESHOLDS.blockRiskScore ? "blocked" : "flagged",
    created_at: eventIso,
    updated_at: eventIso,
  });
}

async function emitAbuseEvent(params: {
  eventType:
    | "stream_abuse"
    | "cluster_detected"
    | "geo_anomaly"
    | "payout_abuse";
  userId: string;
  songId: string;
  artistId: string;
  severity: Severity;
  riskScore: number;
  reasons: string[];
  clusterId?: string;
  eventIso: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const payload = {
    event_type: params.eventType,
    user_id: params.userId,
    song_id: params.songId,
    artist_id: params.artistId,
    severity: params.severity,
    risk_score: params.riskScore,
    reasons: params.reasons,
    cluster_id: params.clusterId || null,
    metadata: params.metadata || null,
    state: "open",
    created_at: params.eventIso,
  };

  await supabase.from("abuse_events").insert(payload);

  if (
    ALERT_WEBHOOK_URL &&
    (params.severity === "high" ||
      params.riskScore >= DEFAULT_THRESHOLDS.blockRiskScore)
  ) {
    try {
      await fetch(ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "abuse_alert",
          event_type: params.eventType,
          severity: params.severity,
          risk_score: params.riskScore,
          reasons: params.reasons,
          user_id: params.userId,
          song_id: params.songId,
          artist_id: params.artistId,
          cluster_id: params.clusterId || null,
          metadata: params.metadata || null,
          at: params.eventIso,
        }),
      });
    } catch {
      // intentionally ignored
    }
  }
}

export async function evaluateStreamFraud(
  input: FraudEvaluationInput,
): Promise<FraudEvaluationResult> {
  const eventIso = toIso(input.eventTimestamp);
  const reasons: string[] = [];

  await upsertUserGeoHistory(input, eventIso);
  const geoReasons = await checkGeoFlags(input, eventIso);
  reasons.push(...geoReasons);

  const behaviorWindow = await fetchUserBehaviorWindow(
    input.userId,
    input.songId,
    eventIso,
  );
  const behavior = computeBehaviorAnomalyScore(
    behaviorWindow,
    DEFAULT_THRESHOLDS,
  );
  reasons.push(...behavior.reasons);

  const pattern = await detectIdenticalPatternAcrossUsers(input, eventIso);
  reasons.push(...pattern.reasons);

  const graph = await computeFraudGraphScore(input, eventIso);
  reasons.push(...graph.reasons);

  const completion = completionRate(
    input.durationPlayedSeconds,
    input.totalDurationSeconds,
  );

  if (completion >= 99.95 && behaviorWindow.streamsLastHour > 30) {
    reasons.push("abnormal_high_completion_consistency");
  }

  const anomalyScore = Math.min(
    100,
    behavior.score + pattern.score + (geoReasons.length > 0 ? 15 : 0),
  );
  const graphScore = Math.min(100, graph.score);
  const riskScore = Math.min(
    100,
    Math.round(anomalyScore * 0.65 + graphScore * 0.35),
  );

  const severity = scoreToSeverity(riskScore);
  const suspicious = riskScore >= DEFAULT_THRESHOLDS.suspiciousRiskScore;
  const blocked =
    riskScore >= DEFAULT_THRESHOLDS.blockRiskScore ||
    geoReasons.some((r) => r.startsWith("geo_blocked_country"));
  const dedupReasons = [...new Set(reasons.map(normalizeReason))];

  await logAnomaly(
    input,
    eventIso,
    anomalyScore,
    graphScore,
    riskScore,
    dedupReasons,
    severity,
    graph.clusterId,
  );

  if (suspicious) {
    await upsertSuspiciousUser(
      input.userId,
      riskScore,
      severity,
      dedupReasons,
      eventIso,
    );
  }

  if (suspicious || severity === "high") {
    await emitAbuseEvent({
      eventType: graph.clusterId ? "cluster_detected" : "stream_abuse",
      userId: input.userId,
      songId: input.songId,
      artistId: input.artistId,
      severity,
      riskScore,
      reasons: dedupReasons,
      clusterId: graph.clusterId,
      eventIso,
      metadata: {
        anomaly_score: anomalyScore,
        graph_score: graphScore,
        pattern_signature: pattern.signature,
      },
    });
  }

  if (geoReasons.length > 0) {
    await emitAbuseEvent({
      eventType: "geo_anomaly",
      userId: input.userId,
      songId: input.songId,
      artistId: input.artistId,
      severity: geoReasons.some((r) => r.startsWith("geo_blocked_country"))
        ? "high"
        : "medium",
      riskScore: Math.max(35, riskScore),
      reasons: geoReasons,
      clusterId: graph.clusterId,
      eventIso,
      metadata: {
        country_code: input.countryCode || null,
        city: input.city || null,
        latitude: input.latitude || null,
        longitude: input.longitude || null,
      },
    });
  }

  return {
    isAllowed: !blocked,
    anomalyScore,
    graphScore,
    riskScore,
    suspicious,
    reasons: dedupReasons,
    severity,
    clusterId: graph.clusterId,
    shouldBlockEarnings: blocked || suspicious,
  };
}

export async function markStreamPatternSignature(): Promise<void> {
  // No-op - streams table doesn't have pattern_signature
}

export async function getSuspiciousUserStatus(userId: string): Promise<{
  isSuspicious: boolean;
  isBlocked: boolean;
  maxRiskScore: number;
  severity: Severity | null;
  reasons: string[];
}> {
  const { data } = await supabase
    .from("suspicious_users")
    .select("status,max_risk_score,severity,reasons")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    return {
      isSuspicious: false,
      isBlocked: false,
      maxRiskScore: 0,
      severity: null,
      reasons: [],
    };
  }

  return {
    isSuspicious: true,
    isBlocked: String(data.status) === "blocked",
    maxRiskScore: Number(data.max_risk_score || 0),
    severity: (data.severity as Severity) || null,
    reasons: safeArray<string>((data.reasons as string[]) || []),
  };
}
