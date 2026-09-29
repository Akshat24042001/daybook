"use client";

import { CalendarX2, Pause, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  defaultRepeat, describeRepeat, formatRepeat, nextOccurrences, parseRepeat, repeatProblem, WEEKDAY_NAME, WEEKDAYS,
  type Freq, type Repeat, type Weekday,
} from "@/lib/recurrence";
import { fmtDay, type DateStr } from "@/lib/time";

const FREQS: { f: Freq; label: string; unit: [string, string] }[] = [
  { f: "daily", label: "Daily", unit: ["day", "days"] },
  { f: "weekly", label: "Weekly", unit: ["week", "weeks"] },
  { f: "monthly", label: "Monthly", unit: ["month", "months"] },
  { f: "yearly", label: "Yearly", unit: ["year", "years"] },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NTHS: [number, string][] = [[1, "first"], [2, "second"], [3, "third"], [4, "fourth"], [-1, "last"]];
const WEEKDAYS_ONLY: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

const pill = (on: boolean) =>
  cn(
    "h-9 rounded-xl border px-3 text-sm font-medium transition-colors",
    on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-subtle hover:border-accent/40 hover:text-fg",
  );
const dayChip = (on: boolean) =>
  cn(
    "flex h-9 w-10 items-center justify-center rounded-xl border text-sm font-semibold transition-colors",
    on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-subtle line-through decoration-subtle/40 hover:text-fg",
  );
const label = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-subtle";
const input = "h-9 rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-accent/60";

/**
 * A friendly editor for repeat rules. Everything a calendar can do that a daily-life task needs, without cron:
 * which days, every how many, when it starts and ends, dates to skip, a pause, and what a missed day means.
 */
export function RepeatEditor({
  value, onChange, today, startDefault, workingDays,
}: {
  value: string;
  onChange: (rrule: string, problem: string | null) => void;
  today: DateStr;
  /** anchor for "every n" when the rule has no start date (the task's first day) */
  startDefault: DateStr;
  /** ISO weekdays from Settings, 1 = Monday */
  workingDays?: number[];
}) {
  const [r, setR] = useState<Repeat>(() => parseRepeat(value) ?? defaultRepeat());
  const [exceptDraft, setExceptDraft] = useState("");
  const [ends, setEnds] = useState<"never" | "on" | "after">(r.until ? "on" : r.count ? "after" : "never");

  const update = (patch: Partial<Repeat>) => {
    const next = { ...r, ...patch };
    setR(next);
    onChange(formatRepeat(next), repeatProblem(next));
  };

  const problem = repeatProblem(r);
  const next = useMemo(() => (problem ? [] : nextOccurrences(r, today, 6, startDefault)), [r, today, startDefault, problem]);
  const unit = FREQS.find((x) => x.f === r.freq)!.unit;
  const working = (workingDays ?? [1, 2, 3, 4, 5, 6]).map((n) => WEEKDAYS[n - 1]).filter(Boolean);

  const setFreq = (f: Freq) => {
    const patch: Partial<Repeat> = { freq: f };
    if (f === "weekly" && !r.days.length) patch.days = [WEEKDAYS[(new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7]];
    if (f === "monthly" && !r.monthDays.length && !r.nth) patch.monthDays = [Number(today.slice(8))];
    if (f === "yearly") {
      patch.month = r.month ?? Number(today.slice(5, 7));
      patch.monthDays = r.monthDays.length ? [r.monthDays[0]] : [Number(today.slice(8))];
    }
    update(patch);
  };

  // daily: every day unless some are switched off; weekly: exactly the chosen days
  const dayOn = (w: Weekday) => (r.freq === "daily" ? !r.days.length || r.days.includes(w) : r.days.includes(w));
  const toggleDay = (w: Weekday) => {
    const cur = WEEKDAYS.filter(dayOn);
    const nextDays = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    update({ days: r.freq === "daily" && nextDays.length === 7 ? [] : nextDays });
  };
  const preset = (days: Weekday[]) => update({ days: r.freq === "daily" && days.length === 7 ? [] : days });

  const toggleMonthDay = (d: number) => {
    const has = r.monthDays.includes(d);
    const md = has ? r.monthDays.filter((x) => x !== d) : [...r.monthDays, d].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b));
    update({ monthDays: md, nth: null, nthDay: null });
  };

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-muted/30 p-3.5">
      {/* how often */}
      <div>
        <span className={label}>Repeats</span>
        <div className="flex flex-wrap gap-1.5">
          {FREQS.map((x) => (
            <button key={x.f} type="button" className={pill(r.freq === x.f)} onClick={() => setFreq(x.f)}>{x.label}</button>
          ))}
        </div>
        <label className="mt-2.5 flex items-center gap-2 text-sm">
          Every
          <input
            type="number"
            min={1}
            max={365}
            value={r.interval}
            onChange={(e) => update({ interval: Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))) })}
            className={cn(input, "w-16 text-center tabular-nums")}
            aria-label="Interval"
          />
          {r.interval === 1 ? unit[0] : unit[1]}
          {r.interval > 1 ? <span className="text-xs text-subtle">(counted from the start date)</span> : null}
        </label>
      </div>

      {/* which days */}
      {r.freq === "daily" || r.freq === "weekly" ? (
        <div>
          <span className={label}>{r.freq === "daily" ? "On these days (tap to skip a day)" : "On"}</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w) => (
              <button key={w} type="button" className={dayChip(dayOn(w))} onClick={() => toggleDay(w)} title={WEEKDAY_NAME[w]} aria-pressed={dayOn(w)}>
                {WEEKDAY_NAME[w].slice(0, 2)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {[
              ["Every day", WEEKDAYS],
              ["Weekdays", WEEKDAYS_ONLY],
              ["Weekends", ["SA", "SU"] as Weekday[]],
              ["My working days", working],
              ["Not Sunday", WEEKDAYS.filter((w) => w !== "SU")],
            ].map(([name, days]) => (
              <button key={name as string} type="button" onClick={() => preset(days as Weekday[])} className="rounded-full border border-border bg-surface px-2.5 py-1 text-subtle hover:text-fg">
                {name as string}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {r.freq === "monthly" ? (
        <div className="space-y-2.5">
          <div className="flex gap-1.5">
            <button type="button" className={pill(!r.nth)} onClick={() => update({ nth: null, nthDay: null, monthDays: r.monthDays.length ? r.monthDays : [Number(today.slice(8))] })}>
              On day…
            </button>
            <button type="button" className={pill(!!r.nth)} onClick={() => update({ nth: r.nth ?? 1, nthDay: r.nthDay ?? "MO", monthDays: [] })}>
              On the…
            </button>
          </div>
          {r.nth ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={r.nth} onChange={(e) => update({ nth: Number(e.target.value) })} className={input} aria-label="Which week">
                {NTHS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
              </select>
              <select value={r.nthDay ?? "MO"} onChange={(e) => update({ nthDay: e.target.value as Weekday })} className={input} aria-label="Weekday">
                {WEEKDAYS.map((w) => <option key={w} value={w}>{WEEKDAY_NAME[w]}</option>)}
              </select>
              <span className="text-subtle">of the month</span>
            </div>
          ) : (
            <div className="grid max-w-sm grid-cols-7 gap-1">
              {[...Array.from({ length: 31 }, (_, i) => i + 1), -1].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleMonthDay(d)}
                  className={cn(
                    "h-8 rounded-lg border text-xs font-semibold tabular-nums",
                    r.monthDays.includes(d) ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-subtle hover:text-fg",
                    d === -1 && "col-span-4",
                  )}
                  title={d >= 29 ? "Shorter months use their last day" : undefined}
                >
                  {d === -1 ? "Last day" : d}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {r.freq === "yearly" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-subtle">On</span>
          <select
            value={r.monthDays[0] ?? 1}
            onChange={(e) => update({ monthDays: [Number(e.target.value)] })}
            className={input}
            aria-label="Day"
          >
            {[...Array.from({ length: 31 }, (_, i) => i + 1), -1].map((d) => <option key={d} value={d}>{d === -1 ? "last day" : d}</option>)}
          </select>
          <select value={r.month ?? 1} onChange={(e) => update({ month: Number(e.target.value) })} className={input} aria-label="Month">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      ) : null}

      {/* when it starts and ends */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className={label}>Starts</span>
          <input
            type="date"
            value={r.start ?? startDefault}
            onChange={(e) => update({ start: e.target.value || null })}
            className={cn(input, "w-full")}
          />
        </div>
        <div>
          <span className={label}>Ends</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["never", "on", "after"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={pill(ends === k)}
                onClick={() => {
                  setEnds(k);
                  update(k === "never" ? { until: null, count: null } : k === "on" ? { until: r.until ?? today, count: null } : { until: null, count: r.count ?? 10 });
                }}
              >
                {k === "never" ? "Never" : k === "on" ? "On" : "After"}
              </button>
            ))}
          </div>
          {ends === "on" ? (
            <input type="date" value={r.until ?? ""} min={r.start ?? startDefault} onChange={(e) => update({ until: e.target.value || null })} className={cn(input, "mt-2 w-full")} />
          ) : ends === "after" ? (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="number"
                min={1}
                max={5000}
                value={r.count ?? 10}
                onChange={(e) => update({ count: Math.max(1, Math.min(5000, Math.round(Number(e.target.value) || 1))) })}
                className={cn(input, "w-20 text-center tabular-nums")}
              />
              times
            </label>
          ) : null}
        </div>
      </div>

      {/* a missed day */}
      <div>
        <span className={label}>If I miss a day</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ["skip", "Let it go", "It comes back next time. No carry, no penalty. Right for habits and routines."],
            ["carry", "Keep it until done", "It stays on your list day after day and counts as carried. Right for bills and deadlines."],
          ] as const).map(([k, title, hint]) => (
            <button
              key={k}
              type="button"
              onClick={() => update({ missed: k })}
              className={cn("rounded-xl border p-2.5 text-left transition-colors", r.missed === k ? "border-accent bg-accent-muted" : "border-border bg-surface hover:bg-muted")}
            >
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-xs text-subtle">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* exceptions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className={label}><CalendarX2 className="mr-1 inline h-3.5 w-3.5" />Skip specific dates</span>
          <div className="flex gap-1.5">
            <input type="date" value={exceptDraft} min={today} onChange={(e) => setExceptDraft(e.target.value)} className={cn(input, "flex-1")} />
            <button
              type="button"
              disabled={!exceptDraft}
              onClick={() => {
                if (exceptDraft && !r.except.includes(exceptDraft)) update({ except: [...r.except, exceptDraft].sort() });
                setExceptDraft("");
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-subtle hover:text-fg disabled:opacity-40"
              aria-label="Add date to skip"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {r.except.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {r.except.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-subtle">
                  {fmtDay(d, today)}
                  <button type="button" onClick={() => update({ except: r.except.filter((x) => x !== d) })} aria-label={`Stop skipping ${d}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <span className={label}><Pause className="mr-1 inline h-3.5 w-3.5" />Pause until (travel, illness)</span>
          <div className="flex gap-1.5">
            <input type="date" value={r.pauseUntil ?? ""} min={today} onChange={(e) => update({ pauseUntil: e.target.value || null })} className={cn(input, "flex-1")} />
            {r.pauseUntil ? (
              <button type="button" onClick={() => update({ pauseUntil: null })} className="rounded-xl border border-border bg-surface px-2.5 text-xs text-subtle hover:text-fg">
                Resume
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* what it means */}
      <div className="rounded-xl bg-surface p-3">
        {problem ? (
          <p className="text-sm text-bad">{problem}</p>
        ) : (
          <>
            <p className="text-sm font-semibold">{describeRepeat(r)}</p>
            <p className="mt-1 text-xs text-subtle">
              {next.length ? <>Next: {next.map((d) => fmtDay(d, today)).join(" · ")}</> : "No upcoming dates with these settings."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
