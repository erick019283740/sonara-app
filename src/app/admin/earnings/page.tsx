"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { MetricCard } from "@/components/admin/metric-card";
import {
  type EarningsLivePayload,
  useAdminLive,
} from "@/components/admin/use-admin-live";

export const dynamic = 'force-dynamic';

function euro(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("de-DE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function statusBadgeClass(status: "pending" | "completed" | "failed") {
  if (status === "completed") {
    return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30";
  }
  if (status === "failed") {
    return "bg-red-500/15 text-red-300 ring-1 ring-red-500/30";
  }
  return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30";
}

function riskBadgeClass(riskScore: number) {
  if (riskScore >= 80) {
    return "bg-red-500/15 text-red-300 ring-1 ring-red-500/30";
  }
  if (riskScore >= 45) {
    return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30";
  }
  return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30";
}

function asEarningsSnapshot(value: unknown): EarningsLivePayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<EarningsLivePayload>;
  if (!v.summary || !Array.isArray(v.topArtists) || !Array.isArray(v.payouts)) {
    return null;
  }
  return v as EarningsLivePayload;
}

export default function AdminEarningsPage() {
  const { snapshot, status, error, reconnect, lastMessageAt } = useAdminLive({
    channel: "earnings",
    intervalMs: 3000,
    autoStart: true,
  });

  const earnings = asEarningsSnapshot(snapshot.earnings);

  const summary = earnings?.summary ?? {
    dailyRevenue: 0,
    monthlyRevenue: 0,
    dailyPlatformFee: 0,
    monthlyPlatformFee: 0,
  };

  const topArtists = (earnings?.topArtists ?? []).slice(0, 12);

  const payouts = (earnings?.payouts ?? []).slice(0, 100);

  const artistChartData = topArtists.map((a) => ({
    id: a.artistId,
    label: a.stageName,
    value: a.totalEarnings,
  }));

  const totalTopArtistsRevenue = topArtists.reduce(
    (sum, a) => sum + a.totalEarnings,
    0,
  );

  const suspiciousPayouts = payouts.filter(
    (p) => p.suspicious || p.riskScore >= 45,
  ).length;

  const failedPayouts = payouts.filter((p) => p.status === "failed").length;

  return (
    <AdminShell
      title="Earnings Dashboard"
      subtitle="Live revenue monitoring, top earning artists, and payout operations"
      actions={
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
              status === "connected"
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                : status === "error"
                  ? "bg-red-500/15 text-red-300 ring-1 ring-red-500/30"
                  : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
            ].join(" ")}
          >
            {status}
          </span>
          <button
            type="button"
            onClick={reconnect}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10"
          >
            Reconnect
          </button>
        </div>
      }
    >
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Daily Revenue"
          value={euro(summary.dailyRevenue)}
          subtitle="Total gross revenue in last 24h"
          tone="success"
        />
        <MetricCard
          title="Monthly Revenue"
          value={euro(summary.monthlyRevenue)}
          subtitle="Total gross revenue in last 30d"
          tone="info"
        />
        <MetricCard
          title="Daily Platform Fee"
          value={euro(summary.dailyPlatformFee)}
          subtitle="Platform share in last 24h"
          tone="default"
        />
        <MetricCard
          title="Monthly Platform Fee"
          value={euro(summary.monthlyPlatformFee)}
          subtitle="Platform share in last 30d"
          tone="default"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          title="Top Artist Pool"
          value={euro(totalTopArtistsRevenue)}
          subtitle="Combined earnings of current top artists"
          tone="info"
        />
        <MetricCard
          title="Suspicious Payouts"
          value={suspiciousPayouts}
          subtitle="Flagged by risk score or suspicious marker"
          tone={suspiciousPayouts > 0 ? "warning" : "success"}
        />
        <MetricCard
          title="Failed Payouts"
          value={failedPayouts}
          subtitle="Requires operational follow-up"
          tone={failedPayouts > 0 ? "danger" : "success"}
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Top Earning Artists
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Real-time ranking by total artist earnings
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-300">
            {topArtists.length} artists
          </span>
        </div>

        <BarChart
          data={artistChartData}
          height={340}
          showValues
          formatValue={(v) => euro(v)}
          emptyMessage="No artist earnings yet."
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {topArtists.slice(0, 6).map((artist) => (
            <article
              key={artist.artistId}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <h3 className="truncate text-sm font-medium text-white">
                {artist.stageName}
              </h3>
              <p className="mt-1 text-xs text-zinc-400">
                Artist ID: {artist.artistId}
              </p>
              <div className="mt-3 space-y-1 text-xs">
                <p className="flex items-center justify-between">
                  <span className="text-zinc-400">Total</span>
                  <span className="font-medium text-zinc-100">
                    {euro(artist.totalEarnings)}
                  </span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-zinc-400">This month</span>
                  <span className="font-medium text-zinc-100">
                    {euro(artist.thisMonthEarnings)}
                  </span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-zinc-400">Platform fee</span>
                  <span className="font-medium text-zinc-100">
                    {euro(artist.platformFee)}
                  </span>
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Payout History</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Latest payout operations with risk indicators
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-300">
            {payouts.length} entries
          </span>
        </div>

        {payouts.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-sm text-zinc-400">
            No payout records available.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-zinc-400">
                  <th className="px-3 py-3 font-medium">Payout</th>
                  <th className="px-3 py-3 font-medium">Artist</th>
                  <th className="px-3 py-3 font-medium">Amount</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Risk</th>
                  <th className="px-3 py-3 font-medium">Stream</th>
                  <th className="px-3 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr
                    key={payout.id}
                    className="border-b border-white/5 text-sm text-zinc-200 hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="font-mono text-xs text-zinc-300">
                          {payout.id}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-white">
                          {payout.stageName}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {payout.artistId}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-medium text-white">
                      {euro(payout.amount)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                          payout.status,
                        )}`}
                      >
                        {payout.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeClass(
                            payout.riskScore,
                          )}`}
                        >
                          {compactNumber(payout.riskScore)}
                        </span>
                        {payout.suspicious ? (
                          <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-300 ring-1 ring-red-500/30">
                            suspicious
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs text-zinc-400">
                        {payout.streamId ?? "-"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-zinc-300">
                      {new Date(payout.payoutDate).toLocaleString("de-DE", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-400">
        <span>
          Last update:{" "}
          {lastMessageAt
            ? new Date(lastMessageAt).toLocaleTimeString("de-DE")
            : "waiting..."}
        </span>
        <span>
          Snapshot:{" "}
          {earnings?.generatedAt
            ? new Date(earnings.generatedAt).toLocaleTimeString("de-DE")
            : "-"}
        </span>
      </footer>
    </AdminShell>
  );
}
