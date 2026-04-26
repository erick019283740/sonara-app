/**
 * Circuit Breaker Pattern
 * 
 * Prevents cascade failures when external systems are down.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: System is failing, requests are blocked
 * - HALF_OPEN: Testing if system has recovered
 */

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

interface CircuitBreakerConfig {
  failureThreshold: number; // Failures before opening
  recoveryTimeout: number; // ms to wait before half-open
  monitoringPeriod: number; // ms to consider for failures
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private config: CircuitBreakerConfig;
  private failureHistory: number[] = [];

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      recoveryTimeout: config?.recoveryTimeout ?? 60000, // 1 minute
      monitoringPeriod: config?.monitoringPeriod ?? 10000, // 10 seconds
    };
  }

  getState(): CircuitState {
    return this.state;
  }

  private recordFailure(): void {
    const now = Date.now();
    this.failureCount++;
    this.lastFailureTime = now;
    this.failureHistory.push(now);

    // Clean old failures outside monitoring period
    this.failureHistory = this.failureHistory.filter(
      (time) => now - time < this.config.monitoringPeriod
    );

    // Open circuit if threshold exceeded
    if (this.failureHistory.length >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      console.warn(
        `[CircuitBreaker] Circuit OPEN after ${this.failureCount} failures`
      );
    }
  }

  private recordSuccess(): void {
    this.successCount++;
    if (this.state === CircuitState.HALF_OPEN) {
      // If we get enough successes in half-open, close the circuit
      if (this.successCount >= 2) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.failureHistory = [];
        this.successCount = 0;
        console.log("[CircuitBreaker] Circuit CLOSED after recovery");
      }
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.config.recoveryTimeout) {
        // Try half-open state
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        console.log("[CircuitBreaker] Circuit HALF_OPEN - testing recovery");
      } else {
        throw new Error(
          "Circuit breaker is OPEN - system temporarily unavailable"
        );
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.successCount = 0;
    this.failureHistory = [];
    console.log("[CircuitBreaker] Circuit manually reset");
  }
}

// Pre-configured circuit breakers for different services
export const redisCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  recoveryTimeout: 30000,
  monitoringPeriod: 5000,
});

export const databaseCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeout: 60000,
  monitoringPeriod: 10000,
});

export const supabaseAuthCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  recoveryTimeout: 30000,
  monitoringPeriod: 5000,
});
