"use client";

/**
 * SONARA Auth Hooks
 * 
 * Convenient hooks for authentication operations
 */

import { createClient } from "@/lib/supabase/client";
import { parseAuthError, type AuthErrorResult } from "@/lib/auth/utils";
import { useRouter } from "next/navigation";
import { useCallback, useState, useMemo } from "react";

/**
 * Hook for signing in with email and password
 */
export function useSignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthErrorResult | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const signIn = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      setError(null);

      try {
        const { error: err } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (err) {
          const parsed = parseAuthError(err);
          setError(parsed);
          return false;
        }

        router.push("/");
        router.refresh();
        return true;
      } catch (err) {
        const parsed = parseAuthError(err instanceof Error ? err : null);
        setError(parsed);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [supabase, router]
  );

  return { signIn, loading, error };
}

/**
 * Hook for signing up with email and password
 */
export function useSignUp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthErrorResult | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      username: string,
      options?: {
        role?: "listener" | "artist";
        stageName?: string;
      }
    ) => {
      setLoading(true);
      setError(null);

      try {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              username,
              role: options?.role || "listener",
              stage_name: options?.stageName || username,
            },
          },
        });

        if (err) {
          const parsed = parseAuthError(err);
          setError(parsed);
          return false;
        }

        // Auto-redirect if email confirmation is disabled (optional)
        router.push("/");
        router.refresh();
        return true;
      } catch (err) {
        const parsed = parseAuthError(err instanceof Error ? err : null);
        setError(parsed);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [supabase, router]
  );

  return { signUp, loading, error };
}

/**
 * Hook for signing out
 */
export function useSignOut() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthErrorResult | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { error: err } = await supabase.auth.signOut();

      if (err) {
        const parsed = parseAuthError(err);
        setError(parsed);
        return false;
      }

      router.push("/");
      router.refresh();
      return true;
    } catch (err) {
      const parsed = parseAuthError(err instanceof Error ? err : null);
      setError(parsed);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  return { signOut, loading, error };
}
