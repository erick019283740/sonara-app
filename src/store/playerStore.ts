"use client";

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Song } from "@/types/database";

export type NetworkStatus = "online" | "offline" | "slow";
export type BufferStatus = "idle" | "loading" | "buffering" | "ready" | "error";

export type InteractionState = {
  likedSongIds: Record<string, true>;
  followedArtistIds: Record<string, true>;
  supportedArtistIds: Record<string, true>;
  lastDoubleTapAt: number;
};

export type PlayerRuntimeState = {
  currentSongId: string | null;
  currentIndex: number;
  queue: Song[];
  queueVersion: number;

  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playbackRate: number;

  currentTime: number;
  duration: number;
  progress: number;

  activeFeedIndex: number;
  visibleSongIds: string[];

  bufferStatus: BufferStatus;
  networkStatus: NetworkStatus;
  retryCount: number;
  error: string | null;

  preloadMap: Record<string, true>;
  prefetchedSongIds: string[];

  lastInteractionAt: number;
  interactions: InteractionState;
};

export type PlayerActions = {
  setQueue: (songs: Song[], startIndex?: number) => void;
  setCurrentIndex: (index: number) => void;
  next: () => void;
  prev: () => void;

  setCurrentSongById: (songId: string) => void;
  setVisibleSongIds: (songIds: string[]) => void;
  setActiveFeedIndex: (index: number) => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;

  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;

  setTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setProgress: (progress: number) => void;

  setBufferStatus: (status: BufferStatus) => void;
  setNetworkStatus: (status: NetworkStatus) => void;
  setError: (message: string | null) => void;
  clearError: () => void;
  incrementRetry: () => void;
  resetRetry: () => void;

  markPreloaded: (songId: string) => void;
  markPrefetched: (songId: string) => void;
  resetPreloadState: () => void;

  markLiked: (songId: string, liked: boolean) => void;
  markFollowed: (artistId: string, followed: boolean) => void;
  markSupported: (artistId: string, supported: boolean) => void;
  markDoubleTap: () => void;

  resetPlaybackState: () => void;
  hydrateFromQueue: () => void;
};

export type PlayerState = PlayerRuntimeState & PlayerActions;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const now = () => Date.now();

const initialRuntime: PlayerRuntimeState = {
  currentSongId: null,
  currentIndex: 0,
  queue: [],
  queueVersion: 0,

  isPlaying: false,
  isMuted: false,
  volume: 1,
  playbackRate: 1,

  currentTime: 0,
  duration: 0,
  progress: 0,

  activeFeedIndex: 0,
  visibleSongIds: [],

  bufferStatus: "idle",
  networkStatus: "online",
  retryCount: 0,
  error: null,

  preloadMap: {},
  prefetchedSongIds: [],

  lastInteractionAt: 0,
  interactions: {
    likedSongIds: {},
    followedArtistIds: {},
    supportedArtistIds: {},
    lastDoubleTapAt: 0,
  },
};

