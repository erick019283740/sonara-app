"use client";

import Link from "next/link";
import { useState } from "react";
import { useSignUp } from "@/lib/auth/hooks";
import { isValidEmail, isValidPassword, isValidUsername } from "@/lib/auth/utils";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"listener" | "artist">("listener");
  const [stageName, setStageName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { signUp, loading, error } = useSignUp();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Validate username
    if (!username.trim()) {
      setValidationError("Please enter a username");
      return;
    }

    if (!isValidUsername(username)) {
      setValidationError("Username must be 3-20 characters (letters, numbers, - and _)");
      return;
    }

    // Validate email
    if (!email.trim()) {
      setValidationError("Please enter your email");
      return;
    }

    if (!isValidEmail(email)) {
      setValidationError("Please enter a valid email address");
      return;
    }

    // Validate password
    if (!password) {
      setValidationError("Please enter a password");
      return;
    }

    if (!isValidPassword(password)) {
      setValidationError("Password must be at least 6 characters");
      return;
    }

    // Artist: validate stage name
    if (role === "artist" && !stageName.trim()) {
      setValidationError("Please enter a stage name");
      return;
    }

    await signUp(email, password, username, {
      role,
      stageName: stageName || username,
    });
  };

  const displayError = validationError || error?.message;

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-2xl border border-white/10 bg-white/5 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Join SONARA</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Create an account to start {role === "artist" ? "sharing your music" : "discovering music"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Username Field */}
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-zinc-300">
            Username
          </label>
          <input
            id="username"
            type="text"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
            placeholder="yourname"
          />
          <p className="mt-1 text-xs text-zinc-500">3-20 characters</p>
        </div>

        {/* Email Field */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
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
          <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
            placeholder="••••••••"
          />
          <p className="mt-1 text-xs text-zinc-500">At least 6 characters</p>
        </div>

        {/* Role Selection */}
        <fieldset className="space-y-3 border-t border-white/10 pt-4">
          <legend className="text-sm font-medium text-zinc-300">What brings you here?</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-3 rounded-lg border border-white/10 p-3 cursor-pointer hover:bg-white/5 transition"
              style={{
                borderColor: role === "listener" ? "rgb(139, 92, 246)" : undefined,
                backgroundColor: role === "listener" ? "rgba(139, 92, 246, 0.1)" : undefined,
              }}>
              <input
                type="radio"
                name="role"
                value="listener"
                checked={role === "listener"}
                onChange={() => setRole("listener")}
                disabled={loading}
                className="cursor-pointer"
              />
              <div>
                <p className="text-sm font-medium text-white">Listener</p>
                <p className="text-xs text-zinc-400">Discover and support artists</p>
              </div>
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-white/10 p-3 cursor-pointer hover:bg-white/5 transition"
              style={{
                borderColor: role === "artist" ? "rgb(139, 92, 246)" : undefined,
                backgroundColor: role === "artist" ? "rgba(139, 92, 246, 0.1)" : undefined,
              }}>
              <input
                type="radio"
                name="role"
                value="artist"
                checked={role === "artist"}
                onChange={() => setRole("artist")}
                disabled={loading}
                className="cursor-pointer"
              />
              <div>
                <p className="text-sm font-medium text-white">Artist</p>
                <p className="text-xs text-zinc-400">Share your music and earn</p>
              </div>
            </label>
          </div>
        </fieldset>

        {/* Stage Name (Artists Only) */}
        {role === "artist" && (
          <div>
            <label htmlFor="stageName" className="block text-sm font-medium text-zinc-300">
              Stage Name
            </label>
            <input
              id="stageName"
              type="text"
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              disabled={loading}
              className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
              placeholder="Your artist name"
            />
          </div>
        )}

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
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>

      {/* Footer */}
      <div className="text-center text-sm">
        <p className="text-zinc-400">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-violet-400 hover:text-violet-300"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
