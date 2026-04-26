"use client";

import { useMemo } from "react";

type BarDatum = {
  id?: string;
  label: string;
  value: number;
  color?: string;
};

type BarChartProps = {
  data: BarDatum[];
  width?: number;
  height?: number;
  barColor?: string;
  axisColor?: string;
  gridColor?: string;
  textColor?: string;
  maxLabelLength?: number;
  showValues?: boolean;
  formatValue?: (value: number) => string;
  className?: string;
  emptyMessage?: string;
};

const DEFAULTS = {
  width: 720,
  height: 320,
  barColor: "#8b5cf6",
  axisColor: "rgba(255,255,255,0.28)",
  gridColor: "rgba(255,255,255,0.10)",
  textColor: "rgba(255,255,255,0.78)",
  maxLabelLength: 22,
} as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function defaultFormatValue(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function BarChart({
  data,
  width = DEFAULTS.width,
  height = DEFAULTS.height,
  barColor = DEFAULTS.barColor,
  axisColor = DEFAULTS.axisColor,
  gridColor = DEFAULTS.gridColor,
  textColor = DEFAULTS.textColor,
  maxLabelLength = DEFAULTS.maxLabelLength,
  showValues = true,
  formatValue = defaultFormatValue,
  className,
  emptyMessage = "No data available",
}: BarChartProps) {
  const computed = useMemo(() => {
    const safe = data
      .map((d, i) => ({
        key: d.id ?? `${d.label}-${i}`,
        label: d.label ?? "",
        value: Number.isFinite(d.value) ? d.value : 0,
        color: d.color,
      }))
      .filter((d) => d.label.length > 0);

    const max = safe.length > 0 ? Math.max(...safe.map((d) => d.value), 0) : 0;

    return {
      rows: safe,
      max,
    };
  }, [data]);

  const margin = {
    top: 16,
    right: 20,
    bottom: 24,
    left: 148,
  };

  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const rowHeight = 28;
  const rowGap = 10;
  const dynamicInnerHeight = Math.max(
    1,
    computed.rows.length * rowHeight + Math.max(0, computed.rows.length - 1) * rowGap,
  );
  const finalHeight = Math.max(height, dynamicInnerHeight + margin.top + margin.bottom);
  const innerHeight = finalHeight - margin.top - margin.bottom;

  const ticks = 4;
  const tickValues =
    computed.max > 0
      ? Array.from({ length: ticks + 1 }, (_, i) => (computed.max / ticks) * i)
      : [0];

  if (computed.rows.length === 0) {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          minHeight: 140,
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          color: "rgba(255,255,255,0.55)",
          fontSize: 13,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={className} style={{ width: "100%", overflowX: "auto" }}>
      <svg
        width={width}
        height={finalHeight}
        viewBox={`0 0 ${width} ${finalHeight}`}
        role="img"
        aria-label="Bar chart"
      >
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* grid + x ticks */}
          {tickValues.map((tick, idx) => {
            const x = computed.max === 0 ? 0 : (tick / computed.max) * innerWidth;
            return (
              <g key={`tick-${idx}`}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={innerHeight}
                  stroke={gridColor}
                  strokeDasharray={idx === 0 ? undefined : "3 4"}
                />
                <text
                  x={x}
                  y={innerHeight + 16}
                  textAnchor={idx === 0 ? "start" : idx === tickValues.length - 1 ? "end" : "middle"}
                  fontSize={11}
                  fill={textColor}
                >
                  {formatValue(tick)}
                </text>
              </g>
            );
          })}

          {/* axis */}
          <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke={axisColor} />
          <line x1={0} y1={0} x2={0} y2={innerHeight} stroke={axisColor} />

          {/* bars */}
          {computed.rows.map((row, index) => {
            const y = index * (rowHeight + rowGap);
            const bw = computed.max === 0 ? 0 : (row.value / computed.max) * innerWidth;
            const label = truncate(row.label, maxLabelLength);
            const valueText = formatValue(row.value);
            const fill = row.color ?? barColor;

            return (
              <g key={row.key}>
                <text
                  x={-12}
                  y={y + rowHeight / 2 + 4}
                  textAnchor="end"
                  fontSize={12}
                  fill={textColor}
                >
                  {label}
                </text>

                <rect
                  x={0}
                  y={y}
                  width={clamp(bw, 0, innerWidth)}
                  height={rowHeight}
                  rx={6}
                  fill={fill}
                  opacity={0.95}
                />

                {showValues && (
                  <text
                    x={clamp(bw + 8, 8, innerWidth - 4)}
                    y={y + rowHeight / 2 + 4}
                    fontSize={11}
                    fill={textColor}
                    textAnchor={bw > innerWidth - 60 ? "end" : "start"}
                  >
                    {valueText}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default BarChart;
