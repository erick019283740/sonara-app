"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  playerSelectors,
  playerStore,
  usePlayerStore,
} from "@/store/playerStore";
import type { PlayerState } from "@/store/playerStore";
import type { Song } from "@/types/database";

type UsePlayerOptions = {
  streamThresholdSeconds?: number;
  preloadAhead?: number;
  maxRetries?: number;
  autoPlayOnIndexChange?: boolean;
  initialFeedEndpoint?: string;
};

type FeedEndpointSong = {
  songId?: string;
  id?: string;
  artistId?: string;
  artist_id?: string;
  title?: string;
  genre?: string;
  duration?: number;
  fileUrl?: string;
  file_url?: string;
  coverUrl?: string | null;
  cover_url?: string | null;
  streamCount?: number;
  stream_count?: number;
  likes?: number;
  likes_count?: number;
  shares?: number;
  shares_count?: number;
  artist?: Song["artist"];
};

type StreamPayload = {
  userId?: string | null;
  songId: string;
  artistId: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  sessionId: string;
};

type FeedLoadResult = {
  songs: Song[];
  hasMore: boolean;
};

type NetworkQuality = "online" | "offline" | "slow";

const STREAM_SESSION_KEY = "sonara_stream_session_id_v3";
const DEFAULT_STREAM_THRESHOLD = 30;
const DEFAULT_PRELOAD_AHEAD = 2;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_FEED_ENDPOINT = "/api/feed/for-you";
const DEFAULT_PAGE_SIZE = 20;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function createSessionId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.localStorage.getItem(STREAM_SESSION_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(STREAM_SESSION_KEY, next);
  return next;
}

function mapFeedSongToSong(input: FeedEndpointSong): Song | null {
  const id = (input.songId ?? input.id ?? "").trim();
  const artistId = (input.artistId ?? input.artist_id ?? "").trim();
  const title = (input.title ?? "").trim();
  const fileUrl = (input.fileUrl ?? input.file_url ?? "").trim();

  if (!id || !artistId || !title || !fileUrl) return null;

  return {
    id,
    artist_id: artistId,
    title,
    genre: (input.genre ?? "Unknown").trim() || "Unknown",
    duration: Number.isFinite(input.duration) ? Number(input.duration) : 0,
    file_url: fileUrl,
    cover_url: (input.coverUrl ?? input.cover_url ?? null) || null,
    created_at: new Date().toISOString(),
    stream_count: Number.isFinite(input.streamCount)
      ? Number(input.streamCount)
      : Number.isFinite(input.stream_count)
        ? Number(input.stream_count)
        : 0,
    likes_count: Number.isFinite(input.likes)
      ? Number(input.likes)
      : Number.isFinite(input.likes_count)
        ? Number(input.likes_count)
        : 0,
    shares_count: Number.isFinite(input.shares)
      ? Number(input.shares)
      : Number.isFinite(input.shares_count)
        ? Number(input.shares_count)
        : 0,
    artist: input.artist,
  };
}

