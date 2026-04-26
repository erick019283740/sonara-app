"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { MetricCard } from "@/components/admin/metric-card";
import {
  useAdminLive,
  type TrendingLivePayload,
} from "@/components/admin/use-admin-live";
import { useMemo, useState } from "react";

type TrendingTab = "top" | "growth" | "spikes";

function formatNumber(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function severityToneByRisk(risk: number): "default" | "warning" | "danger" {
  if (risk >= 80) return "danger";
  if (risk >= 45) return "warning";
  return "default";
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
      {label}
    </div>
  );
}

function TrendingTable({
  rows,
}: {
  rows: Array<{
    songId: string;
    title: string;
    artistName: string;
    trendingScore: number;
    growthRate24h: number;
    plays24h: number;
    abuseRisk: number;
  }>;
}) {
  if (!rows.length) return <EmptyState label="No trending data yet." />;

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-zinc-900/60">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-zinc-400">
          <tr>
            <th className="px-4 py-3">Song</th>
            <th className="px-4 py-3">Artist</th>
            <th className="px-4 py-3">Trending Score</th>
            <th className="px-4 py-3">Growth 24h</th>
            <th className="px-4 py-3">Plays 24h</th>
            <th className="px-4 py-3">Abuse Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.songId} className="border-b border-white/5 last:border-b-0">
              <td className="px-4 py-3 text-white">{row.title}</td>
              <td className="px-4 py-3 text-zinc-300">{row.artistName}</td>
              <td className="px-4 py-3 text-violet-300">
                {formatNumber(row.trendingScore)}
              </td>
              <td
                className={`px-4 py-3 ${
                  row.growthRate24h >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatPercent(row.growthRate24h)}
              </td>
              <td className="px-4 py-3 text-zinc-300">
                {formatNumber(row.plays24h)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    row.abuseRisk >= 80
                      ? "bg-red-500/20 text-red-300"
                      : row.abuseRisk >= 45
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {row.abuseRisk.toFixed(1)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function normalizeData(
  payload: TrendingLivePayload | undefined,
): TrendingLivePayload {
  return (
    payload ?? {
      topTrending: [],
      fastestGrowing: [],
      viralSpikes: [],
      generatedAt: new Date().toISOString(),
    }
  );
}

export default function AdminTrendingPage() {
  const [tab, setTab] = useState<TrendingTab>("top");

  const live = useAdminLive({
    channel: "trending",
    intervalMs: 3000,
    autoStart: true,
  });

  const data = normalizeData(live.snapshot.trending);

  const activeRows = useMemo(() => {
    if (tab === "top") return data.topTrending;
    if (tab === "growth") return data.fastestGrowing;
    return data.viralSpikes;
  }, [data.fastestGrowing, data.topTrending, data.viralSpikes, tab]);

  const topScore = data.topTrending[0]?.trendingScore ?? 0;
  const topGrowth = data.fastestGrowing[0]?.growthRate24h ?? 0;
  const spikes = data.viralSpikes.length;

  const topChartData = useMemo(
    () =>
      data.topTrending.slice(0, 12).map((item) => ({
        id: item.songId,
        label: item.title,
        value: item.trendingScore,
      })),
    [data.topTrending],
  );

  const growthChartData = useMemo(
    () =>
      data.fastestGrowing.slice(0, 12).map((item) => ({
        id: item.songId,
        label: item.title,
        value: item.growthRate24h,
        color: item.growthRate24h >= 0 ? "#10b981" : "#ef4444",
      })),
    [data.fastestGrowing],
  );

  const spikeChartData = useMemo(
    () =>
      data.viralSpikes.slice(0, 12).map((item) => ({
        id: item.songId,
        label: item.title,
        value: item.plays24h,
      })),
    [data.viralSpikes],
  );

  return (
    <AdminShell
      title="Trending Monitor"
      subtitle="Live trending ranking, growth velocity, and viral spike detection"
      actions={
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              live.connected
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-amber-500/20 text-amber-300"
            }`}
          >
            {live.connected ? "Live" : live.status}
          </span>
          <button
            type="button"
            onClick={live.reconnect}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5"
          >
            Reconnect
          </button>
        </div>
      }
    >
      {live.error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {live.error}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Top Trending Score"
          value={topScore}
          subtitle="Current highest score"
          tone={severityToneByRisk(data.topTrending[0]?.abuseRisk ?? 0)}
        />
        <MetricCard
          title="Fastest Growth (24h)"
          value={formatPercent(topGrowth)}
          subtitle="Best acceleration today"
          tone={topGrowth >= 0 ? "success" : "danger"}
        />
        <MetricCard
          title="Viral Spikes"
          value={spikes}
          subtitle="Songs flagged as spikes"
          tone={spikes > 0 ? "info" : "default"}
        />
        <MetricCard
          title="Last Update"
          value={new Date(data.generatedAt).toLocaleTimeString()}
          subtitle="Realtime feed timestamp"
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 xl:col-span-1">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">
            Top Trending Songs
          </h2>
          <BarChart data={topChartData} height={300} />
        </article>

        <article className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 xl:col-span-1">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">
            Growth Velocity (24h)
          </h2>
          <BarChart data={growthChartData} height={300} />
        </article>

        <article className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 xl:col-span-1">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">Viral Spikes</h2>
          <BarChart data={spikeChartData} height={300} />
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("top")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === "top"
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            Top Trending
          </button>
          <button
            type="button"
            onClick={() => setTab("growth")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === "growth"
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            Fastest Growth
          </button>
          <button
            type="button"
            onClick={() => setTab("spikes")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === "spikes"
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            Viral Spikes
          </button>
        </div>

        <TrendingTable rows={activeRows} />
      </section>
    </AdminShell>
  );
}
