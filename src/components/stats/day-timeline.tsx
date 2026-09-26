"use client";

import { CalendarClock } from "lucide-react";
import { useMemo, useState } from "react";
import { ACTIVITIES, ACTIVITY, type ActivityKind } from "@/lib/activity";
import { cn } from "@/lib/cn";
import type { TimelineDay, TimelineSpan } from "@/lib/services/stats";
import { fmtDuration, parseDateStr, weekdayName, type DateStr } from "@/lib/time";
import { Card } from "../ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INITIAL_ROWS = 14;

/** "09:30"; minutes may pass midnight (1500 → "01:00"). */
function clock(min: number): string {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function dayLabel(date: DateStr, today: DateStr): { top: string; bottom: string } {
  const { m, d } = parseDateStr(date);
  const top = date === today ? "Today" : weekdayName(date);
  return { top, bottom: `${d} ${MONTHS[m - 1]}` };
}

type Hover = { date: DateStr; i: number } | null;

/**
 * One bar per day, laid out on a shared clock axis, coloured by what each stretch of time was:
 * office, outside, remote, commute, meal, break, exercise, personal. A timeline (Gantt-style) chart.
 */
export function DayTimeline({ days, today }: { days: TimelineDay[]; today: DateStr }) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState<Hover>(null);

  const withData = days.filter((d) => d.spans.length);
  const rows = (hideEmpty ? withData : days).slice(0, all ? undefined : INITIAL_ROWS);
  const hiddenCount = (hideEmpty ? withData : days).length - rows.length;

  // one axis for every row: from the earliest start to the latest end, whole hours, at least 8 hours wide
  const [lo, hi] = useMemo(() => {
    if (!withData.length) return [8 * 60, 20 * 60];
    let a = Infinity;
    let b = -Infinity;
    for (const d of withData) for (const s of d.spans) {
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
  }, [withData]);
  const span = hi - lo;
  const hours = span / 60;
  const step = hours <= 10 ? 1 : hours <= 18 ? 2 : 3;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step * 60) ticks.push(t);
  const pos = (min: number) => ((min - lo) / span) * 100;

  // totals per kind across the whole range
  const totals = useMemo(() => {
    const m = new Map<ActivityKind, number>();
    for (const d of days) for (const s of d.spans) m.set(s.kind, (m.get(s.kind) ?? 0) + (s.endMin - s.startMin));
    return ACTIVITIES.filter((a) => m.get(a.kind)).map((a) => ({ ...a, minutes: m.get(a.kind)! }));
  }, [days]);
  const trackedTotal = totals.reduce((a, t) => a + t.minutes, 0);
  const workTotal = totals.filter((t) => t.work).reduce((a, t) => a + t.minutes, 0);

  const tip = (s: TimelineSpan) =>
    `${ACTIVITY[s.kind].emoji} ${ACTIVITY[s.kind].label} · ${clock(s.startMin)}–${s.open ? "now" : clock(s.endMin)} · ${fmtDuration(s.endMin - s.startMin)}`;

  return (
    <Card className="p-4 sm:col-span-2 xl:col-span-3">
      <div className="mb-3 flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Your days, hour by hour</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <span className="tabular font-display text-2xl leading-tight">{fmtDuration(trackedTotal)}</span>
            <span className="text-xs text-subtle">
              tracked on {withData.length} day{withData.length === 1 ? "" : "s"}
              {trackedTotal ? ` · ${Math.round((workTotal / trackedTotal) * 100)}% of it work` : ""}
            </span>
          </p>
        </div>
        {days.length !== withData.length ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-subtle">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="h-3.5 w-3.5 rounded" />
            Hide {days.length - withData.length} day{days.length - withData.length === 1 ? "" : "s"} with nothing logged
          </label>
        ) : null}
      </div>

      {!withData.length ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <CalendarClock className="mb-2 h-6 w-6 text-subtle" />
          <p className="text-sm font-medium">No time tracked in this range</p>
          <p className="mt-1 max-w-sm text-xs text-subtle">Tap At office, Out on work, Break or More on Today as your day changes, and each day shows up here as a coloured bar.</p>
        </div>
      ) : (
        <>
          {/* how the whole range split up */}
          <div className="mb-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            {totals.map((t) => (
              <div key={t.kind} style={{ width: `${(t.minutes / trackedTotal) * 100}%`, background: t.color }} title={`${t.label} ${fmtDuration(t.minutes)}`} />
            ))}
          </div>
          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
            {totals.map((t) => (
              <li key={t.kind} className="flex items-center gap-1.5 text-xs">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.color }} aria-hidden />
                <span className="font-medium">{t.label}</span>
                <span className="tabular text-subtle">
                  {fmtDuration(t.minutes)} · {Math.round((t.minutes / trackedTotal) * 100)}%
                </span>
              </li>
            ))}
            {days.some((d) => d.spans.some((s) => s.open)) ? (
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

          {/* the chart */}
          <div className="relative">
            {/* hour axis */}
            <div className="flex items-end gap-2 sm:gap-3">
              <div className="w-12 shrink-0 sm:w-16" />
              <div className="relative h-4 flex-1">
                {ticks.map((t, i) => (
                  <span
                    key={t}
                    className={cn(
                      "tabular absolute bottom-0 text-[10px] text-subtle",
                      i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
                    )}
                    style={{ left: `${pos(t)}%` }}
                  >
                    {clock(t)}
                  </span>
                ))}
              </div>
              <div className="w-12 shrink-0 text-right text-[10px] text-subtle sm:w-14">worked</div>
            </div>

            <ul className="mt-1 space-y-1">
              {rows.map((d) => {
                const l = dayLabel(d.date, today);
                return (
                  <li key={d.date} className="flex items-center gap-2 sm:gap-3">
                    <div className="w-12 shrink-0 leading-tight sm:w-16">
                      <span className={cn("block text-xs font-semibold", d.date === today && "text-accent")}>{l.top}</span>
                      <span className="block text-[10px] text-subtle">{l.bottom}</span>
                    </div>
                    <div className="relative h-7 flex-1 rounded-md bg-muted/50" onMouseLeave={() => setHover(null)}>
                      {/* hour grid */}
                      {ticks.slice(1, -1).map((t) => (
                        <span key={t} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${pos(t)}%` }} aria-hidden />
                      ))}
                      {d.spans.map((s, i) => {
                        const on = hover?.date === d.date && hover.i === i;
                        return (
                          <button
                            key={i}
                            type="button"
                            aria-label={tip(s)}
                            onMouseEnter={() => setHover({ date: d.date, i })}
                            onFocus={() => setHover({ date: d.date, i })}
                            onBlur={() => setHover(null)}
                            onClick={() => setHover(on ? null : { date: d.date, i })}
                            className={cn(
                              "absolute inset-y-0.5 rounded-[5px] outline-none ring-offset-1 ring-offset-surface transition-[filter,box-shadow] focus-visible:ring-2 focus-visible:ring-accent",
                              on && "z-10 shadow-[0_0_0_2px_hsl(var(--surface)),0_0_0_3.5px_currentColor] brightness-110",
                            )}
                            style={{
                              left: `${pos(s.startMin)}%`,
                              width: `max(3px, calc(${pos(s.endMin) - pos(s.startMin)}% - 1px))`,
                              background: s.open
                                ? `repeating-linear-gradient(135deg, ${ACTIVITY[s.kind].color} 0 6px, color-mix(in srgb, ${ACTIVITY[s.kind].color} 70%, white) 6px 10px)`
                                : ACTIVITY[s.kind].color,
                              color: ACTIVITY[s.kind].color,
                            }}
                          />
                        );
                      })}
                      {d.spans.length === 0 ? (
                        <span className="absolute inset-0 flex items-center px-2 text-[10px] text-subtle">Nothing logged</span>
                      ) : null}
                      {hover?.date === d.date && d.spans[hover.i] ? (
                        <span
                          role="tooltip"
                          className={cn(
                            "pointer-events-none absolute bottom-full z-20 mb-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium shadow-[var(--shadow-md)]",
                            pos(d.spans[hover.i].startMin) > 60 ? "-translate-x-full" : "",
                          )}
                          style={{
                            left: `${pos(d.spans[hover.i].startMin) > 60 ? pos(d.spans[hover.i].endMin) : pos(d.spans[hover.i].startMin)}%`,
                          }}
                        >
                          {tip(d.spans[hover.i])}
                        </span>
                      ) : null}
                    </div>
                    <span className={cn("tabular w-12 shrink-0 text-right text-xs font-semibold sm:w-14", !d.workedMin && "text-subtle")}>
                      {d.workedMin ? fmtDuration(d.workedMin) : "–"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {hiddenCount > 0 || all ? (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-xs font-medium text-accent hover:underline">
              {all ? "Show fewer days" : `Show ${hiddenCount} more day${hiddenCount === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </>
      )}
    </Card>
  );
}
