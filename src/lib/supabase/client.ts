import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // During build time, return placeholder to avoid env var errors
  if (typeof window === "undefined") {
    return createBrowserClient("https://placeholder.supabase.co", "placeholder-key");
  }
  // Client-side: validate and use real env vars with clear error messages
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!url || url.trim().length === 0) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set or empty. Please set this environment variable in your deployment settings."
    );
  }
  if (!key || key.trim().length === 0) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set or empty. Please set this environment variable in your deployment settings."
    );
  }
  
  return createBrowserClient(url, key);
}
