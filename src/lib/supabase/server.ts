import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  
  // During build time, return placeholder to avoid env var errors
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  // Check if we're in build time (no valid env vars)
  const isBuildTime = !url || !key || url.trim().length === 0 || key.trim().length === 0;
  
  if (isBuildTime) {
    return createServerClient("https://placeholder.supabase.co", "placeholder-key", {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op during build
        },
      },
    });
  }

  // Runtime: validate env vars are properly set
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

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* ignore when called from Server Component */
        }
      },
    },
  });
}
