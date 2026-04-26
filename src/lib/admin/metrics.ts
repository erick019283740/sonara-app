import { createAdminClient } from "@/lib/supabase/admin";

type Severity = "low" | "medium" | "high";

export type TimeRange = "5m" | "15m" | "1h" | "24h" | "7d" | "30d";

export type StreamPoint = {
  ts: string;
  streams: number;
  listeners: number;
};

export type TopSongNow = {
  songId: string;
  title: string;
  artistId: string | null;
  artistName: string;
  streamsLast5m: number;
  listenersLast5m: number;
  trendScore: number;
};

export type StreamsLiveMetrics = {
  streamsPerSecond: number;
  activeListeners: number;
  streamsLastMinute: number;
  streamsLast5m: number;
  topSongsNow: TopSongNow[];
  series: StreamPoint[];
  generatedAt: string;
};

export type SuspiciousUserItem = {
  userId: string;
  email: string | null;
  severity: Severity;
  status: "flagged" | "blocked" | "cleared";
  maxRiskScore: number;
  lastRiskScore: number;
  flagCount: number;
  reasons: string[];
  updatedAt: string;
};

export type AnomalyLogItem = {
  id: string;
  userId: string;
  songId: string | null;
  artistId: string | null;
  anomalyScore: number;
  graphScore: number;
  riskScore: number;
  severity: Severity;
  reasons: string[];
  createdAt: string;
};

export type FraudClusterItem = {
  id: string;
  clusterKey: string;
  songId: string | null;
  artistId: string | null;
  status: "active" | "investigating" | "resolved";
  userCount: number;
  sharedIpCount: number;
  sharedDeviceCount: number;
  clusterScore: number;
  updatedAt: string;
};

export type FraudPanelMetrics = {
  suspiciousUsers: SuspiciousUserItem[];
  anomalyLogs: AnomalyLogItem[];
  fraudClusters: FraudClusterItem[];
  totals: {
    suspiciousUsers: number;
    blockedUsers: number;
    activeClusters: number;
    highSeverityAnomalies24h: number;
  };
  generatedAt: string;
};

export type EarningsSummary = {
  dailyRevenue: number;
  monthlyRevenue: number;
  dailyPlatformFee: number;
  monthlyPlatformFee: number;
};

export type TopEarningArtist = {
  artistId: string;
  stageName: string;
  totalEarnings: number;
  thisMonthEarnings: number;
  platformFee: number;
};

export type PayoutHistoryItem = {
  id: string;
  artistId: string;
  stageName: string;
  amount: number;
  status: "pending" | "completed" | "failed";
  payoutDate: string;
  streamId: string | null;
  riskScore: number;
  suspicious: boolean;
};

export type EarningsMetrics = {
  summary: EarningsSummary;
  topArtists: TopEarningArtist[];
  payouts: PayoutHistoryItem[];
  generatedAt: string;
};

export type TrendingSongMetrics = {
  songId: string;
  title: string;
  artistId: string | null;
  artistName: string;
  trendingScore: number;
  growthRate24h: number;
  plays24h: number;
  abuseRisk: number;
};

export type TrendingMetrics = {
  topTrending: TrendingSongMetrics[];
  fastestGrowing: TrendingSongMetrics[];
  viralSpikes: TrendingSongMetrics[];
  generatedAt: string;
};

export type AlertItem = {
  id: string;
  type: "stream_abuse" | "cluster_detected" | "geo_anomaly" | "payout_abuse";
  severity: Severity;
  riskScore: number;
  message: string;
  createdAt: string;
  userId: string | null;
  songId: string | null;
  artistId: string | null;
  clusterId: string | null;
  state: "open" | "investigating" | "resolved";
};

export type AlertsMetrics = {
  alerts: AlertItem[];
  totals: {
    low: number;
    medium: number;
    high: number;
    open: number;
  };
  generatedAt: string;
};