export const playerStore = createStore<PlayerState>()(
  subscribeWithSelector((set, get) => ({
    ...initialRuntime,

    setQueue: (songs, startIndex = 0) => {
      const safeIndex = songs.length ? clamp(startIndex, 0, songs.length - 1) : 0;
      const current = songs[safeIndex] ?? null;

      set((state) => ({
        queue: songs,
        queueVersion: state.queueVersion + 1,
        currentIndex: safeIndex,
        currentSongId: current?.id ?? null,
        activeFeedIndex: safeIndex,
        currentTime: 0,
        duration: current?.duration ?? 0,
        progress: 0,
        bufferStatus: current ? "loading" : "idle",
        error: null,
        retryCount: 0,
        lastInteractionAt: now(),
      }));
    },

    setCurrentIndex: (index) => {
      const { queue } = get();
      if (!queue.length) return;

      const nextIndex = clamp(index, 0, queue.length - 1);
      const nextSong = queue[nextIndex];
      if (!nextSong) return;

      set(() => ({
        currentIndex: nextIndex,
        activeFeedIndex: nextIndex,
        currentSongId: nextSong.id,
        currentTime: 0,
        duration: nextSong.duration ?? 0,
        progress: 0,
        bufferStatus: "loading",
        error: null,
        retryCount: 0,
        lastInteractionAt: now(),
      }));
    },

    next: () => {
      const { queue, currentIndex } = get();
      if (!queue.length) return;
      const nextIndex = Math.min(queue.length - 1, currentIndex + 1);
      get().setCurrentIndex(nextIndex);
    },

    prev: () => {
      const { queue, currentIndex } = get();
      if (!queue.length) return;
      const prevIndex = Math.max(0, currentIndex - 1);
      get().setCurrentIndex(prevIndex);
    },

    setCurrentSongById: (songId) => {
      const { queue } = get();
      if (!queue.length) return;
      const index = queue.findIndex((s) => s.id === songId);
      if (index === -1) return;
      get().setCurrentIndex(index);
    },

    setVisibleSongIds: (songIds) =>
      set(() => ({
        visibleSongIds: songIds,
      })),

    setActiveFeedIndex: (index) =>
      set((state) => ({
        activeFeedIndex: Math.max(0, index),
        lastInteractionAt: now(),
        currentIndex: state.queue.length ? clamp(index, 0, state.queue.length - 1) : 0,
      })),

    play: () =>
      set(() => ({
        isPlaying: true,
        lastInteractionAt: now(),
      })),

    pause: () =>
      set(() => ({
        isPlaying: false,
        lastInteractionAt: now(),
      })),

    togglePlay: () =>
      set((state) => ({
        isPlaying: !state.isPlaying,
        lastInteractionAt: now(),
      })),

    setMuted: (muted) =>
      set(() => ({
        isMuted: muted,
      })),

    toggleMuted: () =>
      set((state) => ({
        isMuted: !state.isMuted,
      })),

    setVolume: (volume) =>
      set(() => ({
        volume: clamp(volume, 0, 1),
      })),

    setPlaybackRate: (rate) =>
      set(() => ({
        playbackRate: clamp(rate, 0.5, 2),
      })),

    setTime: (time) =>
      set((state) => {
        const safeTime = Math.max(0, time);
        const duration = Math.max(0, state.duration);
        const progress = duration > 0 ? clamp(safeTime / duration, 0, 1) : 0;
        return {
          currentTime: safeTime,
          progress,
        };
      }),

    setDuration: (duration) =>
      set((state) => {
        const safeDuration = Math.max(0, duration);
        const progress = safeDuration > 0 ? clamp(state.currentTime / safeDuration, 0, 1) : 0;
        return {
          duration: safeDuration,
          progress,
        };
      }),

    setProgress: (progress) =>
      set((state) => {
        const safeProgress = clamp(progress, 0, 1);
        const nextTime = state.duration > 0 ? state.duration * safeProgress : state.currentTime;
        return {
          progress: safeProgress,
          currentTime: nextTime,
        };
      }),

    setBufferStatus: (status) =>
      set(() => ({
        bufferStatus: status,
      })),

    setNetworkStatus: (status) =>
      set(() => ({
        networkStatus: status,
      })),

    setError: (message) =>
      set(() => ({
        error: message,
        bufferStatus: "error",
      })),

    clearError: () =>
      set(() => ({
        error: null,
        bufferStatus: "idle",
      })),

    incrementRetry: () =>
      set((state) => ({
        retryCount: state.retryCount + 1,
      })),

    resetRetry: () =>
      set(() => ({
        retryCount: 0,
      })),

    markPreloaded: (songId) =>
      set((state) => {
        if (!songId || state.preloadMap[songId]) return {};
        return {
          preloadMap: { ...state.preloadMap, [songId]: true as const },
        };
      }),

    markPrefetched: (songId) =>
      set((state) => {
        if (!songId || state.prefetchedSongIds.includes(songId)) return {};
        return {
          prefetchedSongIds: [...state.prefetchedSongIds, songId],
        };
      }),

    resetPreloadState: () =>
      set(() => ({
        preloadMap: {},
        prefetchedSongIds: [],
      })),

    markLiked: (songId, liked) =>
      set((state) => {
        if (!songId) return {};
        const next = { ...state.interactions.likedSongIds };
        if (liked) next[songId] = true;
        else delete next[songId];

        return {
          interactions: {
            ...state.interactions,
            likedSongIds: next,
          },
          lastInteractionAt: now(),
        };
      }),

    markFollowed: (artistId, followed) =>
      set((state) => {
        if (!artistId) return {};
        const next = { ...state.interactions.followedArtistIds };
        if (followed) next[artistId] = true;
        else delete next[artistId];

        return {
          interactions: {
            ...state.interactions,
            followedArtistIds: next,
          },
          lastInteractionAt: now(),
        };
      }),

    markSupported: (artistId, supported) =>
      set((state) => {
        if (!artistId) return {};
        const next = { ...state.interactions.supportedArtistIds };
        if (supported) next[artistId] = true;
        else delete next[artistId];

        return {
          interactions: {
            ...state.interactions,
            supportedArtistIds: next,
          },
          lastInteractionAt: now(),
        };
      }),

    markDoubleTap: () =>
      set((state) => ({
        interactions: {
          ...state.interactions,
          lastDoubleTapAt: now(),
        },
        lastInteractionAt: now(),
      })),

    resetPlaybackState: () =>
      set(() => ({
        ...initialRuntime,
        interactions: get().interactions,
      })),

    hydrateFromQueue: () => {
      const { queue, currentSongId } = get();
      if (!queue.length) {
        set(() => ({
          currentIndex: 0,
          currentSongId: null,
          activeFeedIndex: 0,
        }));
        return;
      }

      const index = currentSongId ? queue.findIndex((s) => s.id === currentSongId) : -1;
      const safeIndex = index >= 0 ? index : 0;
      const song = queue[safeIndex];

      set(() => ({
        currentIndex: safeIndex,
        activeFeedIndex: safeIndex,
        currentSongId: song?.id ?? null,
        duration: song?.duration ?? 0,
      }));
    },
  })),
);

