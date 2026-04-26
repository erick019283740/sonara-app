"use client";

import { useUser } from "@/contexts/user-context";
import { createClient } from "@/lib/supabase/client";
import type { Artist } from "@/types/database";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export const dynamic = 'force-dynamic';

type DonationRow = {
  id: string;
  amount: number;
  created_at: string;
  user: { username: string | null } | null;
};

type EarningsRow = {
  id: string;
  amount: number;
  source: "stream" | "donation";
  created_at: string;
};

export default function ArtistDashboard() {
  const { user, profile, loading } = useUser();

  const [artistData, setArtistData] = useState<Artist | null>(null);
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [earnings, setEarnings] = useState<EarningsRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize Supabase client only on client side
  const supabase = useMemo(() => {
    if (typeof window !== 'undefined') {
      return createClient();
    }
    return null;
  }, []);

  const loadArtistData = useCallback(async () => {
    if (!user || !supabase) return;

    setLoadingData(true);
    setError(null);

    try {
      const { data: artist, error: artistError } = await supabase
        .from("artists")
        .select(
          "id, user_id, stage_name, bio, follower_count, total_earnings, created_at",
        )
        .eq("user_id", user.id)
        .maybeSingle<Artist>();

      if (artistError) throw artistError;
      if (!artist) {
        setArtistData(null);
        setDonations([]);
        setEarnings([]);
        setError("Artist profile not found");
        return;
      }

      setArtistData(artist);

      const { data: donationsList, error: donationsError } = await supabase
        .from("donations")
        .select(
          `
            id,
            amount,
            created_at,
            user:user_id(username)
          `,
        )
        .eq("artist_id", artist.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (donationsError) throw donationsError;

      const parsedDonations: DonationRow[] = ((donationsList ?? []) as unknown[]).map(
        (row: unknown) => {
          const r = row as {
            id?: string | number;
            amount?: number;
            created_at?: string;
            user?: { username?: string | null } | { username?: string | null }[] | null;
          };

          return {
            id: String(r.id ?? ""),
            amount: Number(r.amount ?? 0),
            created_at: String(r.created_at ?? new Date().toISOString()),
            user: r.user ? { username: (Array.isArray(r.user) ? r.user[0]?.username : r.user.username) ?? null } : null,
          };
        },
      );

      setDonations(parsedDonations);

      const { data: earningsList, error: earningsError } = await supabase
        .from("earnings")
        .select("id, amount, source, created_at")
        .eq("artist_id", artist.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (earningsError) throw earningsError;

      const parsedEarnings: EarningsRow[] = ((earningsList ?? []) as unknown[])
        .map((row: unknown) => {
          const r = row as {
            id?: string | number;
            amount?: number;
            source?: string;
            created_at?: string;
          };

          const source: EarningsRow["source"] =
            r.source === "donation" ? "donation" : "stream";

          return {
            id: String(r.id ?? ""),
            amount: Number(r.amount ?? 0),
            source,
            created_at: String(r.created_at ?? new Date().toISOString()),
          };
        })
        .filter((row) => row.id.length > 0);

      setEarnings(parsedEarnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoadingData(false);
    }
  }, [supabase, user]);

  useEffect(() => {
    if (loading || !user || profile?.role !== "artist") return;
    queueMicrotask(() => {
      void loadArtistData();
    });
  }, [loading, user, profile, loadArtistData]);

  if (loading) {
    return <p className="text-sm text-zinc-400">Loading...</p>;
  }

  if (!user || profile?.role !== "artist") {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-8">
        <p className="text-sm text-zinc-200">
          This dashboard is only available to artists.
        </p>
        <Link
          href="/profile"
          className="mt-4 inline-block text-violet-300 hover:underline"
        >
          Switch to artist account
        </Link>
      </div>
    );
  }

  const totalEarnings = Number(artistData?.total_earnings ?? 0);

  const donationEarnings = earnings
    .filter((entry) => entry.source === "donation")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const streamEarnings = earnings
    .filter((entry) => entry.source === "stream")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const thisMonth = new Date().toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const now = new Date();
  const thisMonthEarnings = earnings
    .filter((entry) => {
      const d = new Date(entry.created_at);
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Artist Dashboard</h1>
        <p className="mt-1 text-zinc-400">
          {artistData?.stage_name || "Your"} earnings and supporter insights
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-violet-500/20 bg-white/5 p-6">
          <p className="text-xs font-medium text-zinc-400">Total Earnings</p>
          <p className="mt-2 text-2xl font-bold text-white">
            €{totalEarnings.toFixed(2)}
          </p>
        </div>

        <div className="rounded-lg border border-violet-500/20 bg-white/5 p-6">
          <p className="text-xs font-medium text-zinc-400">This Month</p>
          <p className="mt-2 text-2xl font-bold text-white">
            €{thisMonthEarnings.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{thisMonth}</p>
        </div>

        <div className="rounded-lg border border-violet-500/20 bg-white/5 p-6">
          <p className="text-xs font-medium text-zinc-400">From Donations</p>
          <p className="mt-2 text-2xl font-bold text-white">
            €{donationEarnings.toFixed(2)}
          </p>
        </div>

        <div className="rounded-lg border border-violet-500/20 bg-white/5 p-6">
          <p className="text-xs font-medium text-zinc-400">From Streams</p>
          <p className="mt-2 text-2xl font-bold text-white">
            €{streamEarnings.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <h2 className="text-xl font-semibold text-white">Recent Supporters</h2>

        {loadingData ? (
          <p className="mt-4 text-sm text-zinc-500">Loading...</p>
        ) : donations.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No donations yet. Share your music and invite fans to support you!
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="border-b border-white/10 text-xs font-semibold text-zinc-400">
                <tr>
                  <th className="py-3 pr-4">Supporter</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((donation) => (
                  <tr
                    key={donation.id}
                    className="border-b border-white/5 hover:bg-white/[0.03]"
                  >
                    <td className="py-3 pr-4 font-medium">
                      {donation.user?.username ? (
                        donation.user.username
                      ) : (
                        <span className="text-zinc-500">Anonymous</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-white">
                      €{donation.amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {new Date(donation.created_at).toLocaleDateString(
                        "de-DE",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <h2 className="text-xl font-semibold text-white">Revenue Breakdown</h2>

        <div className="mt-6 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-300">
                Donations (90% artist share)
              </p>
              <p className="text-sm font-semibold text-white">
                €{donationEarnings.toFixed(2)}
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-violet-600 to-violet-500"
                style={{
                  width: `${totalEarnings > 0 ? (donationEarnings / totalEarnings) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-300">
                Streams (60% artist share)
              </p>
              <p className="text-sm font-semibold text-white">
                €{streamEarnings.toFixed(2)}
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-blue-500"
                style={{
                  width: `${totalEarnings > 0 ? (streamEarnings / totalEarnings) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
