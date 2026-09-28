"use client";

import { Download } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/cn";
import type { Block } from "@/lib/assistant/types";
import { useCanvasTheme } from "../scratch/canvas-theme";

const human = (c: string) => c.replace(/_/g, " ").replace(/\blocal\b/, "").replace(/\bmin\b/, "(min)").replace(/\bh\b/, "(h)").trim();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtX(v: unknown): string {
  const s = String(v ?? "");
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (d) return `${Number(d[3])} ${MONTHS[Number(d[2]) - 1]}`;
  const dt = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(s);
  if (dt) return `${Number(dt[3])} ${MONTHS[Number(dt[2]) - 1]} ${dt[4]}`;
  return s.length > 22 ? `${s.slice(0, 20)}…` : s;
}

function fmtNum(v: unknown, unit?: string): string {
  if (v === null || v === undefined || v === "") return "–";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  const s = r.toLocaleString("en-IN");
  if (!unit) return s;
  return unit === "%" ? `${s}%` : `${s} ${unit}`;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? "✓" : "–";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "–";
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s) ? fmtX(s) : s;
}

function csv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    // spreadsheet formula injection guard
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = `${name.replace(/[^\w-]+/g, "-").toLowerCase() || "table"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const TONE: Record<string, string> = {
  good: "text-good",
  bad: "text-bad",
  warn: "text-warn",
  neutral: "text-fg",
};

function ChartBlock({ b }: { b: Extract<Block, { type: "chart" }> }) {
  const th = useCanvasTheme();
  if (!th) return <div className="h-64" />;
  const tick = { fill: th.subtle, fontSize: 11 };
  const tip = {
    contentStyle: { background: th.surface, border: `1px solid ${th.border}`, borderRadius: 10, color: th.fg, fontSize: 12, padding: "6px 10px" },
    labelStyle: { color: th.subtle },
    formatter: (v: unknown, name: unknown) => [fmtNum(v, b.unit), human(String(name))] as [string, string],
    labelFormatter: (l: unknown) => fmtX(l),
    cursor: { fill: th.muted, opacity: 0.5 },
  };
  const rows = b.rows;
  const color = (i: number) => th.series[i % th.series.length];
  const legend = b.y.length > 1 ? <Legend formatter={(v) => <span style={{ color: th.subtle, fontSize: 11 }}>{human(String(v))}</span>} /> : null;
  // long category names read better as horizontal bars
  const longLabels = rows.length > 0 && rows.every((r) => typeof r[b.x] === "string" && !/^\d{4}-/.test(String(r[b.x])))
    && rows.reduce((s, r) => s + String(r[b.x]).length, 0) / rows.length > 7;
  const height = b.chart === "pie" ? 260 : longLabels && (b.chart === "bar" || b.chart === "stacked") ? Math.max(180, rows.length * 30 + 40) : 260;
  const axisX = <XAxis dataKey={b.x} tick={tick} tickFormatter={fmtX} axisLine={false} tickLine={false} minTickGap={12} />;
  const axisY = <YAxis tick={tick} width={44} axisLine={false} tickLine={false} tickFormatter={(v) => fmtNum(v)} />;
  const grid = <CartesianGrid stroke={th.border} vertical={false} strokeOpacity={0.6} />;

  let chart: React.ReactElement;
  if (b.chart === "pie") {
    const y = b.y[0];
    chart = (
      <PieChart>
        <Pie data={rows} dataKey={y} nameKey={b.x} innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke={th.surface}>
          {rows.map((_, i) => <Cell key={i} fill={color(i)} />)}
        </Pie>
        <Tooltip {...tip} />
        <Legend formatter={(v) => <span style={{ color: th.subtle, fontSize: 11 }}>{fmtX(v)}</span>} />
      </PieChart>
    );
  } else if (b.chart === "line") {
    chart = (
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}{axisX}{axisY}<Tooltip {...tip} />{legend}
        {b.y.map((y, i) => <Line key={y} dataKey={y} type="monotone" stroke={color(i)} strokeWidth={2.25} dot={rows.length <= 31 ? { r: 2.5 } : false} connectNulls />)}
      </LineChart>
    );
  } else if (b.chart === "area") {
    chart = (
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}{axisX}{axisY}<Tooltip {...tip} />{legend}
        {b.y.map((y, i) => <Area key={y} dataKey={y} type="monotone" stroke={color(i)} fill={color(i)} fillOpacity={0.18} strokeWidth={2} connectNulls />)}
      </AreaChart>
    );
  } else if (longLabels) {
    chart = (
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={th.border} horizontal={false} strokeOpacity={0.6} />
        <XAxis type="number" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => fmtNum(v)} />
        <YAxis type="category" dataKey={b.x} tick={{ ...tick, fill: th.fg }} width={120} axisLine={false} tickLine={false} tickFormatter={fmtX} />
        <Tooltip {...tip} />{legend}
        {b.y.map((y, i) => <Bar key={y} dataKey={y} fill={color(i)} radius={b.chart === "stacked" ? 0 : [0, 4, 4, 0]} stackId={b.chart === "stacked" ? "s" : undefined} maxBarSize={22} />)}
      </BarChart>
    );
  } else {
    chart = (
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}{axisX}{axisY}<Tooltip {...tip} />{legend}
        {b.y.map((y, i) => <Bar key={y} dataKey={y} fill={color(i)} radius={b.chart === "stacked" ? 0 : [4, 4, 0, 0]} stackId={b.chart === "stacked" ? "s" : undefined} maxBarSize={36} />)}
      </BarChart>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{b.title}{b.unit ? <span className="ml-1 normal-case tracking-normal">({b.unit})</span> : null}</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    </div>
  );
}

function TableBlock({ b }: { b: Extract<Block, { type: "table" }> }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          {b.title}
          <span className="ml-1.5 font-normal normal-case tracking-normal">{b.total && b.total > b.rows.length ? `${b.rows.length} of ${b.total}` : `${b.rows.length} rows`}</span>
        </p>
        <button
          onClick={() => download(b.title, csv(b.columns, b.rows))}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-subtle hover:bg-muted hover:text-fg"
          title="Download as CSV"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-subtle shadow-[0_1px_0_hsl(var(--border))]">
            <tr>{b.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-1.5 font-medium capitalize">{human(c)}</th>)}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60 hover:bg-muted/40">
                {b.columns.map((c) => {
                  const v = r[c];
                  return (
                    <td key={c} className={cn("px-3 py-1.5 align-top", typeof v === "number" && "whitespace-nowrap text-right tabular-nums")}>
                      <span className="line-clamp-3">{cellText(v)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Blocks({ blocks, onAsk }: { blocks: Block[]; onAsk?: (q: string) => void }) {
  if (!blocks.length) return null;
  const charts = blocks.filter((b) => b.type === "chart");
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === "stats") {
          return (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {b.items.map((s, j) => (
                <div key={j} className="rounded-2xl border border-border bg-surface px-3 py-2.5">
                  <p className="truncate text-[11px] font-medium uppercase tracking-wide text-subtle">{s.label}</p>
                  <p className={cn("tabular truncate text-xl font-semibold", TONE[s.tone ?? "neutral"])}>{s.value}</p>
                  {s.sub ? <p className="truncate text-xs text-subtle">{s.sub}</p> : null}
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
      {charts.length ? (
        <div className={cn("grid gap-3", charts.length > 1 && "lg:grid-cols-2")}>
          {charts.map((b, i) => <ChartBlock key={i} b={b as Extract<Block, { type: "chart" }>} />)}
        </div>
      ) : null}
      {blocks.map((b, i) => (b.type === "table" ? <TableBlock key={i} b={b} /> : null))}
      {blocks.map((b, i) =>
        b.type === "followups" && onAsk ? (
          <div key={i} className="flex flex-wrap gap-1.5">
            {b.items.map((f) => (
              <button
                key={f}
                onClick={() => onAsk(f)}
                className="rounded-full border border-border bg-surface px-3 py-1 text-left text-xs text-subtle transition-colors hover:border-accent/40 hover:text-fg"
              >
                {f}
              </button>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}
