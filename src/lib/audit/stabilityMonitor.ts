/**
 * Stability Monitor
 * Tracks errors, memory leaks, and crash events
 */

interface LoggedError {
  message: string;
  stack?: string;
  timestamp: number;
  type: "error" | "unhandled_rejection" | "network";
}

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

class StabilityMonitor {
  private errors: LoggedError[] = [];
  private memorySnapshots: MemoryInfo[] = [];
  private maxErrors = 100;

  /**
   * Start monitoring
   */
  startMonitoring(): void {
    if (typeof window === "undefined") return;

    // Global error handler
    window.addEventListener("error", this.handleError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);

    // Monitor memory every 30 seconds
    this.memoryInterval = setInterval(() => {
      this.captureMemorySnapshot();
    }, 30000);
  }

  private memoryInterval: NodeJS.Timeout | null = null;

  /**
   * Handle error
   */
  private handleError = (event: Event) => {
    const errorEvent = event as ErrorEvent;
    this.logError({
      message: errorEvent.message,
      stack: errorEvent.error?.stack,
      timestamp: Date.now(),
      type: "error",
    });
  };

  /**
   * Handle unhandled promise rejection
   */
  private handleUnhandledRejection = (event: Event) => {
    const promiseEvent = event as PromiseRejectionEvent;
    this.logError({
      message: String(promiseEvent.reason),
      timestamp: Date.now(),
      type: "unhandled_rejection",
    });
  };

  /**
   * Log error
   */
  private logError(error: LoggedError): void {
    this.errors.push(error);

    // Keep only last N errors
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    console.error("[StabilityMonitor]", error);
  }

  /**
   * Capture memory snapshot
   */
  private captureMemorySnapshot(): void {
    if (typeof performance === "undefined" || !(performance as unknown as Record<string, unknown>).memory) return;

    const memory = (performance as unknown as Record<string, MemoryInfo>).memory;
    this.memorySnapshots.push({
      ...memory,
    });

    // Keep only last 10 snapshots
    if (this.memorySnapshots.length > 10) {
      this.memorySnapshots.shift();
    }

    // Check for memory leak
    this.checkMemoryLeak();
  }

  /**
   * Check for memory leak
   */
  private checkMemoryLeak(): void {
    if (this.memorySnapshots.length < 5) return;

    const recent = this.memorySnapshots.slice(-5);
    const first = recent[0];
    const last = recent[recent.length - 1];

    const growth = last.usedJSHeapSize - first.usedJSHeapSize;
    const growthPercent = (growth / first.usedJSHeapSize) * 100;

    // If memory grew by more than 50% in 2 minutes
    if (growthPercent > 50) {
      console.warn(
        `[StabilityMonitor] Potential memory leak detected: ${growthPercent.toFixed(1)}% growth`
      );
    }
  }

  /**
   * Log network error
   */
  logNetworkError(message: string): void {
    this.logError({
      message,
      timestamp: Date.now(),
      type: "network",
    });
  }

  /**
   * Get error count
   */
  getErrorCount(): number {
    return this.errors.length;
  }

  /**
   * Get recent errors
   */
  getRecentErrors(count: number = 10): LoggedError[] {
    return this.errors.slice(-count);
  }

  /**
   * Get memory info
   */
  getMemoryInfo(): MemoryInfo | null {
    if (typeof performance === "undefined" || !(performance as unknown as Record<string, unknown>).memory) {
      return null;
    }
    return (performance as unknown as Record<string, MemoryInfo>).memory;
  }

  /**
   * Clear errors
   */
  clearErrors(): void {
    this.errors = [];
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = null;
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("error", this.handleError);
      window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    }
  }
}

// Singleton instance
let stabilityMonitor: StabilityMonitor | null = null;

export function getStabilityMonitor(): StabilityMonitor {
  if (!stabilityMonitor) {
    stabilityMonitor = new StabilityMonitor();
  }
  return stabilityMonitor;
}
