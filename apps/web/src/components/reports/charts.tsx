'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Thin recharts wrappers themed to the Lumen palette (indigo `--primary`).
 * Colors reference the CSS variables so charts follow light/dark mode. The
 * data is always pre-aggregated by the API; these components only draw it.
 */

/** Indigo-led categorical palette for donut/segmented charts. */
export const CHART_COLORS = [
  'hsl(var(--primary))',
  '#10b981', // emerald-500 — "completed" / positive
  '#f59e0b', // amber-500 — "in progress"
  '#64748b', // slate-500 — "not started" / neutral
  '#ef4444', // red-500
];

const AXIS_COLOR = 'hsl(var(--muted-foreground))';

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string; name?: string; payload?: unknown }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      {label != null && (
        <div className="mb-0.5 font-medium text-foreground">{String(label)}</div>
      )}
      <div className="text-muted-foreground">
        {entry?.name ? `${entry.name}: ` : ''}
        <span className="font-semibold text-foreground">
          {String(entry?.value ?? '')}
        </span>
      </div>
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Horizontal bar chart — good for "progress / completion by student" where
 * labels are names. `unit` is appended to the tooltip value (e.g. "%").
 */
export function HorizontalBars({
  data,
  height,
}: {
  data: BarDatum[];
  height?: number;
}) {
  const h = height ?? Math.max(120, data.length * 36 + 24);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={120}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--accent))' }}
          content={<ChartTooltip />}
        />
        <Bar
          dataKey="value"
          fill="hsl(var(--primary))"
          radius={[0, 4, 4, 0]}
          maxBarSize={22}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Vertical bar chart — good for value distributions (e.g. rating 1..5 counts).
 */
export function VerticalBars({
  data,
  height,
}: {
  data: BarDatum[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height ?? 200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--accent))' }}
          content={<ChartTooltip />}
        />
        <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

/**
 * Donut chart with a centered total + a side legend. Used for completion mix
 * (completed / in progress / not started).
 */
export function Donut({
  data,
  centerLabel,
}: {
  data: DonutDatum[];
  centerLabel?: string;
}) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={56}
              outerRadius={80}
              paddingAngle={total > 0 ? 2 : 0}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell
                  key={d.label}
                  fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums">{total}</span>
          {centerLabel && (
            <span className="text-xs text-muted-foreground">{centerLabel}</span>
          )}
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                backgroundColor:
                  d.color ?? CHART_COLORS[i % CHART_COLORS.length],
              }}
            />
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-semibold tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
