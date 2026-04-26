/**
 * Zero-Latency UI Strategy
 * Skeleton loading, optimistic updates, no blocking API calls
 */

export interface SkeletonConfig {
  type: "text" | "image" | "card" | "list";
  count?: number;
  className?: string;
}

/**
 * Generate skeleton component props
 */
export function getSkeletonProps(config: SkeletonConfig): Record<string, unknown> {
  return {
    isLoading: true,
    skeleton: true,
    ...config,
  };
}

/**
 * Optimistic update pattern
 * Update UI immediately, rollback if API fails
 */
export async function optimisticUpdate<T>(
  currentValue: T,
  updateFn: () => Promise<T>,
  rollbackFn: (value: T) => void
): Promise<T> {
  try {
    const newValue = await updateFn();
    return newValue;
  } catch (error) {
    console.error("[OptimisticUpdate] API failed, rolling back:", error);
    rollbackFn(currentValue);
    throw error;
  }
}

/**
 * Non-blocking API call wrapper
 * Returns immediately with loading state, updates when complete
 */
export function nonBlockingCall<T>(
  fn: () => Promise<T>,
  onUpdate: (result: T | null, loading: boolean, error: Error | null) => void
): void {
  // Call immediately in background
  fn()
    .then((result) => {
      onUpdate(result, false, null);
    })
    .catch((error) => {
      onUpdate(null, false, error as Error);
    });
}

/**
 * Parallel data fetching for multiple resources
 */
export async function fetchParallel<T>(
  fetchers: Array<() => Promise<T>>
): Promise<T[]> {
  return Promise.all(fetchers.map((fn) => fn()));
}

/**
 * Sequential data fetching with dependency chain
 */
export async function fetchSequential<T>(
  fetchers: Array<(prev?: T) => Promise<T>>
): Promise<T[]> {
  const results: T[] = [];
  for (const fetcher of fetchers) {
    const result = await fetcher(results[results.length - 1]);
    results.push(result);
  }
  return results;
}

/**
 * Prefetch data for next page/view
 */
export function prefetchData<T>(fn: () => Promise<T>): void {
  // Fire and forget - cache the result
  fn().catch((error) => {
    console.error("[Prefetch] Failed to prefetch:", error);
  });
}

/**
 * Debounce function for performance
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

/**
 * Throttle function for performance
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}