export type AdminHealthMetrics = {
  queue: {
    streamQueue: number;
    earningsQueue: number;
    trendingQueue: number;
    deadLetterQueue: number;
  };
  events: {
    streamsLast5m: number;
    fraudEventsLast5m: number;
    alertsLast5m: number;
  };
  generatedAt: string;
};

const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const STREAM_VALUE = 0.01;

function nowISO() {
  return new Date().toISOString();
}

function minutesAgoISO(mins: number) {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

function hoursAgoISO(hours: number) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function daysAgoISO(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function groupByMinute(
  rows: Array<{ created_at: string; user_id?: string | null }>,
): StreamPoint[] {
  const map = new Map<string, { streams: number; users: Set<string> }>();

  for (const row of rows) {
    const dt = new Date(row.created_at);
    dt.setSeconds(0, 0);
    const key = dt.toISOString();

    if (!map.has(key)) {
      map.set(key, { streams: 0, users: new Set<string>() });
    }

    const bucket = map.get(key)!;
    bucket.streams += 1;
    if (row.user_id) bucket.users.add(String(row.user_id));
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, data]) => ({
      ts,
      streams: data.streams,
      listeners: data.users.size,
    }));
}

async function getProfilesEmailMap(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string | null>();
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("profiles")
    .select("id")
    .in("id", userIds);

  const map = new Map<string, string | null>();
  for (const uid of userIds) map.set(uid, null);
  for (const row of data ?? []) map.set(String(row.id), null);
  return map;
}

async function getArtistNameMap(artistIds: string[]) {
  if (artistIds.length === 0) return new Map<string, string>();
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("artists")
    .select("id, stage_name")
    .in("id", artistIds);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(String(row.id), String(row.stage_name ?? "Unknown Artist"));
  }
  return map;
}

async function getSongMetaMap(songIds: string[]) {
  if (songIds.length === 0) {
    return new Map<
      string,
      { title: string; artist_id: string | null; artist_name: string }
    >();
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("songs")
    .select("id, title, artist_id")
    .in("id", songIds);

  const artistIds = [...new Set((data ?? []).map((r) => r.artist_id).filter(Boolean))] as string[];
  const artistMap = await getArtistNameMap(artistIds);

  const map = new Map<
    string,
    { title: string; artist_id: string | null; artist_name: string }
  >();

  for (const row of data ?? []) {
    const artistId = row.artist_id ? String(row.artist_id) : null;
    map.set(String(row.id), {
      title: String(row.title ?? "Unknown Song"),
      artist_id: artistId,
      artist_name: artistId ? artistMap.get(artistId) ?? "Unknown Artist" : "Unknown Artist",
    });
  }

  return map;
}

export async function getStreamsLiveMetrics(): Promise<StreamsLiveMetrics> {
  const supabase = createAdminClient();

  const since5m = minutesAgoISO(5);
  const since1m = minutesAgoISO(1);

  const [events5mRes, events1mRes] = await Promise.all([
    supabase
      .from("streams")
      .select("song_id, user_id, created_at")
      .gte("created_at", since5m)
      .order("created_at", { ascending: true }),
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since1m),
  ]);

  const events5m = (events5mRes.data ?? []) as Array<{
    song_id: string;
    user_id: string | null;
    created_at: string;
  }>;

  const streamsLast5m = events5m.length;
  const streamsLastMinute = Number(events1mRes.count ?? 0);
  const streamsPerSecond = Number((streamsLastMinute / 60).toFixed(3));
  const activeListeners = new Set(events5m.map((r) => r.user_id).filter(Boolean)).size;

  const bySong = new Map<
    string,
    { streams: number; users: Set<string>; trendScore: number }
  >();
  for (const ev of events5m) {
    const songId = String(ev.song_id);
    if (!bySong.has(songId)) {
      bySong.set(songId, { streams: 0, users: new Set<string>(), trendScore: 0 });
    }
    const item = bySong.get(songId)!;
    item.streams += 1;
    if (ev.user_id) item.users.add(String(ev.user_id));
    item.trendScore += 1;
  }

  const songIds = [...bySong.keys()];
  const songMeta = await getSongMetaMap(songIds);

  const topSongsNow: TopSongNow[] = [...bySong.entries()]
    .map(([songId, v]) => {
      const meta = songMeta.get(songId);
      return {
        songId,
        title: meta?.title ?? "Unknown Song",
        artistId: meta?.artist_id ?? null,
        artistName: meta?.artist_name ?? "Unknown Artist",
        streamsLast5m: v.streams,
        listenersLast5m: v.users.size,
        trendScore: Number(v.trendScore.toFixed(3)),
      };
    })
    .sort((a, b) => b.streamsLast5m - a.streamsLast5m)
    .slice(0, 10);

  const series = groupByMinute(events5m.map((r) => ({
    created_at: r.created_at,
    user_id: r.user_id ?? null,
  })));

  return {
    streamsPerSecond,
    activeListeners,
    streamsLastMinute,
    streamsLast5m,
    topSongsNow,
    series,
    generatedAt: nowISO(),
  };
}

