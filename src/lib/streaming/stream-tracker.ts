/**
 * SONARA Stream Tracking System
 * 
 * Rules:
 * - Stream counts only after 30 seconds of listening
 * - Maximum 10 streams per user per song per day
 */

export interface StreamSession {
  songId: string;
  userId: string;
  startTime: number;
  lastUpdateTime: number;
  counted: boolean;
}

export interface DailyStreamLimit {
  [key: string]: number; // songId -> count
}

const STREAM_MIN_DURATION = 30 * 1000; // 30 seconds in milliseconds
const MAX_STREAMS_PER_SONG_PER_DAY = 10;
const STORAGE_KEY_SESSION = "sonara:stream-session";
const STORAGE_KEY_DAILY = "sonara:daily-streams";
const STORAGE_KEY_DATE = "sonara:stream-date";

/**
 * Gets or creates a unique user ID from localStorage
 */
export function getUserId(): string {
  const key = "sonara:user-id";
  let userId = localStorage.getItem(key);

  if (!userId) {
    // Generate a unique user ID (simulate user fingerprinting)
    userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(key, userId);
  }

  return userId;
}

/**
 * Starts tracking a stream session
 */
export function startStreamSession(songId: string): void {
  const userId = getUserId();
  const session: StreamSession = {
    songId,
    userId,
    startTime: Date.now(),
    lastUpdateTime: Date.now(),
    counted: false,
  };

  localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
}

/**
 * Checks if 30+ seconds have been played
 */
export function checkStreamThreshold(): boolean {
  const sessionStr = localStorage.getItem(STORAGE_KEY_SESSION);
  if (!sessionStr) return false;

  const session: StreamSession = JSON.parse(sessionStr);
  const elapsed = Date.now() - session.startTime;

  return elapsed >= STREAM_MIN_DURATION;
}

/**
 * Checks if user has exceeded daily stream limit for this song
 */
export function checkDailyLimit(songId: string): boolean {
  const today = new Date().toDateString();
  const storedDate = localStorage.getItem(STORAGE_KEY_DATE);

  // Reset daily counter if it's a new day
  if (storedDate !== today) {
    localStorage.setItem(STORAGE_KEY_DATE, today);
    localStorage.setItem(STORAGE_KEY_DAILY, JSON.stringify({}));
  }

  const dailyStr = localStorage.getItem(STORAGE_KEY_DAILY);
  const daily: DailyStreamLimit = dailyStr ? JSON.parse(dailyStr) : {};

  const count = daily[songId] || 0;
  return count < MAX_STREAMS_PER_SONG_PER_DAY;
}

/**
 * Records a stream (only if conditions are met)
 */
export async function recordStream(songId: string): Promise<boolean> {
  const sessionStr = localStorage.getItem(STORAGE_KEY_SESSION);
  if (!sessionStr) return false;

  const session: StreamSession = JSON.parse(sessionStr);

  // Prevent double counting
  if (session.counted) return false;

  // Check minimum duration
  if (!checkStreamThreshold()) return false;

  // Check daily limit
  if (!checkDailyLimit(songId)) return false;

  // Update session as counted
  session.counted = true;
  localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));

  // Update daily counter
  const dailyStr = localStorage.getItem(STORAGE_KEY_DAILY);
  const daily: DailyStreamLimit = dailyStr ? JSON.parse(dailyStr) : {};

  daily[songId] = (daily[songId] || 0) + 1;
  localStorage.setItem(STORAGE_KEY_DAILY, JSON.stringify(daily));

  // Send stream to API
  try {
    const response = await fetch("/api/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songId,
        userId: session.userId,
        duration: Date.now() - session.startTime,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("Failed to record stream:", error);
    return false;
  }
}

/**
 * Ends the current stream session
 */
export function endStreamSession(): void {
  localStorage.removeItem(STORAGE_KEY_SESSION);
}

/**
 * Gets remaining streams for today for a specific song
 */
export function getRemainingStreams(songId: string): number {
  const today = new Date().toDateString();
  const storedDate = localStorage.getItem(STORAGE_KEY_DATE);

  if (storedDate !== today) {
    return MAX_STREAMS_PER_SONG_PER_DAY;
  }

  const dailyStr = localStorage.getItem(STORAGE_KEY_DAILY);
  const daily: DailyStreamLimit = dailyStr ? JSON.parse(dailyStr) : {};
  const count = daily[songId] || 0;

  return Math.max(0, MAX_STREAMS_PER_SONG_PER_DAY - count);
}

/**
 * Gets current session elapsed time in seconds
 */
export function getSessionElapsedSeconds(): number {
  const sessionStr = localStorage.getItem(STORAGE_KEY_SESSION);
  if (!sessionStr) return 0;

  const session: StreamSession = JSON.parse(sessionStr);
  return Math.floor((Date.now() - session.startTime) / 1000);
}
