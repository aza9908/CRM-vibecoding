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
 * Thin recharts wrappers themed to the AI Research Labs palette (`--primary`).
 * Colors reference the CSS variables so charts follow light/dark mode. The
 * data is always pre-aggregated by the API; these components only draw it.
 */

/** Brand-led categorical palette for donut/segmented charts. */
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
  /** Optional per-bar color (e.g. unique student colors). */
  color?: string;
}

/** Distinct palette for up to ~20 students in post-session charts. */
export const STUDENT_COLORS = [
  '#7c3aed', // violet
  '#2563eb', // blue
  '#0891b2', // cyan
  '#059669', // emerald
  '#65a30d', // lime
  '#ca8a04', // yellow
  '#ea580c', // orange
  '#dc2626', // red
  '#db2777', // pink
  '#9333ea', // purple
  '#4f46e5', // indigo
  '#0d9488', // teal
  '#16a34a', // green
  '#d97706', // amber
  '#e11d48', // rose
  '#6366f1', // indigo-400
  '#14b8a6', // teal-400
  '#8b5cf6', // violet-400
  '#f43f5e', // rose-500
  '#0ea5e9', // sky
];

export function studentColor(index: number): string {
  return STUDENT_COLORS[index % STUDENT_COLORS.length]!;
}

/**
 * Horizontal bar chart — good for "progress / completion by student" where
 * labels are names. Supports per-bar colors for multi-student sessions.
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
          radius={[0, 4, 4, 0]}
          maxBarSize={22}
        >
          {data.map((d, i) => (
            <Cell
              key={`${d.label}-${i}`}
              fill={d.color ?? studentColor(i)}
            />
          ))}
        </Bar>
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
