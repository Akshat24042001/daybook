"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtDateShort, fmtDuration } from "@/lib/time";
import type { Stats } from "@/lib/services/stats";
import { usePalette, type Palette } from "./use-palette";

const tick = (p: Palette) => ({ fill: p.subtle, fontSize: 11 });
const tooltipStyle = (p: Palette) => ({
  background: p.surface,
  border: `1px solid ${p.grid}`,
  borderRadius: 12,
  color: p.ink,
  fontSize: 12,
});

function dateTick(d: string) {
  return fmtDateShort(d);
}

/** Thin the x labels so a 90 day range stays readable. */
function interval(n: number) {
  return n <= 10 ? 0 : Math.ceil(n / 7) - 1;
}

export function ScoreHoursChart({ series }: { series: Stats["series"] }) {
  const { p, ready } = usePalette();
  if (!ready) return <div className="h-64" />;
  return (
    <div className="h-64 w-full" role="img" aria-label="Line chart of daily score against hours worked">
      <ResponsiveContainer>
        <ComposedChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={dateTick} tick={tick(p)} interval={interval(series.length)} axisLine={false} tickLine={false} />
          <YAxis yAxisId="score" domain={[0, 10]} tick={tick(p)} axisLine={false} tickLine={false} />
          <YAxis yAxisId="hours" orientation="right" domain={[0, "auto"]} tick={tick(p)} axisLine={false} tickLine={false} unit="h" />
          <Tooltip contentStyle={tooltipStyle(p)} labelFormatter={(l) => fmtDateShort(String(l))} />
          <Legend wrapperStyle={{ fontSize: 12, color: p.subtle }} />
          <Bar yAxisId="hours" dataKey="hours" name="Hours worked" fill={p.accentSoft} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line yAxisId="score" type="monotone" dataKey="score" name="Score" stroke={p.accent} strokeWidth={2.5} dot={{ r: 2.5, fill: p.accent }} connectNulls={false} />
          <Line yAxisId="score" type="monotone" dataKey="scoreAvg" name="Score, 7-day average" stroke={p.amber} strokeWidth={1.75} strokeDasharray="5 4" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DoneChart({ series }: { series: Stats["series"] }) {
  const { p, ready } = usePalette();
  if (!ready) return <div className="h-56" />;
  return (
    <div className="h-56 w-full" role="img" aria-label="Chart of tasks completed per day">
      <ResponsiveContainer>
        <ComposedChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: -22 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={dateTick} tick={tick(p)} interval={interval(series.length)} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={tick(p)} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle(p)} labelFormatter={(l) => fmtDateShort(String(l))} />
          <Legend wrapperStyle={{ fontSize: 12, color: p.subtle }} />
          <Bar dataKey="done" name="Tasks done" fill={p.accent} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line type="monotone" dataKey="doneAvg" name="7-day average" stroke={p.amber} strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeekdayChart({ data, metric, label }: { data: Stats["weekday"]; metric: "avgScore" | "avgDone" | "avgHours"; label: string }) {
  const { p, ready } = usePalette();
  if (!ready) return <div className="h-40" />;
  const best = Math.max(...data.map((d) => d[metric] ?? 0));
  return (
    <div className="h-40 w-full" role="img" aria-label={`Bar chart: ${label} by weekday`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 14, right: 4, bottom: 0, left: -26 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="label" tick={tick(p)} axisLine={false} tickLine={false} />
          <YAxis tick={tick(p)} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle(p)} formatter={(v) => [v === null ? "no data" : v, label]} />
          <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={30}>
            {data.map((d) => (
              <Cell key={d.dow} fill={(d[metric] ?? 0) === best && best > 0 ? p.accent : p.accentSoft} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProjectBars({ data, onPick, active }: { data: Stats["hoursByProject"]; onPick: (id: number | null, name: string) => void; active: string | null }) {
  const { p, ready } = usePalette();
  if (!ready) return <div className="h-40" />;
  const rows = data.map((d) => ({ ...d, hours: Math.round((d.minutes / 60) * 100) / 100, key: d.id === null ? "none" : String(d.id) }));
  return (
    <div style={{ height: Math.max(120, rows.length * 38 + 20) }} className="w-full" role="img" aria-label="Bar chart of hours by project">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 30, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={p.grid} horizontal={false} />
          <XAxis type="number" tick={tick(p)} axisLine={false} tickLine={false} unit="h" />
          <YAxis type="category" dataKey="name" width={96} tick={{ ...tick(p), fill: p.ink }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle(p)} formatter={(_v, _n, item) => [fmtDuration((item.payload as { minutes: number }).minutes), "Time"]} cursor={{ fill: p.grid, opacity: 0.4 }} />
          <Bar dataKey="hours" radius={[0, 4, 4, 0]} maxBarSize={22} cursor="pointer" onClick={(d) => onPick((d as unknown as { id: number | null }).id, (d as unknown as { name: string }).name)}>
            {rows.map((r) => (
              <Cell key={r.key} fill={r.color} opacity={active === null || active === r.key ? 1 : 0.4} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StepsChart({ data, goal }: { data: Stats["health"]["stepsPerDay"]; goal: number }) {
  const { p, ready } = usePalette();
  if (!ready) return <div className="h-48" />;
  return (
    <div className="h-48 w-full" role="img" aria-label="Line chart of steps per day against the goal">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={dateTick} tick={tick(p)} interval={interval(data.length)} axisLine={false} tickLine={false} />
          <YAxis tick={tick(p)} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
          <Tooltip contentStyle={tooltipStyle(p)} labelFormatter={(l) => fmtDateShort(String(l))} formatter={(v) => [Number(v).toLocaleString("en-US"), "Steps"]} />
          <ReferenceLine y={goal} stroke={p.amber} strokeDasharray="5 4" label={{ value: "goal", fill: p.amber, fontSize: 11, position: "insideTopRight" }} />
          <Line type="monotone" dataKey="steps" stroke={p.blue} strokeWidth={2.25} dot={{ r: 2.5, fill: p.blue }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SetsChart({ data }: { data: Stats["health"]["setsPerDay"] }) {
  const { p, ready } = usePalette();
  if (!ready) return <div className="h-40" />;
  return (
    <div className="h-40 w-full" role="img" aria-label="Bar chart of exercise sets per day">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={dateTick} tick={tick(p)} interval={interval(data.length)} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={tick(p)} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle(p)} labelFormatter={(l) => fmtDateShort(String(l))} formatter={(v) => [v, "Sets"]} />
          <Bar dataKey="sets" fill={p.accent} radius={[3, 3, 0, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Calendar grid coloured by score (0 to 10), weeks as columns. */
export function Heatmap({ data }: { data: Stats["heatmap"] }) {
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
      <div className="flex gap-1 overflow-x-auto pb-1" role="img" aria-label="Score heatmap by day">
        <div className="flex flex-col gap-1 pr-1 text-[10px] text-subtle">
          {["M", "", "W", "", "F", "", "S"].map((l, i) => (
            <span key={i} className="flex h-4 items-center">{l}</span>
          ))}
        </div>
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {Array.from({ length: 7 }, (_, i) => w[i]).map((c, i) =>
              c ? (
                <span
                  key={i}
                  title={`${fmtDateShort(c.date)}: ${c.score === null ? "no score" : c.score}`}
                  className="h-4 w-4 rounded-[4px]"
                  style={{ background: color(c.score) }}
                />
              ) : (
                <span key={i} className="h-4 w-4" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
        <span>none</span>
        {p.heat.map((c, i) => (
          <span key={i} className="h-3 w-3 rounded-[3px]" style={{ background: c }} />
        ))}
        <span>10</span>
      </div>
    </div>
  );
}
