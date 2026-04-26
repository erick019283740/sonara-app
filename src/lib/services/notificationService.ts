import { createAdminClient } from "@/lib/supabase/admin";

export type NotificationType =
  | "new_follower"
  | "song_trending"
  | "earnings_update"
  | "artist_supported"
  | "daily_streak"
  | "new_songs_for_you"
  | "reengagement";

export type NotificationPriority = "low" | "normal" | "high";

export interface NotificationPayload {
  songId?: string;
  artistId?: string;
  followerId?: string;
  supporterId?: string;
  amount?: number;
  deepLink?: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface PushPayload {
  title: string;
  body: string;
  deepLink?: string;
  imageUrl?: string;
  data: Record<string, unknown>;
}

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  priority: NotificationPriority;
  read: boolean;
  created_at: string;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: NotificationPayload;
  priority?: NotificationPriority;
}

export interface NotificationQueryOptions {
  limit?: number;
  unreadOnly?: boolean;
  useCache?: boolean;
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const CACHE_TTL_MS = 20_000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

class NotificationService {
  private readonly cache = new Map<string, CacheEntry<NotificationRecord[]>>();

  async createNotification(input: CreateNotificationInput): Promise<NotificationRecord> {
    const admin = createAdminClient();
    const payload = this.normalizePayload(input.payload);
    const priority = input.priority ?? "normal";

    const { data, error } = await admin
      .from("notifications")
      .insert({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        payload,
        priority,
        read: false,
      })
      .select("id, user_id, type, title, body, payload, priority, read, created_at")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create notification: ${error?.message ?? "unknown"}`);
    }

    this.invalidateUserCache(input.userId);
    return data as NotificationRecord;
  }

  async getNotifications(
    userId: string,
    options: NotificationQueryOptions = {},
  ): Promise<NotificationRecord[]> {
    const limit = this.clampLimit(options.limit ?? DEFAULT_LIMIT);
    const unreadOnly = Boolean(options.unreadOnly);
    const useCache = options.useCache !== false;
    const cacheKey = this.getCacheKey(userId, limit, unreadOnly);

    if (useCache) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const admin = createAdminClient();
    let query = admin
      .from("notifications")
      .select("id, user_id, type, title, body, payload, priority, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq("read", false);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch notifications: ${error.message}`);
    }

    const rows = (data ?? []) as NotificationRecord[];
    if (useCache) {
      this.setCache(cacheKey, rows);
    }

    return rows;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false);

    if (error) {
      throw new Error(`Failed to fetch unread count: ${error.message}`);
    }

    return count ?? 0;
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to mark notification as read: ${error.message}`);
    }

    this.invalidateUserCache(userId);
  }

  async markAllAsRead(userId: string): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);

    if (error) {
      throw new Error(`Failed to mark all notifications as read: ${error.message}`);
    }

    this.invalidateUserCache(userId);
  }

  buildPushPayload(notification: NotificationRecord): PushPayload {
    const payload = (notification.payload ?? {}) as NotificationPayload & Record<string, unknown>;
    const deepLink =
      typeof payload.deepLink === "string" && payload.deepLink.length > 0
        ? payload.deepLink
        : undefined;

    const imageUrl =
      typeof payload.imageUrl === "string" && payload.imageUrl.length > 0
        ? payload.imageUrl
        : undefined;

    return {
      title: notification.title,
      body: notification.body,
      deepLink,
      imageUrl,
      data: {
        notificationId: notification.id,
        type: notification.type,
        priority: notification.priority,
        createdAt: notification.created_at,
        ...payload,
      },
    };
  }

  async notifyNewFollower(params: {
    artistUserId: string;
    followerId: string;
    followerName: string;
    artistId?: string;
  }): Promise<NotificationRecord> {
    return this.createNotification({
      userId: params.artistUserId,
      type: "new_follower",
      title: "New follower",
      body: `${params.followerName} just followed you.`,
      payload: {
        followerId: params.followerId,
        artistId: params.artistId,
        deepLink: params.artistId ? `/artist/${params.artistId}` : "/dashboard",
      },
      priority: "normal",
    });
  }

  async notifySongTrending(params: {
    artistUserId: string;
    songId: string;
    songTitle: string;
    viralScore?: number;
  }): Promise<NotificationRecord> {
    const scoreText =
      typeof params.viralScore === "number"
        ? ` (viral score ${params.viralScore.toFixed(2)})`
        : "";

    return this.createNotification({
      userId: params.artistUserId,
      type: "song_trending",
      title: "Song trending",
      body: `"${params.songTitle}" is trending now${scoreText}.`,
      payload: {
        songId: params.songId,
        deepLink: `/song/${params.songId}`,
        metadata: { viralScore: params.viralScore ?? null },
      },
      priority: "high",
    });
  }

  async notifyEarningsUpdate(params: {
    artistUserId: string;
    amount: number;
    currency?: string;
  }): Promise<NotificationRecord> {
    const currency = params.currency ?? "EUR";
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(params.amount);

    return this.createNotification({
      userId: params.artistUserId,
      type: "earnings_update",
      title: "Earnings update",
      body: `You earned ${formatted} from recent activity.`,
      payload: {
        amount: params.amount,
        deepLink: "/creator/dashboard?tab=earnings",
        metadata: { currency },
      },
      priority: "high",
    });
  }

  async notifyArtistSupported(params: {
    artistUserId: string;
    supporterId: string;
    supporterName: string;
    amount: number;
    currency?: string;
  }): Promise<NotificationRecord> {
    const currency = params.currency ?? "EUR";
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(params.amount);

    return this.createNotification({
      userId: params.artistUserId,
      type: "artist_supported",
      title: "New support received",
      body: `${params.supporterName} supported you with ${formatted}.`,
      payload: {
        supporterId: params.supporterId,
        amount: params.amount,
        deepLink: "/creator/dashboard?tab=support",
        metadata: { currency },
      },
      priority: "high",
    });
  }

  private normalizePayload(payload?: NotificationPayload): Record<string, unknown> {
    if (!payload) return {};
    return {
      ...(payload.songId ? { songId: payload.songId } : {}),
      ...(payload.artistId ? { artistId: payload.artistId } : {}),
      ...(payload.followerId ? { followerId: payload.followerId } : {}),
      ...(payload.supporterId ? { supporterId: payload.supporterId } : {}),
      ...(typeof payload.amount === "number" ? { amount: payload.amount } : {}),
      ...(payload.deepLink ? { deepLink: payload.deepLink } : {}),
      ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      ...(payload.metadata ? { metadata: payload.metadata } : {}),
    };
  }

  private clampLimit(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.floor(value));
  }

  private getCacheKey(userId: string, limit: number, unreadOnly: boolean): string {
    return `${userId}:${limit}:${unreadOnly ? "u1" : "u0"}`;
  }

  private getCache(key: string): NotificationRecord[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCache(key: string, value: NotificationRecord[]): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  private invalidateUserCache(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;
