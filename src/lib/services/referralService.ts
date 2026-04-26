import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReferralStatus = "pending" | "converted" | "expired" | "rejected";
export type RewardType =
  | "premium_days"
  | "visibility_boost"
  | "boost_credits"
  | "onboarding_boost";

export interface ReferralStats {
  userId: string;
  referralCode: string | null;
  invitedTotal: number;
  convertedTotal: number;
  pendingTotal: number;
  rewardsEarned: Array<{
    rewardType: RewardType;
    totalValue: number;
  }>;
  recentInvites: Array<{
    invitedUserId: string;
    status: ReferralStatus;
    createdAt: string;
    convertedAt: string | null;
  }>;
}

export interface RedeemReferralResult {
  ok: boolean;
  inviterUserId?: string;
  invitedUserId?: string;
  referralId?: string;
  error?: string;
}

export interface CreateReferralResult {
  referralId: string;
  inviterUserId: string;
  invitedUserId: string;
  referralCode: string;
  status: ReferralStatus;
  createdAt: string;
}

type ReferralRow = {
  id: string;
  inviter_user_id: string;
  invited_user_id: string;
  referral_code: string;
  status: ReferralStatus;
  created_at: string;
  converted_at: string | null;
};

type RewardRow = {
  reward_type: RewardType;
  reward_value: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const REFERRAL_CODE_LENGTH = 10;
const STATS_CACHE_TTL_MS = 60_000;
const DEFAULT_RECENT_LIMIT = 25;
const MAX_RECENT_LIMIT = 100;
const MAX_CODE_GENERATION_ATTEMPTS = 8;

class ReferralService {
  private readonly statsCache = new Map<string, CacheEntry<ReferralStats>>();

  async ensureReferralCode(userId: string): Promise<string> {
    const admin = createAdminClient();

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id, referral_code")
      .eq("id", userId)
      .single();

    if (profileErr || !profile) {
      throw new Error(`Failed to load profile: ${profileErr?.message ?? "not_found"}`);
    }

    const existingCode = (profile.referral_code as string | null) ?? null;
    if (existingCode) return existingCode;

    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      const candidate = this.generateReferralCode();

      const { error: updateErr } = await admin
        .from("profiles")
        .update({ referral_code: candidate })
        .eq("id", userId)
        .is("referral_code", null);

      if (!updateErr) {
        this.invalidateStatsCache(userId);
        return candidate;
      }

      if (!this.isUniqueViolation(updateErr.message)) {
        throw new Error(`Failed to set referral code: ${updateErr.message}`);
      }
    }

    throw new Error("Failed to generate a unique referral code after multiple attempts");
  }

  async createInvite(params: {
    inviterUserId: string;
    invitedUserId: string;
    referralCode?: string;
    status?: ReferralStatus;
  }): Promise<CreateReferralResult> {
    const admin = createAdminClient();

    if (params.inviterUserId === params.invitedUserId) {
      throw new Error("Self referral is not allowed");
    }

    const referralCode =
      params.referralCode ??
      (await this.ensureReferralCode(params.inviterUserId));

    const { data, error } = await admin
      .from("referrals")
      .upsert(
        {
          inviter_user_id: params.inviterUserId,
          invited_user_id: params.invitedUserId,
          referral_code: referralCode,
          status: params.status ?? "pending",
        },
        { onConflict: "invited_user_id" },
      )
      .select(
        "id, inviter_user_id, invited_user_id, referral_code, status, created_at, converted_at",
      )
      .single();

    if (error || !data) {
      throw new Error(`Failed to create invite: ${error?.message ?? "unknown"}`);
    }

    this.invalidateStatsCache(params.inviterUserId);
    this.invalidateStatsCache(params.invitedUserId);

    return {
      referralId: data.id as string,
      inviterUserId: data.inviter_user_id as string,
      invitedUserId: data.invited_user_id as string,
      referralCode: data.referral_code as string,
      status: data.status as ReferralStatus,
      createdAt: data.created_at as string,
    };
  }

  async redeemReferralCode(params: {
    referralCode: string;
    invitedUserId: string;
  }): Promise<RedeemReferralResult> {
    const code = params.referralCode.trim();
    if (!code) {
      return { ok: false, error: "invalid_referral_code" };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("redeem_referral_code", {
      p_referral_code: code,
      p_invited_user_id: params.invitedUserId,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    const result = (data ?? {}) as RedeemReferralResult;
    if (result.ok && result.inviterUserId) {
      this.invalidateStatsCache(result.inviterUserId);
    }
    this.invalidateStatsCache(params.invitedUserId);

    return {
      ok: Boolean(result.ok),
      inviterUserId: result.inviterUserId,
      invitedUserId: result.invitedUserId,
      referralId: result.referralId,
      error: result.error,
    };
  }

  async grantReferralReward(params: {
    referralId: string;
    userId: string;
    rewardType: RewardType;
    rewardValue: number;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const admin = createAdminClient();

    const { error } = await admin.from("referral_rewards").upsert(
      {
        referral_id: params.referralId,
        user_id: params.userId,
        reward_type: params.rewardType,
        reward_value: params.rewardValue,
        meta: params.meta ?? {},
      },
      { onConflict: "referral_id,user_id,reward_type" },
    );

    if (error) {
      throw new Error(`Failed to grant referral reward: ${error.message}`);
    }

    if (params.rewardType === "boost_credits" && params.rewardValue > 0) {
      await this.creditArtistBoostWalletByUser(params.userId, Math.floor(params.rewardValue));
    }

    this.invalidateStatsCache(params.userId);
  }

  async getReferralStats(userId: string, recentLimit = DEFAULT_RECENT_LIMIT): Promise<ReferralStats> {
    const normalizedLimit = this.normalizeLimit(recentLimit);
    const cacheKey = `${userId}:${normalizedLimit}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    const admin = createAdminClient();
    const referralCode = await this.ensureReferralCode(userId);

    const [invitesRes, rewardsRes] = await Promise.all([
      admin
        .from("referrals")
        .select(
          "id, inviter_user_id, invited_user_id, referral_code, status, created_at, converted_at",
        )
        .eq("inviter_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(normalizedLimit),
      admin
        .from("referral_rewards")
        .select("reward_type, reward_value")
        .eq("user_id", userId),
    ]);

    if (invitesRes.error) {
      throw new Error(`Failed to load referral invites: ${invitesRes.error.message}`);
    }

    if (rewardsRes.error) {
      throw new Error(`Failed to load referral rewards: ${rewardsRes.error.message}`);
    }

    const invites = (invitesRes.data ?? []) as ReferralRow[];
    const rewards = (rewardsRes.data ?? []) as RewardRow[];

    const invitedTotal = invites.length;
    const convertedTotal = invites.filter((r) => r.status === "converted").length;
    const pendingTotal = invites.filter((r) => r.status === "pending").length;

    const rewardTotals = new Map<RewardType, number>();
    for (const reward of rewards) {
      const current = rewardTotals.get(reward.reward_type) ?? 0;
      rewardTotals.set(
        reward.reward_type,
        current + Number(reward.reward_value ?? 0),
      );
    }

    const rewardsEarned = Array.from(rewardTotals.entries()).map(([rewardType, totalValue]) => ({
      rewardType,
      totalValue: Number(totalValue.toFixed(4)),
    }));

    const stats: ReferralStats = {
      userId,
      referralCode,
      invitedTotal,
      convertedTotal,
      pendingTotal,
      rewardsEarned,
      recentInvites: invites.map((invite) => ({
        invitedUserId: invite.invited_user_id,
        status: invite.status,
        createdAt: invite.created_at,
        convertedAt: invite.converted_at,
      })),
    };

    this.setCache(cacheKey, stats);
    return stats;
  }

  async getInviterByCode(referralCode: string): Promise<{ inviterUserId: string; referralCode: string } | null> {
    const code = referralCode.trim().toUpperCase();
    if (!code) return null;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, referral_code")
      .eq("referral_code", code)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch inviter by code: ${error.message}`);
    }
    if (!data) return null;

    return {
      inviterUserId: data.id as string,
      referralCode: data.referral_code as string,
    };
  }

  private async creditArtistBoostWalletByUser(userId: string, credits: number): Promise<void> {
    if (credits <= 0) return;

    const admin = createAdminClient();

    const { data: artist, error: artistErr } = await admin
      .from("artists")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (artistErr) {
      throw new Error(`Failed to load artist for boost credit: ${artistErr.message}`);
    }
    if (!artist?.id) return;

    const artistId = artist.id as string;

    const { data: wallet, error: walletErr } = await admin
      .from("artist_boost_wallets")
      .select("artist_id, credits_balance")
      .eq("artist_id", artistId)
      .maybeSingle();

    if (walletErr) {
      throw new Error(`Failed to load boost wallet: ${walletErr.message}`);
    }

    if (!wallet) {
      const { error: insertErr } = await admin.from("artist_boost_wallets").insert({
        artist_id: artistId,
        credits_balance: credits,
        daily_limit: 3,
        daily_used: 0,
      });

      if (insertErr) {
        throw new Error(`Failed to create boost wallet: ${insertErr.message}`);
      }
      return;
    }

    const nextBalance = Number(wallet.credits_balance ?? 0) + credits;
    const { error: updateErr } = await admin
      .from("artist_boost_wallets")
      .update({ credits_balance: nextBalance, updated_at: new Date().toISOString() })
      .eq("artist_id", artistId);

    if (updateErr) {
      throw new Error(`Failed to update boost wallet: ${updateErr.message}`);
    }
  }

  private generateReferralCode(): string {
    const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
    return bytes
      .toString("base64url")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, REFERRAL_CODE_LENGTH)
      .toUpperCase();
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_RECENT_LIMIT;
    return Math.min(MAX_RECENT_LIMIT, Math.floor(limit));
  }

  private isUniqueViolation(message?: string): boolean {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return (
      normalized.includes("duplicate") ||
      normalized.includes("unique") ||
      normalized.includes("already exists")
    );
  }

  private getCache(key: string): ReferralStats | null {
    const entry = this.statsCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.statsCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCache(key: string, value: ReferralStats): void {
    this.statsCache.set(key, {
      value,
      expiresAt: Date.now() + STATS_CACHE_TTL_MS,
    });
  }

  private invalidateStatsCache(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this.statsCache.keys()) {
      if (key.startsWith(prefix)) {
        this.statsCache.delete(key);
      }
    }
  }
}

export const referralService = new ReferralService();
export default referralService;
