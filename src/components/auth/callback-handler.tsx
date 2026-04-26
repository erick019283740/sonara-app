"use client";

/**
 * Auth Callback Handler
 * 
 * Processes the email confirmation token from Supabase
 * Called when user clicks confirmation link in email
 */

import { createClient } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export function AuthCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize Supabase client only on client side
  const supabase = useMemo(() => {
    if (typeof window !== 'undefined') {
      return createClient();
    }
    return null;
  }, []);

  useEffect(() => {
    if (!supabase) return;

    async function handleCallback() {
      try {
        // Get the code from the URL
        const code = searchParams.get("code");

        if (!code) {
          setError("No verification code found");
          setLoading(false);
          return;
        }

        // Exchange the code for a session
        const { error: err } = await supabase!.auth.exchangeCodeForSession(code);

        if (err) {
          setError(err.message || "Failed to verify email");
          setLoading(false);
          return;
        }

        // Success - redirect to home
        setLoading(false);
        router.push("/");
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An error occurred during verification"
        );
        setLoading(false);
      }
    }

    handleCallback();
  }, [searchParams, supabase, router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-sm text-zinc-400">Verifying email...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-8">
        <p className="text-sm text-red-400">Error: {error}</p>
        <p className="mt-4 text-xs text-zinc-400">
          Please try signing up again or contact support.
        </p>
      </div>
    );
  }

  return null;
}