export async function getFraudMetrics(params?: {
  severity?: Severity | "all";
  userId?: string;
}): Promise<FraudPanelMetrics> {
  const supabase = createAdminClient();
  const severity = params?.severity ?? "all";

  let suspiciousQ = supabase
    .from("suspicious_users")
    .select("user_id, severity, status, max_risk_score, last_risk_score, flag_count, reasons, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (severity !== "all") suspiciousQ = suspiciousQ.eq("severity", severity);

  let anomalyQ = supabase
    .from("anomaly_logs")
    .select("id, user_id, song_id, artist_id, anomaly_score, graph_score, risk_score, severity, reasons, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (severity !== "all") anomalyQ = anomalyQ.eq("severity", severity);
  if (params?.userId) anomalyQ = anomalyQ.eq("user_id", params.userId);

  const [suspiciousRes, anomalyRes, clustersRes, totalsRes] = await Promise.all([
    suspiciousQ,
    anomalyQ,
    supabase
      .from("fraud_clusters")
      .select("id, cluster_key, song_id, artist_id, status, user_count, shared_ip_count, shared_device_count, cluster_score, updated_at")
      .order("cluster_score", { ascending: false })
      .limit(100),
    supabase
      .from("anomaly_logs")
      .select("id", { count: "exact", head: true })
      .eq("severity", "high")
      .gte("created_at", hoursAgoISO(24)),
  ]);

  const suspiciousRows = (suspiciousRes.data ?? []) as Array<{
    user_id: string;
    severity: Severity;
    status: "flagged" | "blocked" | "cleared";
    max_risk_score: number;
    last_risk_score: number;
    flag_count: number;
    reasons: string[];
    updated_at: string;
  }>;

  const anomalyRows = (anomalyRes.data ?? []) as Array<{
    id: string;
    user_id: string;
    song_id: string | null;
    artist_id: string | null;
    anomaly_score: number;
    graph_score: number;
    risk_score: number;
    severity: Severity;
    reasons: string[];
    created_at: string;
  }>;

  const clusters = ((clustersRes.data ?? []) as Array<{
    id: string;
    cluster_key: string;
    song_id: string | null;
    artist_id: string | null;
    status: "active" | "investigating" | "resolved";
    user_count: number;
    shared_ip_count: number;
    shared_device_count: number;
    cluster_score: number;
    updated_at: string;
  }>).map((r) => ({
    id: r.id,
    clusterKey: r.cluster_key,
    songId: r.song_id ?? null,
    artistId: r.artist_id ?? null,
    status: r.status,
    userCount: Number(r.user_count ?? 0),
    sharedIpCount: Number(r.shared_ip_count ?? 0),
    sharedDeviceCount: Number(r.shared_device_count ?? 0),
    clusterScore: Number(r.cluster_score ?? 0),
    updatedAt: r.updated_at,
  }));

  const userIds = [...new Set(suspiciousRows.map((r) => String(r.user_id)))];
  const emailMap = await getProfilesEmailMap(userIds);

  const suspiciousUsers: SuspiciousUserItem[] = suspiciousRows
    .map((r) => ({
      userId: String(r.user_id),
      email: emailMap.get(String(r.user_id)) ?? null,
      severity: r.severity,
      status: r.status,
      maxRiskScore: Number(r.max_risk_score ?? 0),
      lastRiskScore: Number(r.last_risk_score ?? 0),
      flagCount: Number(r.flag_count ?? 0),
      reasons: Array.isArray(r.reasons) ? r.reasons : [],
      updatedAt: r.updated_at,
    }))
    .sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (s !== 0) return s;
      return b.lastRiskScore - a.lastRiskScore;
    });

  const anomalyLogs: AnomalyLogItem[] = anomalyRows.map((r) => ({
    id: r.id,
    userId: String(r.user_id),
    songId: r.song_id ? String(r.song_id) : null,
    artistId: r.artist_id ? String(r.artist_id) : null,
    anomalyScore: Number(r.anomaly_score ?? 0),
    graphScore: Number(r.graph_score ?? 0),
    riskScore: Number(r.risk_score ?? 0),
    severity: r.severity,
    reasons: Array.isArray(r.reasons) ? r.reasons : [],
    createdAt: r.created_at,
  }));

  const blockedUsers = suspiciousUsers.filter((u) => u.status === "blocked").length;
  const activeClusters = clusters.filter((c) => c.status === "active").length;

  return {
    suspiciousUsers,
    anomalyLogs,
    fraudClusters: clusters,
    totals: {
      suspiciousUsers: suspiciousUsers.length,
      blockedUsers,
      activeClusters,
      highSeverityAnomalies24h: Number(totalsRes.count ?? 0),
    },
    generatedAt: nowISO(),
  };
}

