"use client";

import type { Song } from "@/types/database";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STREAM_MIN_SECONDS = 30;
const PREVIEW_CAP_SECONDS = 60;
const STREAM_SESSION_KEY = "sonara_stream_session_id";

type PlayerContextValue = {
  current: Song | null;
  queue: Song[];
  queueIndex: number;
  isPlaying: boolean;
  expanded: boolean;
  currentTime: number;
  duration: number;
  canCountStream: boolean;
  previewRemaining: number;
  playSong: (song: Song, queue?: Song[]) => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (t: number) => void;
  skipNext: () => void;
  setExpanded: (v: boolean) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

const PlayerContext = createContext<PlayerContextValue | undefined>(undefined);

function readOrCreateSessionId(): string {
  if (typeof window === "undefined") {
    return crypto.randomUUID();
  }

  const existing = window.localStorage.getItem(STREAM_SESSION_KEY);
  if (existing) return existing;

  const next = crypto.randomUUID();
  window.localStorage.setItem(STREAM_SESSION_KEY, next);
  return next;
}

async function fetchAuthedUserId(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/user", { cache: "no-store" });
    if (!res.ok) return null;

    const payload = (await res.json()) as { user?: { id?: string } };
    return payload?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function reportStreamEvent(params: {
  userId: string;
  songId: string;
  artistId: string;
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  sessionId: string;
}) {
  const res = await fetch("/api/streams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`stream report failed (${res.status}): ${text}`);
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Song[]>([]);
  const indexRef = useRef(0);

  const [current, setCurrent] = useState<Song | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [sessionId] = useState<string>(() => readOrCreateSessionId());
  const [userId, setUserId] = useState("");
  const [effectivePlayedSeconds, setEffectivePlayedSeconds] = useState(0);

  const effectivePlayedRef = useRef(0);
  const lastWallClockRef = useRef<number | null>(null);
  const lastMediaTimeRef = useRef(0);
  const reportedSongRef = useRef<string | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const uid = await fetchAuthedUserId();
      if (!cancelled && uid) setUserId(uid);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const resetSongCounters = useCallback(() => {
    effectivePlayedRef.current = 0;
    lastWallClockRef.current = null;
    lastMediaTimeRef.current = 0;
    reportedSongRef.current = null;
    setEffectivePlayedSeconds(0);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const playSong = useCallback(
    (song: Song, nextQueue?: Song[]) => {
      const list = nextQueue?.length ? nextQueue : [song];
      const idx = Math.max(
        0,
        list.findIndex((s) => s.id === song.id),
      );

      queueRef.current = list;
      indexRef.current = idx;
      setQueue(list);
      setQueueIndex(idx);
      setCurrent(list[idx] ?? song);
      resetSongCounters();
      setIsPlaying(true);
    },
    [resetSongCounters],
  );

  const skipNext = useCallback(() => {
    const q = queueRef.current;
    const next = indexRef.current + 1;

    if (next < q.length) {
      indexRef.current = next;
      setQueueIndex(next);
      setCurrent(q[next]);
      resetSongCounters();
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  }, [resetSongCounters]);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const seek = useCallback(
    (t: number) => {
      const el = audioRef.current;
      if (!el) return;

      const clamped = Math.max(0, Math.min(duration || 0, t));
      el.currentTime = clamped;
      setCurrentTime(clamped);

      // Avoid counting seek jumps as listening time
      lastMediaTimeRef.current = clamped;
      lastWallClockRef.current = performance.now();
    },
    [duration],
  );

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;

    el.src = current.file_url;
    el.load();
  }, [current]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;

    if (isPlaying) {
      void el.play().catch(() => setIsPlaying(false));
      lastWallClockRef.current = performance.now();
      lastMediaTimeRef.current = el.currentTime || 0;
    } else {
      el.pause();
      lastWallClockRef.current = null;
    }
  }, [isPlaying, current]);

  useEffect(() => {
    if (!isPlaying || !current) {
      lastWallClockRef.current = null;
      return;
    }

    let rafId = 0;

    const loop = () => {
      const now = performance.now();
      const el = audioRef.current;

      if (el && lastWallClockRef.current != null) {
        const wallDelta = Math.max(0, (now - lastWallClockRef.current) / 1000);
        const mediaNow = el.currentTime || 0;
        const mediaDelta = Math.max(0, mediaNow - lastMediaTimeRef.current);

        // Count only reliable forward playback
        const increment = Math.min(wallDelta, mediaDelta + 0.05);
        if (increment > 0 && increment < 5) {
          effectivePlayedRef.current += increment;
          setEffectivePlayedSeconds(effectivePlayedRef.current);
        }

        lastMediaTimeRef.current = mediaNow;
      }

      lastWallClockRef.current = now;

      if (
        userId &&
        sessionId &&
        effectivePlayedRef.current >= STREAM_MIN_SECONDS &&
        reportedSongRef.current !== current.id
      ) {
        reportedSongRef.current = current.id;

        void reportStreamEvent({
          userId,
          songId: current.id,
          artistId: current.artist_id,
          durationPlayedSeconds: Math.floor(effectivePlayedRef.current),
          totalDurationSeconds: Math.floor(duration || current.duration || 0),
          sessionId,
        }).catch(() => {
          // allow retry if request fails
          reportedSongRef.current = null;
        });
      }

      if (effectivePlayedRef.current >= PREVIEW_CAP_SECONDS) {
        setIsPlaying(false);
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, current, userId, sessionId, duration]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTimeUpdate = () => setCurrentTime(el.currentTime || 0);
    const onDurationChange = () => {
      const d = el.duration;
      setDuration(Number.isFinite(d) ? d : 0);
    };
    const onEnded = () => skipNext();

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
    };
  }, [skipNext]);

  const canCountStream = effectivePlayedSeconds >= STREAM_MIN_SECONDS;
  const previewRemaining = Math.max(
    0,
    PREVIEW_CAP_SECONDS - Math.floor(effectivePlayedSeconds),
  );

  const value = useMemo<PlayerContextValue>(
    () => ({
      current,
      queue,
      queueIndex,
      isPlaying,
      expanded,
      currentTime,
      duration,
      canCountStream,
      previewRemaining,
      playSong,
      togglePlay,
      pause,
      seek,
      skipNext,
      setExpanded,
      audioRef,
    }),
    [
      current,
      queue,
      queueIndex,
      isPlaying,
      expanded,
      currentTime,
      duration,
      canCountStream,
      previewRemaining,
      playSong,
      togglePlay,
      pause,
      seek,
      skipNext,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      <audio ref={audioRef} preload="metadata" className="hidden" />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
