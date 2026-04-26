"use client";

import { useMemo } from "react";

type TrendDirection = "up" | "down" | "neutral";
type Tone = "default" | "success" | "warning" | "danger" | "info";

export type MetricCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  delta?: {
    value: string | number;
    direction?: TrendDirection;
    label?: string;
  };
  tone?: Tone;
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

function toneClasses(tone: Tone) {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10";
    case "danger":
      return "border-red-500/30 bg-red-500/10";
    case "info":
      return "border-sky-500/30 bg-sky-500/10";
    default:
      return "border-white/10 bg-white/5";
  }
}

function deltaClasses(direction: TrendDirection) {
  switch (direction) {
    case "up":
      return "text-emerald-400";
    case "down":
      return "text-red-400";
    default:
      return "text-zinc-400";
  }
}

function deltaPrefix(direction: TrendDirection) {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "•";
}

function formatValue(value: string | number) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value;
}

export function MetricCard({
  title,
  value,
  subtitle,
  delta,
  tone = "default",
  loading = false,
  icon,
  className,
  onClick,
}: MetricCardProps) {
  const clickable = typeof onClick === "function";
  const formattedValue = useMemo(() => formatValue(value), [value]);

  if (loading) {
    return (
      <div
        className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${className ?? ""}`}
        aria-busy="true"
      >
        <div className="mb-4 h-4 w-28 animate-pulse rounded bg-white/10" />
        <div className="h-9 w-32 animate-pulse rounded bg-white/10" />
        <div className="mt-3 h-3 w-40 animate-pulse rounded bg-white/10" />
      </div>
    );
  }

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={[
        "group rounded-2xl border p-5 transition",
        toneClasses(tone),
        clickable
          ? "cursor-pointer hover:border-white/30 hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
          : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{title}</p>
        {icon ? <div className="text-zinc-400">{icon}</div> : null}
      </div>

      <div className="flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold leading-none text-white">{formattedValue}</p>
        {delta ? (
          <p
            className={`shrink-0 text-xs font-medium ${deltaClasses(
              delta.direction ?? "neutral",
            )}`}
          >
            {deltaPrefix(delta.direction ?? "neutral")} {formatValue(delta.value)}
            {delta.label ? ` ${delta.label}` : ""}
          </p>
        ) : null}
      </div>

      {subtitle ? <p className="mt-2 text-xs text-zinc-400">{subtitle}</p> : null}
    </div>
  );
}
