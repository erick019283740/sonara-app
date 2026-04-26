/**
 * Player Stability Guard
 * Single audio instance, preload, cancel promises, network resilience
 */

type AudioState = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerGuardState {
  currentSongId: string | null;
  audioState: AudioState;
  preloadQueue: string[];
  lastError: string | null;
  networkRetryCount: number;
}

const MAX_RETRY_COUNT = 3;
const PRELOAD_COUNT = 2;

class PlayerStabilityGuard {
  private audio: HTMLAudioElement | null = null;
  private state: PlayerGuardState = {
    currentSongId: null,
    audioState: "idle",
    preloadQueue: [],
    lastError: null,
    networkRetryCount: 0,
  };
  private currentPlayPromise: Promise<void> | null = null;
  private onStateChange: ((state: PlayerGuardState) => void) | null = null;

  /**
   * Initialize single audio instance
   */
  initialize(): HTMLAudioElement {
    if (this.audio) {
      return this.audio;
    }

    const audio = new Audio();
    audio.preload = "metadata";

    // Error handling
    audio.addEventListener("error", () => {
      this.handleError("audio_load_failed");
    });

    // Network stall detection
    audio.addEventListener("waiting", () => {
      this.state.audioState = "loading";
      this.notifyStateChange();
    });

    audio.addEventListener("playing", () => {
      this.state.audioState = "playing";
      this.state.networkRetryCount = 0;
      this.notifyStateChange();
    });

    audio.addEventListener("pause", () => {
      this.state.audioState = "paused";
      this.notifyStateChange();
    });

    audio.addEventListener("ended", () => {
      this.state.audioState = "idle";
      this.notifyStateChange();
    });

    this.audio = audio;
    return audio;
  }

  /**
   * Play song with stability guards
   */
  async playSong(songId: string, fileUrl: string): Promise<boolean> {
    const audio = this.initialize();

    // Cancel previous play promise
    if (this.currentPlayPromise) {
      this.currentPlayPromise = null;
    }

    // Prevent double play
    if (this.state.currentSongId === songId && this.state.audioState === "playing") {
      return true;
    }

    // Stop current playback
    audio.pause();
    audio.currentTime = 0;

    this.state.currentSongId = songId;
    this.state.audioState = "loading";
    this.notifyStateChange();

    try {
      // Set source and load
      audio.src = fileUrl;
      audio.load();

      // Wait for canplay
      await this.waitForCanPlay(audio);

      // Play with retry logic
      const playPromise = this.playWithRetry(audio);
      this.currentPlayPromise = playPromise;
      await playPromise;

      return true;
    } catch (error) {
      this.handleError("play_failed");
      return false;
    }
  }

  /**
   * Wait for audio to be ready
   */
  private waitForCanPlay(audio: HTMLAudioElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Audio load timeout"));
      }, 10000);

      const onCanPlay = () => {
        clearTimeout(timeout);
        audio.removeEventListener("canplay", onCanPlay);
        resolve();
      };

      const onError = () => {
        clearTimeout(timeout);
        audio.removeEventListener("error", onError);
        reject(new Error("Audio load error"));
      };

      audio.addEventListener("canplay", onCanPlay, { once: true });
      audio.addEventListener("error", onError, { once: true });
    });
  }

  /**
   * Play with retry on network failure
   */
  private async playWithRetry(audio: HTMLAudioElement): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRY_COUNT; attempt++) {
      try {
        await audio.play();
        return;
      } catch (error) {
        if (attempt < MAX_RETRY_COUNT - 1) {
          await this.delay(500 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Preload next tracks
   */
  preloadNextTracks(songs: Array<{ id: string; file_url: string }>, currentIndex: number): void {
    this.state.preloadQueue = [];

    for (let i = 1; i <= PRELOAD_COUNT; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex < songs.length) {
        const song = songs[nextIndex];
        this.preloadSingleTrack(song.id, song.file_url);
        this.state.preloadQueue.push(song.id);
      }
    }

    this.notifyStateChange();
  }

  /**
   * Preload single track in background
   */
  private preloadSingleTrack(songId: string, fileUrl: string): void {
    const preloadAudio = new Audio();
    preloadAudio.preload = "auto";
    preloadAudio.src = fileUrl;
    preloadAudio.load();

    // Store reference for quick swap
    (window as unknown as Record<string, HTMLAudioElement>)[`__preload_${songId}`] = preloadAudio;
  }

  /**
   * Get preloaded track
   */
  getPreloadedTrack(songId: string): HTMLAudioElement | null {
    return (window as unknown as Record<string, HTMLAudioElement>)[`__preload_${songId}`] || null;
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.audio) {
      this.audio.pause();
    }
  }

  /**
   * Stop and reset
   */
  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.src = "";
    }
    this.state.currentSongId = null;
    this.state.audioState = "idle";
    this.notifyStateChange();
  }

  /**
   * Handle error
   */
  private handleError(error: string): void {
    this.state.lastError = error;
    this.state.audioState = "error";
    this.state.networkRetryCount++;
    this.notifyStateChange();

    console.error("[PlayerStabilityGuard] Error:", error);
  }

  /**
   * Subscribe to state changes
   */
  onChange(callback: (state: PlayerGuardState) => void): () => void {
    this.onStateChange = callback;
    return () => {
      this.onStateChange = null;
    };
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange({ ...this.state });
    }
  }

  /**
   * Get current state
   */
  getState(): PlayerGuardState {
    return { ...this.state };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let playerGuard: PlayerStabilityGuard | null = null;

export function getPlayerGuard(): PlayerStabilityGuard {
  if (!playerGuard) {
    playerGuard = new PlayerStabilityGuard();
  }
  return playerGuard;
}