export async function getEarningsMetrics(): Promise<EarningsMetrics> {
  const supabase = createAdminClient();

  const daySince = daysAgoISO(1);
  const monthSince = daysAgoISO(30);

  const [dailyStreamsRes, monthlyStreamsRes, topArtistsRes, payoutsRes] = await Promise.all([
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daySince),
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthSince),
    supabase
      .from("earnings")
      .select("artist_id, total_earnings, earnings_this_month, platform_fee")
      .order("total_earnings", { ascending: false })
      .limit(20),
    supabase
      .from("stream_payouts")
      .select("id, artist_id, stream_id, payout_amount, status, payout_date, song_id, risk_score, suspicious")
      .order("payout_date", { ascending: false })
      .limit(100),
  ]);

  const dailyStreams = Number(dailyStreamsRes.count ?? 0);
  const monthlyStreams = Number(monthlyStreamsRes.count ?? 0);

  const dailyRevenue = Number((dailyStreams * STREAM_VALUE).toFixed(2));
  const monthlyRevenue = Number((monthlyStreams * STREAM_VALUE).toFixed(2));

  const dailyPlatformFee = Number((dailyRevenue * 0.4).toFixed(2));
  const monthlyPlatformFee = Number((monthlyRevenue * 0.4).toFixed(2));

  const earningsRows = (topArtistsRes.data ?? []) as Array<{
    artist_id: string;
    total_earnings: number;
    earnings_this_month: number;
    platform_fee: number;
  }>;

  const artistIds = [...new Set(earningsRows.map((r) => String(r.artist_id)))];
  const artistNameMap = await getArtistNameMap(artistIds);

  const topArtists: TopEarningArtist[] = earningsRows.map((r) => ({
    artistId: String(r.artist_id),
    stageName: artistNameMap.get(String(r.artist_id)) ?? "Unknown Artist",
    totalEarnings: Number(r.total_earnings ?? 0),
    thisMonthEarnings: Number(r.earnings_this_month ?? 0),
    platformFee: Number(r.platform_fee ?? 0),
  }));

  const payoutRows = (payoutsRes.data ?? []) as Array<{
    id: string;
    artist_id: string;
    stream_id: string | null;
    payout_amount: number;
    status: "pending" | "completed" | "failed";
    payout_date: string;
    song_id: string | null;
    risk_score?: number | null;
    suspicious?: boolean | null;
  }>;

  const payoutArtistIds = [...new Set(payoutRows.map((r) => String(r.artist_id)))];
  const payoutArtistNameMap = await getArtistNameMap(payoutArtistIds);

  const payouts: PayoutHistoryItem[] = payoutRows.map((r) => ({
    id: r.id,
    artistId: String(r.artist_id),
    stageName: payoutArtistNameMap.get(String(r.artist_id)) ?? "Unknown Artist",
    amount: Number(r.payout_amount ?? 0),
    status: r.status,
    payoutDate: r.payout_date,
    streamId: r.stream_id ? String(r.stream_id) : null,
    riskScore: Number(r.risk_score ?? 0),
    suspicious: Boolean(r.suspicious ?? false),
  }));

  return {
    summary: {
      dailyRevenue,
      monthlyRevenue,
      dailyPlatformFee,
      monthlyPlatformFee,
    },
    topArtists,
    payouts,
    generatedAt: nowISO(),
  };
}

