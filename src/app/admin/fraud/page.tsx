"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { MetricCard } from "@/components/admin/metric-card";
import { BarChart } from "@/components/admin/bar-chart";
import { useAdminLive } from "@/components/admin/use-admin-live";
import { useMemo, useState } from "react";

type SeverityFilter = "all" | "low" | "medium" | "high";

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "zinc" | "red" | "amber" | "emerald" | "sky" | "violet";
}) {
  const map: Record<typeof color, string> = {
    zinc: "bg-zinc-700/50 text-zinc-200 border-zinc-600/70",
    red: "bg-red-500/20 text-red-200 border-red-500/40",
    amber: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    emerald: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
    sky: "bg-sky-500/20 text-sky-200 border-sky-500/40",
    violet: "bg-violet-500/20 text-violet-200 border-violet-500/40",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${map[color]}`}
    >
      {children}
    </span>
  );
}

export default function AdminFraudPage() {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { status, connected, error, snapshot, reconnect } = useAdminLive({
    channel: "fraud",
    severity,
    userId: selectedUserId,
    intervalMs: 3000,
    alertsLimit: 100,
  });

  const fraud = snapshot.fraud;

  const suspiciousUsers = useMemo(
    () => fraud?.suspiciousUsers ?? [],
    [fraud?.suspiciousUsers],
  );
  const anomalyLogs = useMemo(
    () => fraud?.anomalyLogs ?? [],
    [fraud?.anomalyLogs],
  );
  const clusters = fraud?.fraudClusters ?? [];
  const totals = fraud?.totals ?? {
    suspiciousUsers: 0,
    blockedUsers: 0,
    activeClusters: 0,
    highSeverityAnomalies24h: 0,
  };

  const selectedUser = useMemo(
    () => suspiciousUsers.find((u) => u.userId === selectedUserId) ?? null,
    [suspiciousUsers, selectedUserId],
  );

  const selectedUserAnomalies = useMemo(() => {
    if (!selectedUserId) return [];
    return anomalyLogs.filter((a) => a.userId === selectedUserId).slice(0, 20);
  }, [anomalyLogs, selectedUserId]);

  const severityDist = useMemo(() => {
    let low = 0;
    let medium = 0;
    let high = 0;
    for (const row of anomalyLogs) {
      if (row.severity === "high") high += 1;
      else if (row.severity === "medium") medium += 1;
      else low += 1;
    }
    return [
      { label: "Low", value: low, color: "#38bdf8" },
      { label: "Medium", value: medium, color: "#f59e0b" },
      { label: "High", value: high, color: "#ef4444" },
    ];
  }, [anomalyLogs]);

  return (
    <AdminShell
      title="Fraud Monitoring"
      subtitle="Suspicious users, anomaly scores, and coordinated fraud clusters."
      actions={
        <div className="flex items-center gap-2">
          <Badge color={connected ? "emerald" : "amber"}>
            {connected ? "LIVE" : status.toUpperCase()}
          </Badge>
          <button
            type="button"
            onClick={() => reconnect()}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
          >
            Reconnect
          </button>
        </div>
      }
    >
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Suspicious Users"
          value={totals.suspiciousUsers}
          subtitle="Current flagged and blocked users"
          tone="warning"
        />
        <MetricCard
          title="Blocked Users"
          value={totals.blockedUsers}
          subtitle="Users hard-blocked by risk policy"
          tone="danger"
        />
        <MetricCard
          title="Active Clusters"
          value={totals.activeClusters}
          subtitle="Potential coordinated fraud groups"
          tone="info"
        />
        <MetricCard
          title="High Severity 24h"
          value={totals.highSeverityAnomalies24h}
          subtitle="Anomalies with high severity in 24h"
          tone="danger"
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">Filters</h2>
          <div className="flex items-center gap-2">
            {(["all", "low", "medium", "high"] as SeverityFilter[]).map((s) => {
              const active = severity === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-violet-600 text-white"
                      : "bg-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
                >
                  {s.toUpperCase()}
                </button>
              );
            })}
            {selectedUserId && (
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
              >
                Clear User
              </button>
            )}
          </div>
        </div>

        <BarChart
          data={severityDist}
          height={220}
          className="rounded-xl border border-white/10 bg-zinc-950/40 p-2"
          emptyMessage="No anomaly distribution data"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-white">
            Suspicious Users
          </h2>
          <div className="max-h-[420px] overflow-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900/90 backdrop-blur">
                <tr className="text-xs uppercase tracking-wide text-zinc-400">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last Risk</th>
                  <th className="px-3 py-2">Max Risk</th>
                  <th className="px-3 py-2">Flags</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {suspiciousUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-zinc-500"
                    >
                      No suspicious users found.
                    </td>
                  </tr>
                ) : (
                  suspiciousUsers.map((u) => (
                    <tr
                      key={u.userId}
                      className={`cursor-pointer border-t border-white/5 transition hover:bg-white/[0.04] ${
                        selectedUserId === u.userId ? "bg-violet-500/10" : ""
                      }`}
                      onClick={() =>
                        setSelectedUserId((prev) =>
                          prev === u.userId ? null : u.userId,
                        )
                      }
                    >
                      <td className="px-3 py-2">
                        <div className="max-w-[220px]">
                          <p className="truncate font-medium text-white">
                            {u.userId}
                          </p>
                          <p className="truncate text-xs text-zinc-500">
                            {u.email ?? "no-email"}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          color={
                            u.severity === "high"
                              ? "red"
                              : u.severity === "medium"
                                ? "amber"
                                : "sky"
                          }
                        >
                          {u.severity}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          color={
                            u.status === "blocked"
                              ? "red"
                              : u.status === "flagged"
                                ? "amber"
                                : "emerald"
                          }
                        >
                          {u.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-zinc-200">
                        {u.lastRiskScore.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-zinc-200">
                        {u.maxRiskScore.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-zinc-300">{u.flagCount}</td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {fmtDate(u.updatedAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-white">
            {selectedUser
              ? `User Detail: ${selectedUser.userId}`
              : "User Detail (click user)"}
          </h2>

          {!selectedUser ? (
            <p className="text-sm text-zinc-500">
              Select a suspicious user to inspect latest anomaly events and
              reasons.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge
                    color={selectedUser.status === "blocked" ? "red" : "amber"}
                  >
                    {selectedUser.status}
                  </Badge>
                  <Badge
                    color={selectedUser.severity === "high" ? "red" : "amber"}
                  >
                    {selectedUser.severity}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-400">Latest reasons</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedUser.reasons.length === 0 ? (
                    <span className="text-xs text-zinc-500">
                      No reasons recorded
                    </span>
                  ) : (
                    selectedUser.reasons.slice(0, 8).map((reason, idx) => (
                      <Badge key={`${reason}-${idx}`} color="zinc">
                        {reason}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              <div className="max-h-[270px] overflow-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900/90">
                    <tr className="uppercase tracking-wide text-zinc-400">
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Risk</th>
                      <th className="px-3 py-2">Anomaly</th>
                      <th className="px-3 py-2">Graph</th>
                      <th className="px-3 py-2">Song</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedUserAnomalies.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-5 text-center text-zinc-500"
                        >
                          No anomaly events for this user.
                        </td>
                      </tr>
                    ) : (
                      selectedUserAnomalies.map((a) => (
                        <tr key={a.id} className="border-t border-white/5">
                          <td className="px-3 py-2 text-zinc-500">
                            {fmtDate(a.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-zinc-200">
                            {a.riskScore.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-zinc-300">
                            {a.anomalyScore.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-zinc-300">
                            {a.graphScore.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-zinc-400">
                            {a.songId ?? "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
        <h2 className="mb-3 text-base font-semibold text-white">
          Fraud Clusters
        </h2>
        <div className="max-h-[360px] overflow-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="sticky top-0 bg-zinc-900/90 backdrop-blur">
              <tr className="text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-3 py-2">Cluster ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Cluster Score</th>
                <th className="px-3 py-2">Users</th>
                <th className="px-3 py-2">Shared IP</th>
                <th className="px-3 py-2">Shared Device</th>
                <th className="px-3 py-2">Song</th>
                <th className="px-3 py-2">Artist</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {clusters.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-6 text-center text-zinc-500"
                  >
                    No fraud clusters detected.
                  </td>
                </tr>
              ) : (
                clusters.map((c) => (
                  <tr key={c.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-medium text-white">{c.id}</td>
                    <td className="px-3 py-2">
                      <Badge
                        color={
                          c.status === "active"
                            ? "red"
                            : c.status === "investigating"
                              ? "amber"
                              : "emerald"
                        }
                      >
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-zinc-200">
                      {c.clusterScore.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{c.userCount}</td>
                    <td className="px-3 py-2 text-zinc-300">
                      {c.sharedIpCount}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">
                      {c.sharedDeviceCount}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">
                      {c.songId ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">
                      {c.artistId ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {fmtDate(c.updatedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
    </AdminShell>
  );
}
