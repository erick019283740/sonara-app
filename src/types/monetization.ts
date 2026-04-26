// Types for SONARA monetization system (fraud-aware + monitoring-ready)

export type Severity = "low" | "medium" | "high";
export type StreamValidationStatus =
  | "accepted"
  | "rejected"
  | "flagged"
  | "blocked";
export type GeoFlagType = "blocked_country" | "location_jump" | "ip_mismatch";
export type SuspiciousUserStatus = "flagged" | "blocked" | "cleared";
export type AbuseEventType =
  | "stream_abuse"
  | "cluster_detected"
  | "geo_anomaly"
  | "payout_abuse";
export type AbuseEventState = "open" | "investigating" | "resolved";
export type FraudClusterStatus = "active" | "investigating" | "resolved";

// ---- Core domain ----

export interface Stream {
  id: string;
  userId: string;
  songId: string;
  artistId?: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  completionRate?: number;
  isValid: boolean;
  isFraudBlocked?: boolean;
  streamValue: number;
  sessionId?: string;
  deviceId?: string;
  ipAddress?: string;
  ipFingerprint?: string;
  countryCode?: string | null;
  city?: string | null;
  createdAt: string;
}

export interface Artist {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Song {
  id: string;
  title: string;
  artistId: string;
  duration: number;
  coverUrl?: string;
  createdAt: string;
}

export interface Earnings {
  artistId: string;
  totalEarnings: number;
  platformFee: number;
  earningsThisMonth: number;
  earningsLastMonth: number;
  updatedAt: string;
}

export interface RevenueSplit {
  artistCut: number;
  platformCut: number;
}

export interface StreamPayout {
  id: string;
  artistId: string;
  songId: string;
  streamId: string;
  payoutAmount: number;
  payoutDate: string;
  status: "pending" | "completed" | "failed";
}

export interface TrendingScore {
  songId: string;
  trendingScore: number;
  plays24h: number;
  likes: number;
  completionRate: number;
  shares: number;
  isNewSong: boolean;
  daysSinceUpload: number;
}

export interface FeedSong extends TrendingScore {
  title?: string;
  artist?: string;
  coverUrl?: string;
  userHasLiked?: boolean;
  userIsFollowing?: boolean;
}

export interface SongMetrics {
  songId: string;
  playsLast24h: number;
  likes: number;
  shares: number;
  completionRate: number;
  totalPlayTimeSeconds: number;
  totalListeners: number;
  updatedAt: string;
}

export interface DiscoveryFeedEngagement {
  userId: string;
  songId: string;
  liked: boolean;
  followedArtist: boolean;
  supportedArtist: boolean;
  engagedAt: string;
}

// ---- API helpers ----

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface FeedResponse {
  type: "trending" | "new";
  total: number;
  songs: FeedSong[];
  hasMore: boolean;
  nextOffset: number;
}

// ---- Fraud-aware stream validation ----

export interface StreamValidationRequest {
  userId: string;
  songId: string;
  artistId?: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;

  // anti-abuse context
  sessionId?: string;
  deviceId?: string;
  ipAddress?: string;
  ipFingerprint?: string;
  userAgent?: string;

  // geo context
  countryCode?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;

  eventTimestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface StreamValidationResponse {
  isValid: boolean;
  status?: StreamValidationStatus;
  reason?: string;
  streamId?: string;
  streamValue: number;

  // fraud fields
  anomalyScore?: number;
  graphScore?: number;
  riskScore?: number;
  severity?: Severity;
  suspicious?: boolean;
  shouldBlockEarnings?: boolean;
  reasons?: string[];
  clusterId?: string;
}

// ---- Behavioral anomaly + graph ----

export interface AnomalyLog {
  id: string;
  userId: string;
  songId: string;
  artistId: string;
  sessionId?: string | null;
  deviceId?: string | null;
  ipFingerprint?: string | null;
  anomalyScore: number;
  graphScore: number;
  riskScore: number;
  reasons: string[];
  severity: Severity;
  clusterId?: string | null;
  createdAt: string;
}

export interface SuspiciousUser {
  id: string;
  userId: string;
  maxRiskScore: number;
  lastRiskScore: number;
  flagCount: number;
  severity: Severity;
  reasons: string[];
  status: SuspiciousUserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FraudCluster {
  id: string;
  clusterKey: string;
  seedUserId: string;
  artistId: string;
  songId: string;
  sharedIpCount: number;
  sharedDeviceCount: number;
  userCount: number;
  clusterScore: number;
  status: FraudClusterStatus;
  createdAt: string;
  updatedAt: string;
}

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

// ---- Real-time abuse monitoring ----

export interface AbuseEvent {
  id: string;
  eventType: AbuseEventType;
  userId?: string | null;
  artistId?: string | null;
  songId?: string | null;
  clusterId?: string | null;
  severity: Severity;
  riskScore: number;
  reasons: string[];
  metadata?: Record<string, unknown> | null;
  state: AbuseEventState;
  createdAt: string;
  updatedAt?: string;
}

export interface AbuseAlertPayload {
  type: "abuse_alert";
  severity: Severity;
  riskScore: number;
  reasons: string[];
  userId?: string;
  songId?: string;
  artistId?: string;
  clusterId?: string | null;
  at: string;
}

// ---- Geo tracking ----

export interface UserGeoHistory {
  id: string;
  userId: string;
  countryCode?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ipAddress?: string | null;
  ipFingerprint?: string | null;
  observedAt: string;
}

export interface GeoFlag {
  id: string;
  userId: string;
  ipFingerprint: string;
  countryCode?: string | null;
  flagType: GeoFlagType;
  details?: Record<string, unknown> | null;
  createdAt: string;
}
