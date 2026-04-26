/**
 * Retention Engine
 * Follow artists, liked songs auto playlist, "discover more like this"
 */

import { createAdminClient } from "@/lib/supabase/admin";

interface RetentionAction {
  type: "follow" | "like" | "share" | "playlist_add" | "listen";
  userId: string;
  targetId: string;
  timestamp: number;
}

class RetentionEngine {
  private actionHistory = new Map<string, RetentionAction[]>();

  /**
   * Track user action
   */
  trackAction(action: Omit<RetentionAction, "timestamp">): void {
    const history = this.actionHistory.get(action.userId) || [];
    history.push({ ...action, timestamp: Date.now() });
    this.actionHistory.set(action.userId, history);

    // Trigger retention loops based on actions
    void this.triggerRetentionLoops(action);
  }

  /**
   * Trigger retention loops based on user actions
   */
  private async triggerRetentionLoops(action: Omit<RetentionAction, "timestamp">): Promise<void> {
    switch (action.type) {
      case "like":
        await this.onSongLiked(action.userId, action.targetId);
        break;
      case "follow":
        await this.onArtistFollowed(action.userId, action.targetId);
        break;
      case "listen":
        await this.onSongListened(action.userId, action.targetId);
        break;
    }
  }

  /**
   * When user likes a song
   */
  private async onSongLiked(userId: string, songId: string): Promise<void> {
    // Add to "Liked Songs" auto-playlist
    await this.addToAutoPlaylist(userId, "liked_songs", songId);

    // Suggest similar songs
    await this.suggestSimilarSongs(userId, songId);
  }

  /**
   * When user follows an artist
   */
  private async onArtistFollowed(userId: string, artistId: string): Promise<void> {
    // Get artist's songs
    const admin = createAdminClient();
    const { data: songs } = await admin
      .from("songs")
      .select("id")
      .eq("artist_id", artistId)
      .limit(10);

    if (songs) {
      // Add to "Followed Artists" playlist
      for (const song of songs) {
        await this.addToAutoPlaylist(userId, "followed_artists", song.id);
      }
    }
  }

  /**
   * When user listens to a song
   */
  private async onSongListened(userId: string, songId: string): Promise<void> {
    // Track listening patterns for personalization
    // This would feed into the recommendation engine
  }

  /**
   * Add song to auto-playlist
   */
  private async addToAutoPlaylist(
    userId: string,
    playlistType: "liked_songs" | "followed_artists",
    songId: string
  ): Promise<void> {
    const admin = createAdminClient();

    // Check if playlist exists
    const { data: playlist } = await admin
      .from("playlists")
      .select("id")
      .eq("user_id", userId)
      .eq("name", playlistType === "liked_songs" ? "Liked Songs" : "Followed Artists")
      .single();

    let playlistId: string;

    if (!playlist) {
      // Create playlist
      const { data: newPlaylist } = await admin
        .from("playlists")
        .insert({
          user_id: userId,
          name: playlistType === "liked_songs" ? "Liked Songs" : "Followed Artists",
        })
        .select("id")
        .single();

      playlistId = newPlaylist?.id;
    } else {
      playlistId = playlist.id;
    }

    if (!playlistId) return;

    // Add song to playlist
    await admin.from("playlist_songs").insert({
      playlist_id: playlistId,
      song_id: songId,
    });
  }

  /**
   * Suggest similar songs (discover more like this)
   */
  private async suggestSimilarSongs(userId: string, songId: string): Promise<void> {
    const admin = createAdminClient();

    // Get song info
    const { data: song } = await admin
      .from("songs")
      .select("genre, artist_id")
      .eq("id", songId)
      .single();

    if (!song) return;

    // Find similar songs (same genre, different artist)
    const { data: similarSongs } = await admin
      .from("songs")
      .select("id, title, artist_id")
      .eq("genre", song.genre)
      .neq("artist_id", song.artist_id)
      .limit(5);

    if (similarSongs) {
      // Store recommendations for user
      // This would be shown in a "You might also like" section
    }
  }

  /**
   * Get user's action history
   */
  getActionHistory(userId: string): RetentionAction[] {
    return this.actionHistory.get(userId) || [];
  }

  /**
   * Get retention metrics
   */
  getRetentionMetrics(userId: string): {
    totalActions: number;
    likes: number;
    follows: number;
    listens: number;
    shares: number;
  } {
    const history = this.actionHistory.get(userId) || [];

    return {
      totalActions: history.length,
      likes: history.filter((a) => a.type === "like").length,
      follows: history.filter((a) => a.type === "follow").length,
      listens: history.filter((a) => a.type === "listen").length,
      shares: history.filter((a) => a.type === "share").length,
    };
  }
}

// Singleton instance
let retentionEngine: RetentionEngine | null = null;

export function getRetentionEngine(): RetentionEngine {
  if (!retentionEngine) {
    retentionEngine = new RetentionEngine();
  }
  return retentionEngine;
}