async function getAuthUserId(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/user", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id?: string } };
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function postStream(payload: StreamPayload): Promise<boolean> {
  try {
    const res = await fetch("/api/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: payload.userId ?? null,
        songId: payload.songId,
        artistId: payload.artistId,
        durationPlayedSeconds: payload.durationPlayedSeconds,
        totalDurationSeconds: payload.totalDurationSeconds,
        sessionId: payload.sessionId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function postFeedInteraction(params: {
  songId: string;
  watchTimeSeconds: number;
  totalDurationSeconds: number;
  liked?: boolean;
  followed?: boolean;
  skipped?: boolean;
  replayed?: boolean;
  shared?: boolean;
  source?: "feed" | "song" | "artist" | "search" | "other";
}) {
  try {
    await fetch("/api/feed/for-you", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    // noop
  }
}

function detectNetworkStatus(): NetworkQuality {
  if (typeof navigator === "undefined") return "online";
  if (!navigator.onLine) return "offline";
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string };
  };
  const type = nav.connection?.effectiveType ?? "";
  if (type === "2g" || type === "slow-2g") return "slow";
  return "online";
}

async function fetchFeedChunk(
  endpoint: string,
  limit: number,
  offset: number,
): Promise<FeedLoadResult> {
  const url = new URL(
    endpoint,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return { songs: [], hasMore: false };

  const data = (await res.json()) as { songs?: FeedEndpointSong[] };
  const mapped = (data.songs ?? [])
    .map(mapFeedSongToSong)
    .filter((s): s is Song => Boolean(s));

  return {
    songs: mapped,
    hasMore: mapped.length >= limit,
  };
}

export function usePlayer(options: UsePlayerOptions = {}) {
  const streamThreshold =
    options.streamThresholdSeconds ?? DEFAULT_STREAM_THRESHOLD;
  const preloadAhead = options.preloadAhead ?? DEFAULT_PRELOAD_AHEAD;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const autoPlayOnIndexChange = options.autoPlayOnIndexChange ?? true;
  const feedEndpoint = options.initialFeedEndpoint ?? DEFAULT_FEED_ENDPOINT;

  const queue = usePlayerStore(playerSelectors.queue);
  const currentSong = usePlayerStore(playerSelectors.currentSong);
  const currentSongId = usePlayerStore(playerSelectors.currentSongId);
  const currentIndex = usePlayerStore(playerSelectors.currentIndex);
  const activeFeedIndex = usePlayerStore(playerSelectors.activeFeedIndex);
  const isPlaying = usePlayerStore(playerSelectors.isPlaying);
  const timing = usePlayerStore(playerSelectors.timing);
  const buffering = usePlayerStore(playerSelectors.buffering);
  const interactions = usePlayerStore(playerSelectors.interactions);

  const [networkStatus, setNetworkStatus] = useState<NetworkQuality>(() =>
    detectNetworkStatus(),
  );
  const [hasMoreFeed, setHasMoreFeed] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const supabase = useMemo(() => createClient(), []);
  const sessionIdRef = useRef<string>(createSessionId());
  const authUserIdRef = useRef<string | null>(null);

  const effectivePlayedRef = useRef(0);
  const mediaLastTimeRef = useRef(0);
  const wallClockRef = useRef<number | null>(null);
  const reportedSongIdsRef = useRef<Record<string, true>>({});
  const heartbeatTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const feedOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    playerStore.getState().setNetworkStatus(networkStatus);

    const onOnline = () => {
      const v = detectNetworkStatus();
      setNetworkStatus(v);
      playerStore.getState().setNetworkStatus(v);
    };
    const onOffline = () => {
      setNetworkStatus("offline");
      playerStore.getState().setNetworkStatus("offline");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [networkStatus]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const uid = await getAuthUserId();
      if (!mounted) return;
      authUserIdRef.current = uid;
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    feedOffsetRef.current = queue.length;
  }, [queue.length]);

  const cleanupRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const cleanupHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const resetCounters = useCallback(() => {
    effectivePlayedRef.current = 0;
    mediaLastTimeRef.current = 0;
    wallClockRef.current = null;
    playerStore.getState().setTime(0);
  }, []);

  const ensureAudioElement = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.setAttribute("playsinline", "true");
    audioRef.current = el;
    return el;
  }, []);

  const haptic = useCallback((intensity: "light" | "medium" = "light") => {
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return;
    if (intensity === "medium") navigator.vibrate([8, 14, 8]);
    else navigator.vibrate(8);
  }, []);

  const preloadSong = useCallback((song?: Song | null) => {
    if (!song?.file_url) return;
    const state = playerStore.getState();
    if (state.preloadMap[song.id]) return;
    if (preloadAudioRef.current.has(song.id)) return;

    const a = new Audio();
    a.preload = "auto";
    a.src = song.file_url;
    a.crossOrigin = "anonymous";
    preloadAudioRef.current.set(song.id, a);

    const onReady = () => {
      playerStore.getState().markPreloaded(song.id);
      a.removeEventListener("canplaythrough", onReady);
    };

    a.addEventListener("canplaythrough", onReady);
    a.load();
  }, []);

  const preloadAheadSongs = useCallback(
    (startIdx: number) => {
      for (let i = 1; i <= preloadAhead; i++) {
        const song = queue[startIdx + i];
        if (!song) break;
        preloadSong(song);
      }
    },
    [preloadAhead, preloadSong, queue],
  );

  const playCurrent = useCallback(async () => {
    const song =
      playerStore.getState().queue[playerStore.getState().currentIndex];
    if (!song) return;

    const audio = ensureAudioElement();
    cleanupRetryTimer();

    const currentSrc = audio.src || "";
    const nextSrc = song.file_url || "";
    const sourceChanged = !currentSrc.includes(nextSrc);

    if (sourceChanged) {
      audio.src = nextSrc;
      audio.load();
      resetCounters();
      playerStore.getState().setDuration(song.duration || 0);
      playerStore.getState().setBufferStatus("loading");
    }

    try {
      await audio.play();
      playerStore.getState().play();
      playerStore.getState().setBufferStatus("ready");
      playerStore.getState().clearError();
      playerStore.getState().resetRetry();
      wallClockRef.current = performance.now();
      mediaLastTimeRef.current = audio.currentTime || 0;
      preloadAheadSongs(playerStore.getState().currentIndex);
    } catch {
      playerStore.getState().pause();
      playerStore.getState().setBufferStatus("error");
      playerStore.getState().setError("playback_start_failed");
    }
  }, [cleanupRetryTimer, ensureAudioElement, preloadAheadSongs, resetCounters]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    playerStore.getState().pause();
  }, []);

  const play = useCallback(() => {
    void playCurrent();
  }, [playCurrent]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = playerStore.getState().duration || audio.duration || 0;
    const t = clamp(seconds, 0, Math.max(0, duration));
    audio.currentTime = t;
    playerStore.getState().setTime(t);
    mediaLastTimeRef.current = t;
    wallClockRef.current = performance.now();
  }, []);

  const setQueue = useCallback(
    (songs: Song[], startIndex = 0) => {
      playerStore.getState().setQueue(songs, startIndex);
      if (autoPlayOnIndexChange) {
        void playCurrent();
      }
    },
    [autoPlayOnIndexChange, playCurrent],
  );

  const setCurrentIndex = useCallback(
    (index: number) => {
      const prevSong =
        playerStore.getState().queue[playerStore.getState().currentIndex];
      const prevTime = effectivePlayedRef.current;

      playerStore.getState().setCurrentIndex(index);

      if (autoPlayOnIndexChange) {
        void playCurrent();
      }

      if (prevSong && prevTime > 0) {
        void postFeedInteraction({
          songId: prevSong.id,
          watchTimeSeconds: Math.floor(prevTime),
          totalDurationSeconds: prevSong.duration || 0,
          skipped: prevTime < Math.min(streamThreshold, 8),
          source: "feed",
        });
      }
    },
    [autoPlayOnIndexChange, playCurrent, streamThreshold],
  );

  const setActiveFeedIndex = useCallback(
    (index: number) => {
      const safe = clamp(index, 0, Math.max(0, queue.length - 1));
      playerStore.getState().setActiveFeedIndex(safe);
      if (safe !== playerStore.getState().currentIndex) {
        setCurrentIndex(safe);
      }
    },
    [queue.length, setCurrentIndex],
  );

  const next = useCallback(() => {
    setCurrentIndex(playerStore.getState().currentIndex + 1);
  }, [setCurrentIndex]);

  const prev = useCallback(() => {
    setCurrentIndex(playerStore.getState().currentIndex - 1);
  }, [setCurrentIndex]);

  const togglePlay = useCallback(() => {
    const state = playerStore.getState();
    if (state.isPlaying) pause();
    else void playCurrent();
    haptic("light");
  }, [haptic, pause, playCurrent]);

  const toggleLike = useCallback(
    async (song: Song, userId?: string | null) => {
      const effectiveUserId = userId ?? authUserIdRef.current;
      if (!effectiveUserId) return false;

      const liked = Boolean(
        playerStore.getState().interactions.likedSongIds[song.id],
      );

      if (liked) {
        await supabase
          .from("song_likes")
          .delete()
          .eq("song_id", song.id)
          .eq("user_id", effectiveUserId);
        playerStore.getState().markLiked(song.id, false);
      } else {
        await supabase.from("song_likes").insert({
          song_id: song.id,
          user_id: effectiveUserId,
        });
        playerStore.getState().markLiked(song.id, true);
      }

      void postFeedInteraction({
        songId: song.id,
        watchTimeSeconds: Math.floor(effectivePlayedRef.current),
        totalDurationSeconds: song.duration || 0,
        liked: !liked,
        source: "feed",
      });

      haptic("medium");
      return true;
    },
    [haptic, supabase],
  );

  const toggleFollowArtist = useCallback(
    async (artistId: string, followed: boolean) => {
      await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "artist",
          targetId: artistId,
          followed: !followed,
        }),
      });

      playerStore.getState().markFollowed(artistId, !followed);

      const song =
        playerStore.getState().queue[playerStore.getState().currentIndex];
      if (song) {
        void postFeedInteraction({
          songId: song.id,
          watchTimeSeconds: Math.floor(effectivePlayedRef.current),
          totalDurationSeconds: song.duration || 0,
          followed: !followed,
          source: "feed",
        });
      }

      haptic("light");
      return true;
    },
    [haptic],
  );

  const supportArtist = useCallback(
    async (artistId: string, amount = 5, userId?: string | null) => {
      const effectiveUserId = userId ?? authUserIdRef.current;
      if (!effectiveUserId) return false;

      await fetch("/api/support-artist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: effectiveUserId, artistId, amount }),
      });

      playerStore.getState().markSupported(artistId, true);

      const song =
        playerStore.getState().queue[playerStore.getState().currentIndex];
      if (song) {
        void postFeedInteraction({
          songId: song.id,
          watchTimeSeconds: Math.floor(effectivePlayedRef.current),
          totalDurationSeconds: song.duration || 0,
          source: "feed",
        });
      }

      haptic("medium");
      return true;
    },
    [haptic],
  );

  const fetchMoreFeedSongs = useCallback(
    async (count = DEFAULT_PAGE_SIZE): Promise<Song[]> => {
      if (loadingMoreRef.current || !hasMoreFeed) return [];
      loadingMoreRef.current = true;

      try {
        const { songs, hasMore } = await fetchFeedChunk(
          feedEndpoint,
          count,
          feedOffsetRef.current,
        );
        feedOffsetRef.current += songs.length;
        setHasMoreFeed(hasMore);
        return songs;
      } finally {
        loadingMoreRef.current = false;
      }
    },
    [feedEndpoint, hasMoreFeed],
  );

  const ensureRealtimeFeedSync = useCallback(() => {
    const ids = playerStore
      .getState()
      .queue.map((s: Song) => s.id)
      .filter(Boolean);
    if (!ids.length) return () => {};

    const channel = supabase
      .channel(`player-feed-live-${ids.slice(0, 20).join("-")}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "songs",
          filter: `id=in.(${ids.join(",")})`,
        },
        (payload) => {
          const row = payload.new as Partial<Song> & { id?: string };
          if (!row?.id) return;

          const state = playerStore.getState();
          const nextQueue = state.queue.map((song: Song) => {
            if (song.id !== row.id) return song;
            return {
              ...song,
              stream_count: Number(row.stream_count ?? song.stream_count ?? 0),
              likes_count: Number(row.likes_count ?? song.likes_count ?? 0),
              shares_count: Number(row.shares_count ?? song.shares_count ?? 0),
              cover_url: row.cover_url ?? song.cover_url ?? null,
              title: row.title ?? song.title,
            };
          });

          playerStore.getState().setQueue(nextQueue, state.currentIndex);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  useEffect(() => {
    const unsubscribePlaying = playerStore.subscribe(
      (s: PlayerState) => s.isPlaying,
      (playing: boolean) => {
        const audio = audioRef.current;
        if (!audio) return;
        if (playing) {
          void audio.play().catch(() => {
            playerStore.getState().pause();
            playerStore.getState().setBufferStatus("error");
            playerStore.getState().setError("autoplay_blocked");
          });
        } else {
          audio.pause();
        }
      },
    );

    return () => {
      unsubscribePlaying();
    };
  }, []);

  useEffect(() => {
    const audio = ensureAudioElement();

    const onLoadedMetadata = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      playerStore.getState().setDuration(d);
    };

    const onTimeUpdate = () => {
      const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      playerStore.getState().setTime(t);
    };

    const onPlaying = () => {
      playerStore.getState().setBufferStatus("ready");
      playerStore.getState().clearError();
      wallClockRef.current = performance.now();
      mediaLastTimeRef.current = audio.currentTime || 0;
    };

    const onWaiting = () => {
      playerStore.getState().setBufferStatus("buffering");
    };

    const onCanPlay = () => {
      playerStore.getState().setBufferStatus("ready");
    };

    const onEnded = () => {
      const song =
        playerStore.getState().queue[playerStore.getState().currentIndex];
      if (song) {
        void postFeedInteraction({
          songId: song.id,
          watchTimeSeconds: Math.floor(effectivePlayedRef.current),
          totalDurationSeconds: song.duration || 0,
          replayed: false,
          skipped: false,
          source: "feed",
        });
      }
      playerStore.getState().next();
      if (autoPlayOnIndexChange) {
        void playCurrent();
      }
    };

    const onError = () => {
      const state = playerStore.getState();
      const retries = state.retryCount;
      state.setBufferStatus("error");
      state.setError("audio_error");

      if (retries < maxRetries) {
        state.incrementRetry();
        cleanupRetryTimer();
        retryTimerRef.current = window.setTimeout(
          () => {
            void playCurrent();
          },
          350 + retries * 250,
        );
      }
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [
    autoPlayOnIndexChange,
    cleanupRetryTimer,
    ensureAudioElement,
    maxRetries,
    playCurrent,
  ]);

  useEffect(() => {
    cleanupHeartbeat();

    heartbeatTimerRef.current = window.setInterval(() => {
      const state = playerStore.getState();
      if (!state.isPlaying) {
        wallClockRef.current = null;
        return;
      }

      const audio = audioRef.current;
      if (!audio) return;

      const nowTs = performance.now();
      if (wallClockRef.current == null) {
        wallClockRef.current = nowTs;
        mediaLastTimeRef.current = audio.currentTime || 0;
        return;
      }

      const wallDelta = Math.max(0, (nowTs - wallClockRef.current) / 1000);
      const mediaNow = Math.max(0, audio.currentTime || 0);
      const mediaDelta = Math.max(0, mediaNow - mediaLastTimeRef.current);

      const increment = Math.min(wallDelta, mediaDelta + 0.06);
      if (increment > 0 && increment < 5) {
        effectivePlayedRef.current += increment;
      }

      wallClockRef.current = nowTs;
      mediaLastTimeRef.current = mediaNow;

      const song = state.queue[state.currentIndex];
      if (!song) return;

      const userId = authUserIdRef.current;
      if (!userId) return;

      const key = `${song.id}:${userId}`;
      if (
        effectivePlayedRef.current >= streamThreshold &&
        !reportedSongIdsRef.current[key]
      ) {
        reportedSongIdsRef.current[key] = true;
        void postStream({
          userId,
          songId: song.id,
          artistId: song.artist_id,
          durationPlayedSeconds: Math.floor(effectivePlayedRef.current),
          totalDurationSeconds: Math.floor(
            state.duration || song.duration || 0,
          ),
          sessionId: sessionIdRef.current,
        });
      }
    }, 250);

    return cleanupHeartbeat;
  }, [cleanupHeartbeat, streamThreshold]);

  useEffect(() => {
    const unsubscribeCurrentSong = playerStore.subscribe(
      (s: PlayerState) => s.currentSongId,
      (_songId: string | null, prevSongId: string | null) => {
        if (prevSongId && timing.currentTime > 0) {
          const prevSong = queue.find((s) => s.id === prevSongId);
          if (prevSong) {
            void postFeedInteraction({
              songId: prevSong.id,
              watchTimeSeconds: Math.floor(effectivePlayedRef.current),
              totalDurationSeconds: prevSong.duration || 0,
              skipped:
                effectivePlayedRef.current < Math.min(streamThreshold, 8),
              source: "feed",
            });
          }
        }
        resetCounters();
      },
    );

    return () => unsubscribeCurrentSong();
  }, [queue, resetCounters, streamThreshold, timing.currentTime]);

  useEffect(() => {
    if (!currentSong) return;
    preloadAheadSongs(currentIndex);
  }, [currentIndex, currentSong, preloadAheadSongs]);

  useEffect(() => {
    const preloadMap = preloadAudioRef.current;
    return () => {
      cleanupHeartbeat();
      cleanupRetryTimer();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      preloadMap.forEach((a) => {
        a.pause();
        a.src = "";
      });
      preloadMap.clear();
    };
  }, [cleanupHeartbeat, cleanupRetryTimer]);

  const api = useMemo(
    () => ({
      audioRef,

      queue,
      currentSong,
      currentSongId,
      currentIndex,
      activeFeedIndex,
      isPlaying,
      timing,
      buffering,
      interactions,

      networkStatus,
      bufferStatus: buffering.bufferStatus,
      retryCount: buffering.retryCount,
      error: buffering.error,
      hasMoreFeed,

      setQueue,
      setCurrentIndex,
      setActiveFeedIndex,
      next,
      prev,

      play,
      pause,
      togglePlay,
      seek,

      haptic,
      toggleLike,
      toggleFollowArtist,
      supportArtist,

      preloadSong,
      preloadAheadSongs,

      fetchMoreFeedSongs,
      ensureRealtimeFeedSync,
    }),
    [
      queue,
      currentSong,
      currentSongId,
      currentIndex,
      activeFeedIndex,
      isPlaying,
      timing,
      buffering,
      interactions,
      networkStatus,
      hasMoreFeed,
      setQueue,
      setCurrentIndex,
      setActiveFeedIndex,
      next,
      prev,
      play,
      pause,
      togglePlay,
      seek,
      haptic,
      toggleLike,
      toggleFollowArtist,
      supportArtist,
      preloadSong,
      preloadAheadSongs,
      fetchMoreFeedSongs,
      ensureRealtimeFeedSync,
    ],
  );

  return api;
}

export type PlayerHook = ReturnType<typeof usePlayer>;
