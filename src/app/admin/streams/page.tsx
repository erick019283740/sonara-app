"use client";

import { useMemo } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { MetricCard } from "@/components/admin/metric-card";
import { LineChart } from "@/components/admin/line-chart";
import { useAdminLive } from "@/components/admin/use-admin-live";

function fmtNumber(value: number) {
  return value.toLocaleString();
}

function fmtDecimal(value: number, digits = 2) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function toneBySps(sps: number): "default" | "success" | "warning" | "danger" {
  if (sps >= 5) return "danger";
  if (sps >= 2.5) return "warning";
  if (sps >= 1) return "success";
  return "default";
}

export default function AdminStreamsPage() {
  const { status, connected, error, reconnect, snapshot, lastMessageAt } = useAdminLive({
    channel: "streams",
    intervalMs: 2000,
    autoStart: true,
  });

  const streamData = snapshot.streams;
  const series = useMemo(() => streamData?.series ?? [], [streamData?.series]);
  const topSongs = streamData?.topSongsNow ?? [];

  const chartPoints = useMemo(
    () =>
      series.map((p) => ({
        ts: p.ts,
        value: p.streams,
      })),
    [series],
  );

  const listenersPoints = useMemo(
    () =>
      series.map((p) => ({
        ts: p.ts,
        value: p.listeners,
      })),
    [series],
  );

  return (
    <AdminShell
      title="Live Stream Monitoring"
      subtitle="Streams per second, active listeners, and top songs in real time"
      actions={
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
              connected
                ? "bg-emerald-500/20 text-emerald-300"
                : status === "reconnecting"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-red-500/20 text-red-300",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-2 w-2 rounded-full",
                connected
                  ? "bg-emerald-400"
                  : status === "reconnecting"
                    ? "bg-amber-400"
                    : "bg-red-400",
              ].join(" ")}
            />
            {connected
              ? "Live"
              : status === "reconnecting"
                ? "Reconnecting"
                : "Disconnected"}
          </span>

          <button
            type="button"
            onClick={reconnect}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
          >
            Reconnect
          </button>
        </div>
      }
    >
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Streams / second"
          value={streamData?.streamsPerSecond ?? 0}
          subtitle="Live ingestion velocity"
          tone={toneBySps(streamData?.streamsPerSecond ?? 0)}
        />
        <MetricCard
          title="Streams (last minute)"
          value={streamData?.streamsLastMinute ?? 0}
          subtitle="Rolling 60s window"
          tone="info"
        />
        <MetricCard
          title="Streams (last 5 min)"
          value={streamData?.streamsLast5m ?? 0}
          subtitle="Rolling 5m window"
          tone="default"
        />
        <MetricCard
          title="Active listeners"
          value={streamData?.activeListeners ?? 0}
          subtitle="Unique users over 5m"
          tone="success"
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Streams Timeline</h2>
            <span className="text-xs text-zinc-500">
              {series.length > 0 ? `${series.length} points` : "No data"}
            </span>
          </div>
          <LineChart
            points={chartPoints}
            height={210}
            lineColor="#8b5cf6"
            fillColor="rgba(139,92,246,0.18)"
            showArea
            showDots={false}
            showGrid
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Active Listeners Timeline</h2>
            <span className="text-xs text-zinc-500">
              {series.length > 0 ? "5-minute live window" : "No data"}
            </span>
          </div>
          <LineChart
            points={listenersPoints}
            height={210}
            lineColor="#22c55e"
            fillColor="rgba(34,197,94,0.16)"
            showArea
            showDots={false}
            showGrid
          />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Top Songs Right Now</h2>
          <span className="text-xs text-zinc-500">Sorted by streams in last 5m</span>
        </div>

        {topSongs.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
            Waiting for live stream activity…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-400">
                  <th className="py-2 pr-4 font-medium">Song</th>
                  <th className="py-2 pr-4 font-medium">Artist</th>
                  <th className="py-2 pr-4 font-medium">Streams (5m)</th>
                  <th className="py-2 pr-4 font-medium">Listeners (5m)</th>
                  <th className="py-2 pr-0 font-medium">Trend Score</th>
                </tr>
              </thead>
              <tbody>
                {topSongs.map((song) => (
                  <tr key={song.songId} className="border-b border-white/5 text-zinc-200">
                    <td className="py-2.5 pr-4">
                      <p className="max-w-[260px] truncate font-medium text-white">{song.title}</p>
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-300">{song.artistName}</td>
                    <td className="py-2.5 pr-4">{fmtNumber(song.streamsLast5m)}</td>
                    <td className="py-2.5 pr-4">{fmtNumber(song.listenersLast5m)}</td>
                    <td className="py-2.5 pr-0">{fmtDecimal(song.trendScore, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="text-xs text-zinc-500">
        Last update:{" "}
        {lastMessageAt
          ? new Date(lastMessageAt).toLocaleTimeString()
          : "—"}
        {streamData?.generatedAt ? (
          <> · Server snapshot: {new Date(streamData.generatedAt).toLocaleTimeString()}</>
        ) : null}
      </footer>
    </AdminShell>
  );
}
