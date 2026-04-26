"use client";

import { useUser } from "@/contexts/user-context";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function ProfilePage() {
  const { user, profile, loading, refreshProfile } = useUser();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading profile…</p>;
  }

  if (!user || !profile) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-zinc-300">You are not signed in.</p>
        <Link href="/login" className="mt-4 inline-block text-violet-300 hover:underline">
          Log in
        </Link>
      </div>
    );
  }

  const goPremium = async () => {
    setBusy("premium");
    await supabase
      .from("profiles")
      .update({ subscription_status: "premium" })
      .eq("id", user.id);
    await refreshProfile();
    setBusy(null);
  };

  const becomeArtist = async () => {
    setBusy("artist");
    const { data: existing } = await supabase
      .from("artists")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) {
      await supabase.from("artists").insert({
        user_id: user.id,
        stage_name: profile.username,
        bio: "",
      });
    }
    await supabase.from("profiles").update({ role: "artist" }).eq("id", user.id);
    await refreshProfile();
    setBusy(null);
  };

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Profile</h1>
        <p className="text-sm text-zinc-400">@{profile.username}</p>
      </div>
      <dl className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Email</dt>
          <dd className="text-right text-zinc-200">{user.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Role</dt>
          <dd className="text-right capitalize text-zinc-200">{profile.role}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Plan</dt>
          <dd className="text-right text-zinc-200">
            {profile.subscription_status === "premium" ? "Premium (€4.99/mo)" : "Free (with ads)"}
          </dd>
        </div>
      </dl>

      {profile.subscription_status === "free" && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-950/30 p-6">
          <h2 className="font-medium text-white">SONARA Premium</h2>
          <p className="mt-1 text-sm text-zinc-400">
            €4.99/month — removes banner and fullscreen promotions (demo: one-click upgrade).
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void goPremium()}
            className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
          >
            {busy === "premium" ? "Updating…" : "Upgrade now"}
          </button>
        </div>
      )}

      {profile.role === "listener" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="font-medium text-white">Start releasing music</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Switch to an artist account to upload tracks and open your dashboard.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void becomeArtist()}
            className="mt-4 rounded-full border border-white/20 px-5 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50"
          >
            {busy === "artist" ? "Working…" : "Become an artist"}
          </button>
        </div>
      )}

      {profile.role === "artist" && (
        <div className="flex flex-wrap gap-3">
          <Link
            href="/upload"
            className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium text-white"
          >
            Upload
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-white/20 px-5 py-2 text-sm text-white hover:bg-white/5"
          >
            Dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
