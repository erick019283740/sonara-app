"use client";

import { useMemo } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { MetricCard } from "@/components/admin/metric-card";
import { LineChart } from "@/components/admin/line-chart";
import { BarChart } from "@/components/admin/bar-chart";
import { useAdminLive } from "@/components/admin/use-admin-live";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function formatNumber(value: number) {
  return (value ?? 0).toLocaleString();
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function formatTs(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

function severityClass(severity: "low" | "medium" | "high") {
  if (severity === "high") return "bg-red-500/20 text-red-300";
  if (severity === "medium") return "bg-amber-500/20 text-amber-300";
  return "bg-zinc-600/30 text-zinc-200";
}

export default function AdminOverviewPage() {
  const {
    status,
    connected,
    error,
    reconnect,
    snapshot,
    lastMessageAt,
    reconnectAttempts,
  } = useAdminLive({
    channel: "all",
    intervalMs: 2500,
    autoStart: true,
    alertsLimit: 100,
    severity: "all",
  });

  const streams = snapshot.streams;
  const fraud = snapshot.fraud;
  const earnings = snapshot.earnings;
  const trending = snapshot.trending;
  const alerts = snapshot.alerts;
  const health = snapshot.health;

  const streamSeries = useMemo(
    () =>
      (streams?.series ?? []).map((p) => ({
        ts: p.ts,
        value: p.streams,
      })),
    [streams?.series],
  );

  const listenerSeries = useMemo(
    () =>
      (streams?.series ?? []).map((p) => ({
        ts: p.ts,
        value: p.listeners,
      })),
    [streams?.series],
  );

  const anomalySeverityBars = useMemo(() => {
    const logs = fraud?.anomalyLogs ?? [];
    let low = 0;
    let medium = 0;
    let high = 0;
    for (const row of logs) {
      if (row.severity === "high") high += 1;
      else if (row.severity === "medium") medium += 1;
      else low += 1;
    }
    return [
      { id: "low", label: "Low", value: low, color: "#38bdf8" },
      { id: "medium", label: "Medium", value: medium, color: "#f59e0b" },
      { id: "high", label: "High", value: high, color: "#ef4444" },
    ];
  }, [fraud?.anomalyLogs]);

  const topArtistBars = useMemo(
    () =>
      (earnings?.topArtists ?? []).slice(0, 8).map((a) => ({
        id: a.artistId,
        label: a.stageName,
        value: a.totalEarnings,
      })),
    [earnings?.topArtists],
  );

  const topTrendingBars = useMemo(
    () =>
      (trending?.topTrending ?? []).slice(0, 8).map((t) => ({
        id: t.songId,
        label: t.title,
        value: t.trendingScore,
      })),
    [trending?.topTrending],
  );

  return (
    <AdminShell
      title="Admin Overview"
      subtitle="Real-time streams, fraud, earnings, trending, alerts, and platform health"
      actions={
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
              connected
                ? "bg-emerald-500/20 text-emerald-300"
                : status === "reconnecting" || status === "connecting"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-red-500/20 text-red-300",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-2 w-2 rounded-full",
                connected
                  ? "bg-emerald-400"
                  : status === "reconnecting" || status === "connecting"
                    ? "bg-amber-400"
                    : "bg-red-400",
              ].join(" ")}
            />
            {connected ? "Live" : status}
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Streams / sec"
          value={streams?.streamsPerSecond ?? 0}
          subtitle="Live ingestion velocity"
          tone="info"
        />
        <MetricCard
          title="Active listeners"
          value={streams?.activeListeners ?? 0}
          subtitle="Unique users over 5m"
          tone="success"
        />
        <MetricCard
          title="Suspicious users"
          value={fraud?.totals.suspiciousUsers ?? 0}
          subtitle="Flagged + blocked"
          tone="warning"
        />
        <MetricCard
          title="Open alerts"
          value={alerts?.totals.open ?? 0}
          subtitle="Live critical signals"
          tone={(alerts?.totals.open ?? 0) > 0 ? "danger" : "default"}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Revenue (daily)"
          value={formatCurrency(earnings?.summary.dailyRevenue ?? 0)}
          subtitle="Gross"
          tone="success"
        />
        <MetricCard
          title="Revenue (monthly)"
          value={formatCurrency(earnings?.summary.monthlyRevenue ?? 0)}
          subtitle="Gross"
          tone="success"
        />
        <MetricCard
          title="Top trend score"
          value={(trending?.topTrending?.[0]?.trendingScore ?? 0).toFixed(2)}
          subtitle={trending?.topTrending?.[0]?.title ?? "—"}
          tone="info"
        />
        <MetricCard
          title="Dead letter queue"
          value={health?.queue.deadLetterQueue ?? 0}
          subtitle="Processing health"
          tone={(health?.queue.deadLetterQueue ?? 0) > 0 ? "danger" : "default"}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">
            Streams Timeline
          </h2>
          <LineChart
            points={streamSeries}
            height={210}
            showArea
            showGrid
            showDots={false}
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">
            Listeners Timeline
          </h2>
          <LineChart
            points={listenerSeries}
            height={210}
            lineColor="#22c55e"
            fillColor="rgba(34,197,94,0.16)"
            showArea
            showGrid
            showDots={false}
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">
            Anomaly Severity
          </h2>
          <BarChart data={anomalySeverityBars} height={260} />
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">
            Top Earning Artists
          </h2>
          <BarChart
            data={topArtistBars}
            height={260}
            formatValue={(v) => formatCompact(v)}
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">
            Top Trending Songs
          </h2>
          <BarChart
            data={topTrendingBars}
            height={260}
            formatValue={(v) => v.toFixed(2)}
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Suspicious Users
            </h2>
            <span className="text-xs text-zinc-500">
              {(fraud?.suspiciousUsers ?? []).length} users
            </span>
          </div>
          <div className="max-h-[320px] overflow-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900/90">
                <tr className="text-xs uppercase tracking-wide text-zinc-400">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last Risk</th>
                  <th className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {(fraud?.suspiciousUsers ?? []).slice(0, 12).map((u) => (
                  <tr key={u.userId} className="border-t border-white/5">
                    <td className="px-3 py-2 text-zinc-200">{u.userId}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${severityClass(u.severity)}`}
                      >
                        {u.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{u.status}</td>
                    <td className="px-3 py-2 text-zinc-300">
                      {u.lastRiskScore.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{u.flagCount}</td>
                  </tr>
                ))}
                {(fraud?.suspiciousUsers ?? []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-zinc-500"
                    >
                      No suspicious users.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Live Alerts</h2>
            <span className="text-xs text-zinc-500">
              {(alerts?.alerts ?? []).length} events
            </span>
          </div>
          <div className="space-y-2">
            {(alerts?.alerts ?? []).slice(0, 10).map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-white">{a.message}</p>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${severityClass(a.severity)}`}
                  >
                    {a.severity}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  {new Date(a.createdAt).toLocaleString()} · risk{" "}
                  {a.riskScore.toFixed(1)}
                </p>
              </div>
            ))}
            {(alerts?.alerts ?? []).length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-6 text-center text-sm text-zinc-500">
                No live alerts.
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            Top Songs Right Now
          </h2>
          <span className="text-xs text-zinc-500">
            {(streams?.topSongsNow ?? []).length} songs
          </span>
        </div>
        <div className="overflow-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="bg-zinc-900/90 text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-3 py-2">Song</th>
                <th className="px-3 py-2">Artist</th>
                <th className="px-3 py-2">Streams (5m)</th>
                <th className="px-3 py-2">Listeners (5m)</th>
                <th className="px-3 py-2">Trend Score</th>
              </tr>
            </thead>
            <tbody>
              {(streams?.topSongsNow ?? []).slice(0, 12).map((song) => (
                <tr
                  key={song.songId}
                  className="border-t border-white/5 text-zinc-200"
                >
                  <td className="px-3 py-2">{song.title}</td>
                  <td className="px-3 py-2 text-zinc-400">{song.artistName}</td>
                  <td className="px-3 py-2">
                    {formatNumber(song.streamsLast5m)}
                  </td>
                  <td className="px-3 py-2">
                    {formatNumber(song.listenersLast5m)}
                  </td>
                  <td className="px-3 py-2">{song.trendScore.toFixed(3)}</td>
                </tr>
              ))}
              {(streams?.topSongsNow ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-zinc-500"
                  >
                    Waiting for stream activity…
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="rounded-xl border border-white/10 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-500">
        Client update: {formatTs(lastMessageAt)} · Server snapshot:{" "}
        {formatTs(snapshot.generatedAt)} · Reconnect attempts:{" "}
        {reconnectAttempts}
      </footer>
    </AdminShell>
  );
}
