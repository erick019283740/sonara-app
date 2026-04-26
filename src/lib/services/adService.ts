import { createAdminClient } from "@/lib/supabase/admin";

export interface Ad {
  id: string;
  title: string;
  media_url: string;
  target_url: string | null;
  ad_type: "banner" | "audio" | "video";
  duration_seconds: number | null;
}

export interface AdDeliveryResult {
  ok: boolean;
  reason?: string;
  ad?: Ad;
}

/**
 * Get next ad for user based on frequency cap and weighted rotation
 */
export async function getNextAd(
  userId: string,
  adType: "banner" | "audio" | "video"
): Promise<AdDeliveryResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_next_ad", {
    p_user_id: userId,
    p_ad_type: adType,
  });

  if (error) {
    console.error("[AdService] Error getting next ad:", error);
    return { ok: false, reason: "error" };
  }

  const result = data as {
    ok: boolean;
    reason?: string;
    ad?: Ad;
  } | null;

  if (!result?.ok || !result.ad) {
    return { ok: false, reason: result?.reason || "no_ad" };
  }

  return { ok: true, ad: result.ad };
}

/**
 * Track ad impression
 */
export async function trackImpression(
  adId: string,
  userId: string | null,
  sessionId: string
): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("track_ad_impression", {
    p_ad_id: adId,
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) {
    console.error("[AdService] Error tracking impression:", error);
    return null;
  }

  const result = data as { ok: boolean; impression_id?: string } | null;
  return result?.impression_id || null;
}

/**
 * Track ad completion
 */
export async function trackCompletion(
  impressionId: string,
  durationSeconds: number
): Promise<boolean> {
  const admin = createAdminClient();

  const { error } = await admin.rpc("track_ad_completion", {
    p_impression_id: impressionId,
    p_duration_seconds: durationSeconds,
  });

  if (error) {
    console.error("[AdService] Error tracking completion:", error);
    return false;
  }

  return true;
}

/**
 * Track ad click
 */
export async function trackClick(
  adId: string,
  impressionId: string,
  userId: string | null
): Promise<boolean> {
  const admin = createAdminClient();

  const { error } = await admin.from("ad_clicks").insert({
    ad_id: adId,
    impression_id: impressionId,
    user_id: userId,
  });

  if (error) {
    console.error("[AdService] Error tracking click:", error);
    return false;
  }

  // Update ad click count
  await admin
    .from("ads")
    .update({ clicks: (raw: unknown) => (raw as number) + 1 })
    .eq("id", adId);

  return true;
}

/**
 * Calculate ad revenue
 */
export async function calculateAdRevenue(): Promise<void> {
  const admin = createAdminClient();

  // Calculate CPM revenue (per 1000 impressions)
  const { data: cpmAds } = await admin
    .from("ads")
    .select("id, cpm, impressions")
    .not("cpm", "eq", 0)
    .gt("impressions", 0);

  if (cpmAds) {
    for (const ad of cpmAds) {
      const newImpressions = (ad.impressions as number) % 1000;
      if (newImpressions >= 1000) {
        const batches = Math.floor((ad.impressions as number) / 1000);
        const revenue = batches * (ad.cpm as number);
        
        if (revenue > 0) {
          await admin.from("ad_revenue").insert({
            ad_id: ad.id,
            revenue_type: "cpm",
            amount: revenue,
            metric_count: batches * 1000,
          });
        }
      }
    }
  }

  // Calculate CPC revenue
  const { data: cpcAds } = await admin
    .from("ads")
    .select("id, cpc, clicks")
    .not("cpc", "eq", 0)
    .gt("clicks", 0);

  if (cpcAds) {
    for (const ad of cpcAds) {
      const revenue = (ad.clicks as number) * (ad.cpc as number);
      
      if (revenue > 0) {
        await admin.from("ad_revenue").insert({
          ad_id: ad.id,
          revenue_type: "cpc",
          amount: revenue,
          metric_count: ad.clicks as number,
        });
      }
    }
  }
}
