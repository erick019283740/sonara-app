/**
 * Production Guard - Hard Block for Missing Infrastructure
 * 
 * This function must be called at application startup in production.
 * It will throw an error if critical infrastructure is missing,
 * preventing the application from starting in an unsafe state.
 */

export function assertProductionReady(): void {
  if (process.env.NODE_ENV === "production") {
    const required = [
      "REDIS_URL",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];

    const missing = required.filter((k) => !process.env[k]);

    if (missing.length > 0) {
      throw new Error(
        `❌ PRODUCTION BLOCKED: Missing required environment variables: ${missing.join(", ")}\n` +
        `Set these variables before deploying to production.\n` +
        `Without these, the system cannot operate safely.`
      );
    }

    // Validate Redis URL format
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl?.startsWith("redis://") && !redisUrl?.startsWith("rediss://")) {
      throw new Error(
        `❌ PRODUCTION BLOCKED: REDIS_URL must start with redis:// or rediss://\n` +
        `Current value: ${redisUrl}`
      );
    }

    // Validate Supabase URL format
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl?.startsWith("https://")) {
      throw new Error(
        `❌ PRODUCTION BLOCKED: SUPABASE_URL must start with https://\n` +
        `Current value: ${supabaseUrl}`
      );
    }

    console.log("✅ Production guard passed - all required infrastructure present");
  }
}

/**
 * Development mode check - allows running without Redis
 */
export function assertDevelopmentReady(): void {
  if (process.env.NODE_ENV !== "production") {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.warn("⚠️ Development mode: REDIS_URL not set - rate limiting and queue persistence disabled");
      console.warn("⚠️ Set REDIS_URL for full functionality");
    }
  }
}
