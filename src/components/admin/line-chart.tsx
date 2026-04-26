"use client";

import { useId, useMemo } from "react";

export type LineChartPoint = {
  ts: string;
  value: number;
};

type Props = {
  points: LineChartPoint[];
  height?: number;
  strokeWidth?: number;
  className?: string;
  lineColor?: string;
  fillColor?: string;
  showArea?: boolean;
  showDots?: boolean;
  showGrid?: boolean;
  compact?: boolean;
  yFormatter?: (value: number) => string;
};

const DEFAULT_HEIGHT = 160;
const PAD_X = 10;
const PAD_TOP = 8;
const PAD_BOTTOM = 20;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTs(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function niceNumber(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function LineChart({
  points,
  height = DEFAULT_HEIGHT,
  strokeWidth = 2.5,
  className,
  lineColor = "#8b5cf6",

  showArea = true,
  showDots = false,
  showGrid = true,
  compact = false,
  yFormatter = niceNumber,
}: Props) {
  const gradientId = useId();

  const viewBoxWidth = 100;
  const chartHeight = clampNumber(height, 80, 420);

  const innerWidth = viewBoxWidth - PAD_X * 2;
  const innerHeight = chartHeight - PAD_TOP - PAD_BOTTOM;

  const safePoints = useMemo(() => {
    if (!Array.isArray(points) || points.length === 0) return [];

    const normalized = points.map((p) => ({
      ts: p.ts,
      value: Number.isFinite(p.value) ? p.value : 0,
    }));

    return normalized;
  }, [points]);

  const { polyline, areaPath, mapped, minValue, maxValue, yTicks, hasData } =
    useMemo(() => {
      if (safePoints.length === 0) {
        return {
          polyline: "",
          areaPath: "",
          mapped: [] as Array<{
            x: number;
            y: number;
            ts: string;
            value: number;
          }>,
          minValue: 0,
          maxValue: 0,
          yTicks: [0, 0.5, 1],
          hasData: false,
        };
      }

      const values = safePoints.map((p) => p.value);
      const rawMin = Math.min(...values);
      const rawMax = Math.max(...values);

      const pad =
        rawMax === rawMin
          ? Math.max(1, Math.abs(rawMax) * 0.1)
          : (rawMax - rawMin) * 0.12;
      const minValue = rawMin - pad;
      const maxValue = rawMax + pad;
      const valueRange = Math.max(1e-9, maxValue - minValue);

      const mapped = safePoints.map((p, idx) => {
        const t = safePoints.length === 1 ? 0 : idx / (safePoints.length - 1);
        const x = PAD_X + t * innerWidth;
        const yNorm = (p.value - minValue) / valueRange;
        const y = PAD_TOP + (1 - yNorm) * innerHeight;
        return { x, y, ts: p.ts, value: p.value };
      });

      const polyline = mapped
        .map((m) => `${m.x.toFixed(2)},${m.y.toFixed(2)}`)
        .join(" ");
      const first = mapped[0];
      const last = mapped[mapped.length - 1];

      const areaPath = mapped.length
        ? `M ${first.x.toFixed(2)} ${chartHeight - PAD_BOTTOM} L ${polyline.replace(/,/g, " ")} L ${last.x.toFixed(2)} ${chartHeight - PAD_BOTTOM} Z`
        : "";

      const yTicks = [0, 0.25, 0.5, 0.75, 1];

      return {
        polyline,
        areaPath,
        mapped,
        minValue,
        maxValue,
        yTicks,
        hasData: true,
      };
    }, [safePoints, chartHeight, innerHeight, innerWidth]);

  if (!hasData) {
    return (
      <div
        className={[
          "flex w-full items-center justify-center rounded-xl border border-white/10 bg-zinc-900/40 text-sm text-zinc-500",
          className ?? "",
        ].join(" ")}
        style={{ height: chartHeight }}
      >
        No chart data
      </div>
    );
  }

  const xStartLabel = formatTs(mapped[0]?.ts ?? "");
  const xEndLabel = formatTs(mapped[mapped.length - 1]?.ts ?? "");

  return (
    <div className={["w-full", className ?? ""].join(" ")}>
      <svg
        viewBox={`0 0 ${viewBoxWidth} ${chartHeight}`}
        className="w-full overflow-visible"
        role="img"
        aria-label="Line chart"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.45" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {showGrid &&
          yTicks.map((t, i) => {
            const y = PAD_TOP + (1 - t) * innerHeight;
            return (
              <line
                key={`g-${i}`}
                x1={PAD_X}
                x2={PAD_X + innerWidth}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={0.35}
              />
            );
          })}

        {showArea && areaPath ? (
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        ) : null}

        <polyline
          fill="none"
          stroke={lineColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline}
        />

        {showDots &&
          mapped.map((m, idx) => (
            <circle
              key={`d-${idx}`}
              cx={m.x}
              cy={m.y}
              r={1.1}
              fill={lineColor}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={0.4}
            />
          ))}

        {!compact && (
          <>
            <text
              x={PAD_X + innerWidth + 1}
              y={PAD_TOP + 3}
              fill="rgba(255,255,255,0.65)"
              fontSize="3"
              textAnchor="end"
            >
              {yFormatter(maxValue)}
            </text>
            <text
              x={PAD_X + innerWidth + 1}
              y={PAD_TOP + innerHeight}
              fill="rgba(255,255,255,0.55)"
              fontSize="3"
              textAnchor="end"
            >
              {yFormatter(minValue)}
            </text>
          </>
        )}
      </svg>

      {!compact && (
        <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-zinc-500">
          <span>{xStartLabel}</span>
          <span>{xEndLabel}</span>
        </div>
      )}
    </div>
  );
}
