"use client";

import { CalendarClock } from "lucide-react";
import { useMemo, useState } from "react";
import { ACTIVITIES, ACTIVITY, type ActivityKind } from "@/lib/activity";
import { cn } from "@/lib/cn";
import type { TimelineDay, TimelineSpan } from "@/lib/services/stats";
import { fmtDuration, parseDateStr, weekdayName, type DateStr } from "@/lib/time";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INITIAL_ROWS = 14;

/** "09:30"; minutes may pass midnight (1500 → "01:00"). */
function clock(min: number): string {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function dayLabel(date: DateStr, today: DateStr): { top: string; bottom: string } {
  const { m, d } = parseDateStr(date);
  return { top: date === today ? "Today" : weekdayName(date), bottom: `${d} ${MONTHS[m - 1]}` };
}

const tip = (s: TimelineSpan) =>
  `${ACTIVITY[s.kind].emoji} ${ACTIVITY[s.kind].label} · ${clock(s.startMin)}–${s.open ? "now" : clock(s.endMin)} · ${fmtDuration(s.endMin - s.startMin)}`;

/** Range-wide numbers for the tile header and the dialog. */
export function timelineTotals(days: TimelineDay[]) {
  const m = new Map<ActivityKind, number>();
  for (const d of days) for (const s of d.spans) m.set(s.kind, (m.get(s.kind) ?? 0) + (s.endMin - s.startMin));
  const kinds = ACTIVITIES.filter((a) => m.get(a.kind)).map((a) => ({ ...a, minutes: m.get(a.kind)! }));
  const tracked = kinds.reduce((a, t) => a + t.minutes, 0);
  const work = kinds.filter((t) => t.work).reduce((a, t) => a + t.minutes, 0);
  const daysWithData = days.filter((d) => d.spans.length).length;
  return { kinds, tracked, work, daysWithData, workPct: tracked ? Math.round((work / tracked) * 100) : null };
}

type Hover = { date: DateStr; i: number } | null;

/**
 * One bar per day on a shared clock axis, coloured by what each stretch of time was (a timeline / Gantt-style chart).
 * `height` makes it a dashboard tile: thin rows, as many recent days as fit, one-line legend.
 * Without it, it is the full view for the details dialog.
 */
export function DayTimeline({ days, today, height }: { days: TimelineDay[]; today: DateStr; height?: number }) {
  const compact = height !== undefined;
  const [hideEmpty, setHideEmpty] = useState(true);
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState<Hover>(null);

  const withData = useMemo(() => days.filter((d) => d.spans.length), [days]);
  const totals = useMemo(() => timelineTotals(days), [days]);

  // every row is exactly LINE tall (label and bar both fit inside), so the tile can never grow past `height`:
  // compact = 12px axis + 4px + rows + 16px legend line
  const BAR = compact ? 8 : 24;
  const LINE = compact ? 12 : 30;
  const GAP = compact ? 2 : 4;
  const fit = compact ? Math.max(3, Math.floor((height - 12 - 4 - 16 - 4 + GAP) / (LINE + GAP))) : INITIAL_ROWS;
  const pool = compact || hideEmpty ? withData : days;
  const rows = pool.slice(0, compact || !all ? fit : undefined);
  const hiddenCount = pool.length - rows.length;

  // one axis for every row: earliest start to latest end in whole hours, at least 8 hours wide
  const [lo, hi] = (() => {
    const src = compact ? rows : withData;
    if (!src.length) return [8 * 60, 20 * 60];
    let a = Infinity;
    let b = -Infinity;
    for (const d of src) for (const s of d.spans) {
      a = Math.min(a, s.startMin);
      b = Math.max(b, s.endMin);
    }
    let l = Math.floor(a / 60) * 60;
    let h = Math.ceil(b / 60) * 60;
    if (h - l < 8 * 60) {
      const pad = Math.ceil((8 * 60 - (h - l)) / 120) * 60;
      l = Math.max(0, l - pad);
      h = l + Math.max(8 * 60, h - l + pad);
    }
    return [l, h];
  })();
  const span = hi - lo;
  const hours = span / 60;
  const step = compact ? (hours <= 9 ? 2 : hours <= 15 ? 3 : 4) : hours <= 10 ? 1 : hours <= 18 ? 2 : 3;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step * 60) ticks.push(t);
  const pos = (min: number) => ((min - lo) / span) * 100;

  const labelW = compact ? "w-9" : "w-12 sm:w-16";
  // wide enough for "10h 09m" on one line; a wrapped label made rows taller than the tile
  const workedW = compact ? "w-11 whitespace-nowrap" : "w-14 whitespace-nowrap";

  if (!withData.length) {
    return compact ? (
      <div style={{ height }} className="flex items-center justify-center text-center text-xs text-subtle">
        No time tracked in this range
      </div>
    ) : (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-8 text-center">
        <CalendarClock className="mb-2 h-6 w-6 text-subtle" />
        <p className="text-sm font-medium">No time tracked in this range</p>
        <p className="mt-1 max-w-sm text-xs text-subtle">
          Tap At office, Out on work, Break or More on Today as your day changes, and each day shows up here as a coloured bar.
        </p>
      </div>
    );
  }

  // one readout line instead of a floating tooltip, which could run off a phone screen
  const hovered = hover ? rows.find((d) => d.date === hover.date)?.spans[hover.i] : undefined;
  const readout = (
    <p className={cn("h-4 truncate leading-4 font-medium", compact ? "text-[10px]" : "text-xs")} aria-live="polite">
      {hovered ? tip(hovered) : <span className="font-normal text-subtle">Hover or tap a bar to see its times</span>}
    </p>
  );

  const legend = (
    <ul className={cn("flex min-w-0 flex-wrap gap-x-3 gap-y-1", compact && "h-4 overflow-hidden")} aria-label="Legend">
      {totals.kinds.map((t) => (
        <li key={t.kind} className={cn("flex shrink-0 items-center gap-1", compact ? "text-[10px]" : "text-xs")}>
          <span className="h-2 w-2 rounded-sm" style={{ background: t.color }} aria-hidden />
          <span className={compact ? "text-subtle" : "font-medium"}>{compact ? t.short : t.label}</span>
          {!compact ? (
            <span className="tabular text-subtle">
              {fmtDuration(t.minutes)} · {Math.round((t.minutes / totals.tracked) * 100)}%
            </span>
          ) : null}
        </li>
      ))}
      {!compact && days.some((d) => d.spans.some((s) => s.open)) ? (
        <li className="flex items-center gap-1.5 text-xs text-subtle">
          <span
            className="h-2.5 w-4 rounded-sm"
            style={{ background: "repeating-linear-gradient(135deg, hsl(var(--subtle)) 0 3px, hsl(var(--subtle) / 0.35) 3px 5px)" }}
            aria-hidden
          />
          Striped = still running
        </li>
      ) : null}
    </ul>
  );

  return (
    <div style={compact ? { height } : undefined} className={cn("min-w-0", compact && "flex flex-col justify-between overflow-hidden")}>
      {!compact ? (
        <>
          {/* how the whole range split up */}
          <div className="mb-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            {totals.kinds.map((t) => (
              <div key={t.kind} style={{ width: `${(t.minutes / totals.tracked) * 100}%`, background: t.color }} />
            ))}
          </div>
          <div className="mb-4">{legend}</div>
          {days.length !== withData.length ? (
            <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-subtle">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="h-3.5 w-3.5 rounded" />
              Hide {days.length - withData.length} day{days.length - withData.length === 1 ? "" : "s"} with nothing logged
            </label>
          ) : null}
          <div className="mb-1">{readout}</div>
        </>
      ) : null}

      <div className="min-w-0">
        {/* hour axis */}
        <div className="flex items-end gap-2">
          <div className={cn(labelW, "shrink-0")} />
          <div className={cn("relative flex-1", compact ? "h-3" : "h-4")}>
            {ticks.map((t, i) => (
              <span
                key={t}
                className={cn(
                  "tabular absolute bottom-0 leading-none text-subtle",
                  compact ? "text-[9px]" : "text-[10px]",
                  i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{ left: `${pos(t)}%` }}
              >
                {compact ? clock(t).slice(0, 2) : clock(t)}
              </span>
            ))}
          </div>
          <div className={cn(workedW, "shrink-0 text-right leading-none text-subtle", compact ? "text-[9px]" : "text-[10px]")}>worked</div>
        </div>

        <ul className="mt-1" style={{ display: "grid", rowGap: GAP }}>
          {rows.map((d) => {
            const l = dayLabel(d.date, today);
            return (
              <li key={d.date} className="flex min-w-0 items-center gap-2" style={{ height: LINE }}>
                <div className={cn(labelW, "shrink-0", compact ? "leading-none" : "leading-tight")}>
                  {compact ? (
                    <span className={cn("block truncate text-[10px]", d.date === today ? "font-semibold text-accent" : "text-subtle")} title={l.bottom}>
                      {l.top === "Today" ? "Today" : `${l.top.slice(0, 2)} ${parseDateStr(d.date).d}`}
                    </span>
                  ) : (
                    <>
                      <span className={cn("block text-xs font-semibold", d.date === today && "text-accent")}>{l.top}</span>
                      <span className="block text-[10px] text-subtle">{l.bottom}</span>
                    </>
                  )}
                </div>
                <div
                  className={cn("relative flex-1 bg-muted/60", compact ? "rounded-sm" : "rounded-md")}
                  style={{ height: BAR }}
                  onMouseLeave={() => setHover(null)}
                >
                  {!compact
                    ? ticks.slice(1, -1).map((t) => (
                        <span key={t} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${pos(t)}%` }} aria-hidden />
                      ))
                    : null}
                  {d.spans.map((s, i) => {
                    const on = hover?.date === d.date && hover.i === i;
                    const c = ACTIVITY[s.kind].color;
                    return (
                      <button
                        key={i}
                        type="button"
                        aria-label={tip(s)}
                        onMouseEnter={() => setHover({ date: d.date, i })}
                        onFocus={() => setHover({ date: d.date, i })}
                        onBlur={() => setHover(null)}
                        onClick={(e) => {
                          e.stopPropagation(); // inside a tile: show the tooltip, do not open the dialog
                          setHover(on ? null : { date: d.date, i });
                        }}
                        className={cn(
                          "absolute outline-none transition-[filter] focus-visible:ring-2 focus-visible:ring-accent",
                          compact ? "inset-y-0 rounded-[2px]" : "inset-y-0.5 rounded-[5px]",
                          on && "z-10 brightness-110",
                        )}
                        style={{
                          left: `${pos(s.startMin)}%`,
                          width: `max(2px, calc(${pos(s.endMin) - pos(s.startMin)}% - 1px))`,
                          background: s.open
                            ? `repeating-linear-gradient(135deg, ${c} 0 ${compact ? 3 : 6}px, color-mix(in srgb, ${c} 65%, white) ${compact ? 3 : 6}px ${compact ? 5 : 10}px)`
                            : c,
                        }}
                      />
                    );
                  })}
                  {d.spans.length === 0 ? (
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] text-subtle">Nothing logged</span>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "tabular shrink-0 text-right",
                    workedW,
                    compact ? "text-[10px] font-medium" : "text-xs font-semibold",
                    !d.workedMin && "text-subtle",
                  )}
                >
                  {d.workedMin ? fmtDuration(d.workedMin) : "–"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {compact ? (hovered ? readout : legend) : null}

      {!compact && (hiddenCount > 0 || all) ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-xs font-medium text-accent hover:underline">
          {all ? "Show fewer days" : `Show ${hiddenCount} more day${hiddenCount === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </div>
  );
}