export async function getTrendingMetrics(): Promise<TrendingMetrics> {
  const supabase = createAdminClient();

  const [trendingRes, stream24hRes, streamPrev24hRes] = await Promise.all([
    supabase
      .from("trending_scores")
      .select("song_id, trending_score, plays_24h, abuse_risk")
      .order("trending_score", { ascending: false })
      .limit(200),
    supabase
      .from("streams")
      .select("song_id")
      .gte("created_at", hoursAgoISO(24))
      .limit(20000),
    supabase
      .from("streams")
      .select("song_id")
      .gte("created_at", hoursAgoISO(48))
      .lt("created_at", hoursAgoISO(24))
      .limit(20000),
  ]);

  const trendingRows = (trendingRes.data ?? []) as Array<{
    song_id: string;
    trending_score: number;
    plays_24h: number;
    abuse_risk?: number | null;
  }>;

  const songIds = [...new Set(trendingRows.map((r) => String(r.song_id)))];
  const songMetaMap = await getSongMetaMap(songIds);

  const currMap = new Map<string, number>();
  const prevMap = new Map<string, number>();

  for (const row of (stream24hRes.data ?? []) as Array<{ song_id: string }>) {
    const id = String(row.song_id);
    currMap.set(id, (currMap.get(id) ?? 0) + 1);
  }

  for (const row of (streamPrev24hRes.data ?? []) as Array<{ song_id: string }>) {
    const id = String(row.song_id);
    prevMap.set(id, (prevMap.get(id) ?? 0) + 1);
  }

  const all: TrendingSongMetrics[] = trendingRows.map((r) => {
    const id = String(r.song_id);
    const curr = Number(currMap.get(id) ?? r.plays_24h ?? 0);
    const prev = Number(prevMap.get(id) ?? 0);
    const growthRate =
      prev > 0 ? Number((((curr - prev) / prev) * 100).toFixed(2)) : curr > 0 ? 100 : 0;

    const meta = songMetaMap.get(id);

    return {
      songId: id,
      title: meta?.title ?? "Unknown Song",
      artistId: meta?.artist_id ?? null,
      artistName: meta?.artist_name ?? "Unknown Artist",
      trendingScore: Number(r.trending_score ?? 0),
      growthRate24h: growthRate,
      plays24h: curr,
      abuseRisk: Number(r.abuse_risk ?? 0),
    };
  });

  const topTrending = [...all]
    .sort((a, b) => b.trendingScore - a.trendingScore)
    .slice(0, 25);

  const fastestGrowing = [...all]
    .sort((a, b) => b.growthRate24h - a.growthRate24h)
    .slice(0, 25);

  const viralSpikes = [...all]
    .filter((s) => s.growthRate24h >= 80 && s.plays24h >= 25)
    .sort((a, b) => b.growthRate24h - a.growthRate24h)
    .slice(0, 25);

  return {
    topTrending,
    fastestGrowing,
    viralSpikes,
    generatedAt: nowISO(),
  };
}