export function usePlayerStore<T>(selector: (state: PlayerState) => T): T {
  return useStore(playerStore, selector);
}

export const playerSelectors = {
  queue: (s: PlayerState) => s.queue,
  queueVersion: (s: PlayerState) => s.queueVersion,
  currentSongId: (s: PlayerState) => s.currentSongId,
  currentSong: (s: PlayerState) => s.queue[s.currentIndex] ?? null,
  currentIndex: (s: PlayerState) => s.currentIndex,
  activeFeedIndex: (s: PlayerState) => s.activeFeedIndex,
  isPlaying: (s: PlayerState) => s.isPlaying,
  timing: (s: PlayerState) => ({
    currentTime: s.currentTime,
    duration: s.duration,
    progress: s.progress,
  }),
  audio: (s: PlayerState) => ({
    isMuted: s.isMuted,
    volume: s.volume,
    playbackRate: s.playbackRate,
  }),
  buffering: (s: PlayerState) => ({
    bufferStatus: s.bufferStatus,
    networkStatus: s.networkStatus,
    retryCount: s.retryCount,
    error: s.error,
  }),
  interactions: (s: PlayerState) => s.interactions,
  likedSongIds: (s: PlayerState) => s.interactions.likedSongIds,
  followedArtistIds: (s: PlayerState) => s.interactions.followedArtistIds,
  supportedArtistIds: (s: PlayerState) => s.interactions.supportedArtistIds,
  preloadState: (s: PlayerState) => ({
    preloadMap: s.preloadMap,
    prefetchedSongIds: s.prefetchedSongIds,
  }),
};

export function selectIsLiked(songId: string) {
  return (s: PlayerState) => Boolean(s.interactions.likedSongIds[songId]);
}

export function selectIsFollowed(artistId: string) {
  return (s: PlayerState) => Boolean(s.interactions.followedArtistIds[artistId]);
}

export function selectIsSupported(artistId: string) {
  return (s: PlayerState) => Boolean(s.interactions.supportedArtistIds[artistId]);
}

export function selectSongById(songId: string) {
  return (s: PlayerState) => s.queue.find((x) => x.id === songId) ?? null;
}
