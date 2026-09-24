"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtDateShort, fmtDuration } from "@/lib/time";
import type { Stats } from "@/lib/services/stats";
import { usePalette, type Palette } from "./use-palette";

const tick = (p: Palette, size = 10) => ({ fill: p.subtle, fontSize: size });
const tooltipStyle = (p: Palette) => ({
  background: p.surface,
  border: `1px solid ${p.grid}`,
  borderRadius: 10,
  color: p.ink,
  fontSize: 12,
  padding: "6px 10px",
});

/** Thin the x labels: about `target` labels whatever the range. */
function interval(n: number, target: number) {
  return n <= target ? 0 : Math.ceil(n / target) - 1;
}

function Swatch({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-0 w-3"
        style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }}
        aria-hidden
      />
      {label}
    </span>
  );
}

type Row = { date: string } & Record<string, unknown>;

/**
 * One measure over time: bars or a line, an optional 7-day average and an optional target line.
 * One y-axis only. Bars above/below the target can be flagged amber.
 */
export function TrendChart({
  data, y, avg, kind, name, height, unit = "", domain, fmt, target, flag, color = "accent", large,
}: {
  data: Row[];
  y: string;
  avg?: string;
  kind: "bar" | "line";
  name: string;
  height: number;
  unit?: string;
  domain?: [number, number | "auto"];
  fmt?: (v: number) => string;
  target?: { value: number; label: string };
  /** colour bars amber when above ("over") or below ("under") the target */
  flag?: "over" | "under";
  color?: "accent" | "blue";
  large?: boolean;
}) {
  const { p, ready } = usePalette();
  if (!ready) return <div style={{ height }} />;
  const main = color === "blue" ? p.blue : p.accent;
  const format = fmt ?? ((v: number) => `${Math.round(v * 10) / 10}${unit}`);
  const flagged = (v: unknown) =>
    target && flag && typeof v === "number" && (flag === "over" ? v > target.value : v < target.value);
  const hasData = data.some((d) => typeof d[y] === "number" && (d[y] as number) > 0);
  const fs = large ? 11 : 10;

  return (
    <div className="w-full" role="img" aria-label={`${name} per day`}>
      {avg || target ? (
        <div className="mb-1 flex flex-wrap justify-end gap-x-3 text-[10px] text-subtle">
          <Swatch color={main} label={name} />
          {avg ? <Swatch color={p.amber} dashed label="7-day avg" /> : null}
          {target && !avg ? <Swatch color={p.subtle} dashed label={target.label} /> : null}
        </div>
      ) : null}
      <div style={{ height }} className="relative">
        {!hasData ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-subtle">No data in this range</div>
        ) : null}
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={p.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => fmtDateShort(String(d))}
              tick={tick(p, fs)}
              interval={interval(data.length, large ? 10 : 5)}
              axisLine={false}
              tickLine={false}
              minTickGap={8}
            />
            <YAxis
              width={large ? 40 : 32}
              domain={domain ?? [0, "auto"]}
              tick={tick(p, fs)}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              tickFormatter={(v) => (unit === "k" ? `${Number(v) / 1000}k` : `${v}${unit}`)}
            />
            <Tooltip
              contentStyle={tooltipStyle(p)}
              cursor={kind === "bar" ? { fill: p.grid, opacity: 0.5 } : { stroke: p.subtle, strokeDasharray: "3 3" }}
              labelFormatter={(l) => fmtDateShort(String(l))}
              formatter={(v, n) => [v === null || v === undefined ? "no data" : format(Number(v)), n]}
            />
            {target ? (
              <ReferenceLine y={target.value} stroke={p.subtle} strokeDasharray="4 4" ifOverflow="extendDomain" />
            ) : null}
            {kind === "bar" ? (
              <Bar isAnimationActive={false} dataKey={y} name={name} radius={[3, 3, 0, 0]} maxBarSize={large ? 22 : 14}>
                {data.map((d, i) => (
                  <Cell key={i} fill={flagged(d[y]) ? p.amber : main} />
                ))}
              </Bar>
            ) : (
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey={y}
                name={name}
                stroke={main}
                strokeWidth={2}
                dot={data.length <= 31 ? { r: 2.5, fill: main, strokeWidth: 0 } : false}
                activeDot={{ r: 4, stroke: p.surface, strokeWidth: 2 }}
                connectNulls
              />
            )}
            {avg ? (
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey={avg}
                name="7-day avg"
                stroke={p.amber}
                strokeWidth={1.75}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function WeekdayChart({
  data, metric, label, height, fmt,
}: {
  data: Stats["weekday"];
  metric: "avgScore" | "avgDone" | "avgHours";
  label: string;
  height: number;
  fmt?: (v: number) => string;
}) {
  const { p, ready } = usePalette();
  if (!ready) return <div style={{ height }} />;
  const best = Math.max(...data.map((d) => d[metric] ?? 0));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={`Bar chart: ${label} by weekday`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="label" tick={tick(p)} axisLine={false} tickLine={false} tickFormatter={(l) => String(l).slice(0, 2)} />
          <YAxis width={28} tick={tick(p)} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={tooltipStyle(p)}
            cursor={{ fill: p.grid, opacity: 0.5 }}
            formatter={(v) => [v === null || v === undefined ? "no data" : fmt ? fmt(Number(v)) : v, label]}
          />
          <Bar isAnimationActive={false} dataKey={metric} radius={[3, 3, 0, 0]} maxBarSize={26}>
            {data.map((d) => (
              <Cell key={d.dow} fill={(d[metric] ?? 0) === best && best > 0 ? p.accent : p.accentSoft} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProjectBars({
  data, onPick, active, height, limit,
}: {
  data: Stats["hoursByProject"];
  onPick?: (key: string) => void;
  active?: string | null;
  height?: number;
  /** fold anything past this many rows into "Other" */
  limit?: number;
}) {
  const { p, ready } = usePalette();
  let rows = data.map((d) => ({ ...d, hours: Math.round((d.minutes / 60) * 10) / 10, key: d.id === null ? "none" : String(d.id) }));
  if (limit && rows.length > limit) {
    const rest = rows.slice(limit - 1);
    const minutes = rest.reduce((s, r) => s + r.minutes, 0);
    rows = [...rows.slice(0, limit - 1), { id: null, name: `Other (${rest.length})`, color: p.subtle, minutes, hours: Math.round((minutes / 60) * 10) / 10, key: "__other" }];
  }
  const h = height ?? Math.max(120, rows.length * 30 + 16);
  if (!ready) return <div style={{ height: h }} />;
  return (
    <div style={{ height: h }} className="w-full" role="img" aria-label="Bar chart of hours by project">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 0 }} barCategoryGap={4}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={92} tick={{ ...tick(p, 11), fill: p.ink }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={tooltipStyle(p)}
            formatter={(_v, _n, item) => [fmtDuration((item.payload as { minutes: number }).minutes), "Time"]}
            cursor={{ fill: p.grid, opacity: 0.5 }}
          />
          <Bar
            isAnimationActive={false}
            dataKey="hours"
            radius={[0, 3, 3, 0]}
            maxBarSize={18}
            cursor={onPick ? "pointer" : undefined}
            label={{ position: "right", fill: p.subtle, fontSize: 10, formatter: (v: number) => `${v}h` }}
            onClick={(d) => {
              const key = (d as unknown as { key: string }).key;
              if (onPick && key !== "__other") onPick(key);
            }}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={r.color} opacity={!active || active === r.key ? 1 : 0.35} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Calendar grid coloured by score (0 to 10), weeks as columns. Cells stretch to fill the width. */
export function Heatmap({ data, cell = 14 }: { data: Stats["heatmap"]; cell?: number }) {
  const { p } = usePalette();
  if (data.length === 0) return null;
  const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const pad = dow(data[0].date);
  const cells: ({ date: string; score: number | null } | null)[] = [...Array(pad).fill(null), ...data];
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const color = (s: number | null) => (s === null ? p.heat[0] : p.heat[Math.min(6, Math.max(1, Math.ceil((s / 10) * 6)))]);
  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-1" role="img" aria-label="Score heatmap by day">
        <div className="flex flex-col gap-[3px] pr-1 text-[10px] text-subtle">
          {["M", "", "W", "", "F", "", "S"].map((l, i) => (
            <span key={i} className="flex items-center" style={{ height: cell }}>{l}</span>
          ))}
        </div>
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, i) => w[i]).map((c, i) =>
              c ? (
                <span
                  key={i}
                  title={`${fmtDateShort(c.date)}: ${c.score === null ? "no score" : c.score}`}
                  className="rounded-[3px]"
                  style={{ background: color(c.score), width: cell, height: cell }}
                />
              ) : (
                <span key={i} style={{ width: cell, height: cell }} />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-subtle">
        <span>none</span>
        {p.heat.map((c, i) => (
          <span key={i} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
        ))}
        <span>10</span>
      </div>
    </div>
  );
}
