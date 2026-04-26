/**
 * Virality Engine
 * Shareable song links, artist profile sharing, preview clips for social media
 */

import { createAdminClient } from "@/lib/supabase/admin";

interface ShareableLink {
  type: "song" | "artist" | "playlist";
  id: string;
  shortCode: string;
  url: string;
  previewClip?: string;
}

class ViralityEngine {
  private baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://sonara.app";

  /**
   * Generate shareable song link
   */
  generateSongLink(songId: string, title: string): ShareableLink {
    const shortCode = this.generateShortCode(songId);
    return {
      type: "song",
      id: songId,
      shortCode,
      url: `${this.baseUrl}/s/${shortCode}`,
    };
  }

  /**
   * Generate shareable artist link
   */
  generateArtistLink(artistId: string, artistName: string): ShareableLink {
    const shortCode = this.generateShortCode(artistId);
    return {
      type: "artist",
      id: artistId,
      shortCode,
      url: `${this.baseUrl}/@${shortCode}`,
    };
  }

  /**
   * Generate short code
   */
  private generateShortCode(id: string): string {
    // Simple hash-based short code
    const hash = this.simpleHash(id);
    return hash.substring(0, 8);
  }

  /**
   * Simple hash function
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Generate preview clip URL (30-second preview)
   */
  generatePreviewClipUrl(songId: string, fileUrl: string): string {
    // This would use a service to generate a 30-second preview clip
    // For now, return the full URL with a preview parameter
    return `${fileUrl}?preview=true&duration=30`;
  }

  /**
   * Track share event
   */
  async trackShare(userId: string, targetType: "song" | "artist", targetId: string, platform: string): Promise<void> {
    const admin = createAdminClient();

    await admin.from("share_events").insert({
      user_id: userId,
      target_type: targetType,
      target_id: targetId,
      platform,
      created_at: new Date().toISOString(),
    });

    // Update share count
    if (targetType === "song") {
      await admin.rpc("increment_song_shares", { p_song_id: targetId });
    } else if (targetType === "artist") {
      await admin.rpc("increment_artist_shares", { p_artist_id: targetId });
    }
  }

  /**
   * Generate social media metadata
   */
  generateSocialMetadata(type: "song" | "artist", data: {
    title?: string;
    description?: string;
    imageUrl?: string;
    artistName?: string;
  }): {
    title: string;
    description: string;
    imageUrl: string;
    url: string;
  } {
    const baseUrl = this.baseUrl;

    if (type === "song") {
      return {
        title: `🎵 ${data.title} on SONARA`,
        description: `Listen to ${data.title} by ${data.artistName} on SONARA - Discover new music.`,
        imageUrl: data.imageUrl || `${baseUrl}/og-default.jpg`,
        url: `${baseUrl}/song/${data.title?.toLowerCase().replace(/\s+/g, "-")}`,
      };
    } else {
      return {
        title: `${data.artistName} on SONARA`,
        description: `Follow ${data.artistName} on SONARA and discover their music.`,
        imageUrl: data.imageUrl || `${baseUrl}/og-default.jpg`,
        url: `${baseUrl}/artist/${data.artistName?.toLowerCase().replace(/\s+/g, "-")}`,
      };
    }
  }

  /**
   * Resolve short code to full URL
   */
  resolveShortCode(shortCode: string): string | null {
    // This would query the database to find the original ID
    // For now, return null
    return null;
  }
}

// Singleton instance
let viralityEngine: ViralityEngine | null = null;

export function getViralityEngine(): ViralityEngine {
  if (!viralityEngine) {
    viralityEngine = new ViralityEngine();
  }
  return viralityEngine;
}