export async function getAlertsMetrics(params?: {
  limit?: number;
  severity?: Severity | "all";
}): Promise<AlertsMetrics> {
  const supabase = createAdminClient();
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));
  const severityFilter = params?.severity ?? "all";

  let alertsQ = supabase
    .from("abuse_events")
    .select("id, event_type, severity, risk_score, reasons, created_at, user_id, song_id, artist_id, cluster_id, state")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (severityFilter !== "all") alertsQ = alertsQ.eq("severity", severityFilter);

  const { data } = await alertsQ;

  const rows = (data ?? []) as Array<{
    id: string;
    event_type: "stream_abuse" | "cluster_detected" | "geo_anomaly" | "payout_abuse";
    severity: Severity;
    risk_score: number;
    reasons: string[];
    created_at: string;
    user_id: string | null;
    song_id: string | null;
    artist_id: string | null;
    cluster_id: string | null;
    state: "open" | "investigating" | "resolved";
  }>;

  const alerts: AlertItem[] = rows.map((r) => ({
    id: r.id,
    type: r.event_type,
    severity: r.severity,
    riskScore: Number(r.risk_score ?? 0),
    message: Array.isArray(r.reasons) && r.reasons.length > 0 ? r.reasons[0] : r.event_type,
    createdAt: r.created_at,
    userId: r.user_id ? String(r.user_id) : null,
    songId: r.song_id ? String(r.song_id) : null,
    artistId: r.artist_id ? String(r.artist_id) : null,
    clusterId: r.cluster_id ? String(r.cluster_id) : null,
    state: r.state,
  }));

  const totals = {
    low: alerts.filter((a) => a.severity === "low").length,
    medium: alerts.filter((a) => a.severity === "medium").length,
    high: alerts.filter((a) => a.severity === "high").length,
    open: alerts.filter((a) => a.state === "open").length,
  };

  return {
    alerts,
    totals,
    generatedAt: nowISO(),
  };
}

export async function getPlatformHealthMetrics(): Promise<AdminHealthMetrics> {
  const supabase = createAdminClient();
  const since5m = minutesAgoISO(5);

  const [streamsRes, fraudRes, alertsRes] = await Promise.all([
    supabase
      .from("streams")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since5m),
    supabase
      .from("anomaly_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since5m),
    supabase
      .from("abuse_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since5m),
  ]);

  return {
    queue: {
      streamQueue: 0,
      earningsQueue: 0,
      trendingQueue: 0,
      deadLetterQueue: 0,
    },
    events: {
      streamsLast5m: Number(streamsRes.count ?? 0),
      fraudEventsLast5m: Number(fraudRes.count ?? 0),
      alertsLast5m: Number(alertsRes.count ?? 0),
    },
    generatedAt: nowISO(),
  };
}

export async function getAdminOverviewMetrics() {
  const [streams, fraud, earnings, trending, alerts, health] = await Promise.all([
    getStreamsLiveMetrics(),
    getFraudMetrics(),
    getEarningsMetrics(),
    getTrendingMetrics(),
    getAlertsMetrics({ limit: 25 }),
    getPlatformHealthMetrics(),
  ]);

  return {
    streams,
    fraud,
    earnings,
    trending,
    alerts,
    health,
    generatedAt: nowISO(),
  };
}
