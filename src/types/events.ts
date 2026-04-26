export interface StreamEvent {
  id: string;
  userId: string;
  songId: string;
  artistId: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  deviceId: string;
  ipAddress: string;
  sessionId: string;
  userAgent: string;
  timestamp: string;
  completionRate: number;
}

export interface ProcessedStream {
  streamId: string;
  isValid: boolean;
  fraudFlags: string[];
  streamValue: number;
  artistCut: number;
  platformCut: number;
}

export interface EarningsLedgerEntry {
  id: string;
  artistId: string;
  transactionType: "stream" | "donation" | "adjustment" | "payout";
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  postedAt?: string;
  status: "pending" | "posted" | "failed";
}

export interface StreamFraudFlags {
  streamId: string;
  userId: string;
  songId: string;
  flags: string[];
  riskScore: number;
  metadata: Record<string, unknown>;
}

export interface TrendingScoreData {
  songId: string;
  plays24h: number;
  likes: number;
  completionRate: number;
  shares: number;
  daysSinceUpload: number;
  isNewSong: boolean;
  baseScore: number;
  boostedScore: number;
  updatedAt: string;
}

export interface FeedItem {
  songId: string;
  title: string;
  artistId: string;
  artistName: string;
  coverUrl?: string;
  trendingScore: number;
  stats: {
    plays24h: number;
    likes: number;
    completionRate: number;
  };
  userEngagement?: {
    liked: boolean;
    followingArtist: boolean;
    supported: boolean;
  };
}

export interface PersonalizationSignals {
  userId: string;
  watchedSongs: string[];
  skippedSongs: string[];
  likedSongs: string[];
  followedArtists: string[];
  totalWatchTime: number;
  avgCompletionRate: number;
}

export interface Payout {
  id: string;
  artistId: string;
  amount: number;
  currency: string;
  status: "pending" | "processed" | "failed";
  month: string;
  createdAt: string;
  processedAt?: string;
}

export interface QueueEvent {
  type: "stream" | "like" | "follow" | "support";
  data: unknown;
  timestamp: string;
  retries: number;
  maxRetries: number;
}

export interface WorkerMessage {
  type: "process_stream" | "process_trending" | "process_earnings" | "process_payout";
  payload: unknown;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  deviceId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface DeviceFingerprint {
  deviceId: string;
  userId: string;
  userAgent: string;
  model?: string;
  os?: string;
  browser?: string;
  firstSeen: string;
  lastSeen: string;
}

export interface StreamEventPayload {
  userId: string;
  songId: string;
  artistId: string;
  deviceId: string;
  sessionId: string;
  ipAddress: string;
  ipFingerprint: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface StreamValidationRequest {
  userId: string;
  songId: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  deviceId: string;
  sessionId: string;
  ipAddress: string;
  ipFingerprint: string;
  userAgent?: string;
}

export interface StreamValidationResponse {
  isValid: boolean;
  streamId?: string;
  fraudScore?: number;
  reason?: string;
}

export interface FraudFlag {
  userId: string;
  songId: string;
  flagType:
    | "daily_limit"
    | "replay_cooldown"
    | "device_rotation"
    | "anomaly"
    | "geo_block";
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  metadata?: Record<string, unknown>;
}
