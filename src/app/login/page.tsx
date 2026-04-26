"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSignIn } from "@/lib/auth/hooks";
import { isValidEmail } from "@/lib/auth/utils";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { signIn, loading, error } = useSignIn();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Validate inputs
    if (!email.trim()) {
      setValidationError("Please enter your email");
      return;
    }

    if (!isValidEmail(email)) {
      setValidationError("Please enter a valid email address");
      return;
    }

    if (!password) {
      setValidationError("Please enter your password");
      return;
    }

    await signIn(email, password);
  };

  const displayError = validationError || error?.message;

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-2xl border border-white/10 bg-white/5 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Sign in to your SONARA account
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email Field */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-zinc-300"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
            placeholder="your@email.com"
          />
        </div>

        {/* Password Field */}
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-zinc-300"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
            placeholder="••••••••"
          />
        </div>

        {/* Error Message */}
        {displayError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-400">{displayError}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-3 font-medium text-white transition-all hover:shadow-lg hover:shadow-violet-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      {/* Footer */}
      <div className="space-y-3 text-center text-sm">
        <p className="text-zinc-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-medium text-violet-400 hover:text-violet-300"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-zinc-500">Loading...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
