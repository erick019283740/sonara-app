"use client";

import { useUser } from "@/contexts/user-context";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  artistId: string;
  initialFollowerCount?: number;
};

type ArtistRealtimeRow = {
  id: string;
  follower_count: number | null;
};

export function ArtistActions({ artistId, initialFollowerCount = 0 }: Props) {
  const { user } = useUser();
  const supabase = useMemo(() => createClient(), []);

  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] =
    useState<number>(initialFollowerCount);
  const [busy, setBusy] = useState(false);

  // Load initial follow state (for logged-in users)
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("artist_follows")
        .select("id")
        .eq("artist_id", artistId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!cancelled) {
        setFollowing(!!data);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artistId, supabase, user]);

  // Fetch current follower count once (fallback if page didn't provide it)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("artists")
        .select("follower_count")
        .eq("id", artistId)
        .maybeSingle<Pick<ArtistRealtimeRow, "follower_count">>();

      if (!cancelled && data?.follower_count != null) {
        setFollowerCount(data.follower_count);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artistId, supabase]);

  // Realtime follower count updates
  useEffect(() => {
    const channel = supabase
      .channel(`artist-followers-${artistId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "artists",
          filter: `id=eq.${artistId}`,
        },
        (payload) => {
          const row = payload.new as ArtistRealtimeRow;
          if (typeof row?.follower_count === "number") {
            setFollowerCount(row.follower_count);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [artistId, supabase]);

  const toggleFollow = useCallback(async () => {
    if (!user || busy) return;

    setBusy(true);
    const prevFollowing = following;
    const prevCount = followerCount;

    // optimistic UI
    const nextFollowing = !prevFollowing;
    setFollowing(nextFollowing);
    setFollowerCount((c) => Math.max(0, c + (nextFollowing ? 1 : -1)));

    try {
      if (prevFollowing) {
        const { error } = await supabase
          .from("artist_follows")
          .delete()
          .eq("artist_id", artistId)
          .eq("user_id", user.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("artist_follows").insert({
          artist_id: artistId,
          user_id: user.id,
        });

        if (error) throw error;
      }
    } catch {
      // rollback optimistic update
      setFollowing(prevFollowing);
      setFollowerCount(prevCount);
    } finally {
      setBusy(false);
    }
  }, [artistId, busy, followerCount, following, supabase, user]);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={!user || busy}
        onClick={() => void toggleFollow()}
        className="rounded-full border border-white/20 px-5 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-40"
      >
        {busy
          ? "Updating..."
          : !user
            ? "Follow"
            : following
              ? "Following"
              : "Follow"}
      </button>

      <span className="text-xs text-zinc-400">
        {followerCount.toLocaleString()} follower
        {followerCount === 1 ? "" : "s"}
      </span>

      {!user && (
        <span className="text-xs text-zinc-500">Log in to follow.</span>
      )}
    </div>
  );
}
