/**
 * Performance Monitor
 * Tracks and reports performance metrics
 */

interface PerformanceMetrics {
  fcp: number; // First Contentful Paint
  lcp: number; // Largest Contentful Paint
  fid: number; // First Input Delay
  cls: number; // Cumulative Layout Shift
  ttfb: number; // Time to First Byte
}

class PerformanceMonitor {
  private metrics: Partial<PerformanceMetrics> = {};
  private observers: PerformanceObserver[] = [];

  /**
   * Start monitoring
   */
  startMonitoring(): void {
    if (typeof window === "undefined" || !window.performance) return;

    // FCP
    this.observeEntry("paint", (entry) => {
      if (entry.name === "first-contentful-paint") {
        this.metrics.fcp = entry.startTime;
      }
    });

    // LCP
    this.observeEntry("largest-contentful-paint", (entry) => {
      this.metrics.lcp = entry.startTime;
    });

    // FID
    this.observeEntry("first-input", (entry) => {
      const fidEntry = entry as PerformanceEventTiming;
      this.metrics.fid = fidEntry.processingStart - fidEntry.startTime;
    });

    // CLS
    this.observeEntry("layout-shift", (entry) => {
      const clsEntry = entry as unknown as { hadRecentInput: boolean; value: number };
      if (!clsEntry.hadRecentInput) {
        this.metrics.cls = (this.metrics.cls || 0) + clsEntry.value;
      }
    });

    // TTFB
    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    if (navEntry) {
      this.metrics.ttfb = navEntry.responseStart - navEntry.requestStart;
    }
  }

  /**
   * Observe performance entries
   */
  private observeEntry(
    type: string,
    callback: (entry: PerformanceEntry) => void
  ): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          callback(entry);
        }
      });
      observer.observe({ type, buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.warn(`[PerformanceMonitor] ${type} not supported`);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): Partial<PerformanceMetrics> {
    return { ...this.metrics };
  }

  /**
   * Check if metrics are acceptable
   */
  isPerformanceAcceptable(): boolean {
    return (
      (this.metrics.fcp || 0) < 1800 &&
      (this.metrics.lcp || 0) < 2500 &&
      (this.metrics.fid || 0) < 100 &&
      (this.metrics.cls || 0) < 0.1 &&
      (this.metrics.ttfb || 0) < 600
    );
  }

  /**
   * Get performance score (0-100)
   */
  getPerformanceScore(): number {
    let score = 100;

    if (this.metrics.fcp && this.metrics.fcp > 1800) {
      score -= Math.min(30, (this.metrics.fcp - 1800) / 100);
    }
    if (this.metrics.lcp && this.metrics.lcp > 2500) {
      score -= Math.min(25, (this.metrics.lcp - 2500) / 100);
    }
    if (this.metrics.fid && this.metrics.fid > 100) {
      score -= Math.min(20, (this.metrics.fid - 100) / 10);
    }
    if (this.metrics.cls && this.metrics.cls > 0.1) {
      score -= Math.min(15, (this.metrics.cls - 0.1) * 100);
    }
    if (this.metrics.ttfb && this.metrics.ttfb > 600) {
      score -= Math.min(10, (this.metrics.ttfb - 600) / 100);
    }

    return Math.max(0, score);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];
  }
}

// Singleton instance
let performanceMonitor: PerformanceMonitor | null = null;

export function getPerformanceMonitor(): PerformanceMonitor {
  if (!performanceMonitor) {
    performanceMonitor = new PerformanceMonitor();
  }
  return performanceMonitor;
}
