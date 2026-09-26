"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, ChevronRight, Info, Lightbulb, Maximize2, Minus,
  SlidersHorizontal, Sparkles, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import type { DiarySummaryView } from "@/lib/services/diary";
import type { Stats, TimelineDay } from "@/lib/services/stats";
import { fmtDay, fmtDuration, fmtRange, type DateStr } from "@/lib/time";
import { ratingTone } from "@/lib/rating-tone";
import { SummaryCard } from "../diary/diary-panel";
import { Card, Input, Progress, Select } from "../ui";
import { Heatmap, ProjectBars, TrendChart, WeekdayChart } from "./charts";
import { DayTimeline } from "./day-timeline";

const TYPE_OPTIONS = [
  ["one_off", "One-off"], ["ongoing", "Ongoing"], ["follow_up", "Follow-up"], ["cadence", "Cadence"],
  ["recurring", "Recurring"], ["someday", "Someday"], ["target", "Target"],
] as const;

const TILE_H = 150;
const BIG_H = 300;

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const avgOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// ------------------------------------------------------------------ building blocks

function Delta({ cur, prev, unit = "", digits = 1, lowerIsBetter = false, neutral = false }: {
  cur: number | null; prev: number | null; unit?: string; digits?: number; lowerIsBetter?: boolean; neutral?: boolean;
}) {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-subtle"><Minus className="h-2.5 w-2.5" />same</span>;
  }
  const good = neutral ? null : lowerIsBetter ? d < 0 : d > 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title="Change against the previous period of the same length"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        good === null ? "bg-muted text-subtle" : good ? "bg-good-muted text-good" : "bg-bad-muted text-bad",
      )}
    >
      <Icon className="h-2.5 w-2.5" />{Math.abs(d).toFixed(digits)}{unit}
    </span>
  );
}

/** A chart card: headline number in the header, chart below, click anywhere for the detail dialog. */
function Tile({
  title, value, delta, sub, warn, onOpen, children, className, action,
}: {
  title: string;
  value?: React.ReactNode;
  delta?: React.ReactNode;
  sub?: React.ReactNode;
  warn?: boolean;
  onOpen: () => void;
  children: React.ReactNode;
  className?: string;
  /** controls inside the header that must not open the dialog */
  action?: React.ReactNode;
}) {
  return (
    // a plain container: clicking anywhere opens details with a mouse; keyboard and screen readers use the button
    <Card
      onClick={onOpen}
      className={cn(
        "group flex cursor-pointer flex-col p-4 transition-all hover:border-accent/40 hover:shadow-[var(--shadow-md)]",
        warn && "border-warn/40",
        className,
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{title}</p>
          {value !== undefined ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cn("tabular font-display text-2xl leading-tight", warn && "text-warn")}>{value}</span>
              {delta}
              {sub ? <span className="truncate text-xs text-subtle">{sub}</span> : null}
            </div>
          ) : null}
        </div>
        {action ? <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{action}</div> : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`${title}: open details`}
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-subtle opacity-50 transition-opacity hover:bg-muted hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

function MiniStat({ label, value, hint, warn, good, onOpen }: {
  label: string; value: string; hint?: React.ReactNode; warn?: boolean; good?: boolean; onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-2xl border border-border bg-surface px-4 py-3 text-left shadow-[var(--shadow-sm)] transition-all hover:border-accent/40 hover:shadow-[var(--shadow-md)]"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</span>
      <span className={cn("tabular font-display text-xl leading-tight", warn && "text-warn", good && "text-good")}>{value}</span>
      {hint ? <span className="mt-0.5 truncate text-[11px] text-subtle">{hint}</span> : null}
    </button>
  );
}

function ListTile({ title, count, empty, onOpen, children }: {
  title: string; count: number; empty: string; onOpen: () => void; children: React.ReactNode;
}) {
  return (
    <Card onClick={onOpen} className="group flex cursor-pointer flex-col p-4 transition-all hover:border-accent/40 hover:shadow-[var(--shadow-md)]">
      <div className="mb-2 flex items-center gap-2">
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">{title}</p>
        {count > 0 ? <span className="tabular rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">{count}</span> : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`${title}: show all`}
          className="rounded-lg p-0.5 text-subtle hover:bg-muted hover:text-fg"
        >
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
      </div>
      {count === 0 ? <p className="text-sm text-subtle">{empty}</p> : <div className="space-y-2">{children}</div>}
    </Card>
  );
}

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <p className="text-[11px] text-subtle">{label}</p>
      <p className={cn("tabular text-base font-semibold", tone === "good" && "text-good", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</p>
    </div>
  );
}

function Facts({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="flex gap-2 rounded-xl border border-border px-3 py-2 text-xs leading-relaxed text-subtle"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{children}</p>;
}

function DetailDialog({ open, onClose, title, subtitle, children }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet-content fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 pb-safe shadow-[var(--shadow-lg)] sm:bottom-auto sm:top-[6vh] sm:rounded-3xl sm:p-6"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-xl leading-tight">{title}</Dialog.Title>
              {subtitle ? <p className="mt-0.5 text-sm text-subtle">{subtitle}</p> : null}
            </div>
            <Dialog.Close className="-mr-1 -mt-1 rounded-full p-2 text-subtle hover:bg-muted hover:text-fg" aria-label="Close">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <div className="space-y-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ------------------------------------------------------------------ page

type Panel =
  | "score" | "hours" | "done" | "unaccounted" | "projects" | "consistency" | "weekday" | "steps" | "exercise" | "sleep" | "diary"
  | "completion" | "mustdo" | "logged" | "planstreak" | "mustdostreak"
  | "rotting" | "estimates" | "cadence" | "progress" | "attention" | "insights";

export function StatsView({
  stats, range, projects, people, vias, drill, today, diary, timeline,
}: {
  stats: Stats;
  timeline: TimelineDay[];
  range: "7" | "30" | "90" | "custom";
  projects: { id: number; name: string }[];
  people: { id: number; name: string }[];
  vias: string[];
  drill: string | null;
  today: DateStr;
  diary: DiarySummaryView[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const [showFilters, setShowFilters] = useState(false);
  const [open, setOpen] = useState<Panel | null>(null);
  const [weekdayMetric, setWeekdayMetric] = useState<"avgScore" | "avgDone" | "avgHours">("avgScore");
  const { current: cur, previous: prev } = stats.summary;
  const f = stats.filters;
  const series = stats.series;

  function setParam(next: Record<string, string | null>) {
    const sp = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    start(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  const d = useMemo(() => {
    const scored = series.filter((s) => s.score !== null);
    const best = scored.reduce<(typeof series)[number] | null>((b, s) => (!b || (s.score ?? 0) > (b.score ?? 0) ? s : b), null);
    const worst = scored.reduce<(typeof series)[number] | null>((b, s) => (!b || (s.score ?? 11) < (b.score ?? 11) ? s : b), null);
    const worked = series.filter((s) => s.hours > 0);
    const longest = worked.reduce<(typeof series)[number] | null>((b, s) => (!b || s.hours > b.hours ? s : b), null);
    const busiest = series.reduce<(typeof series)[number] | null>((b, s) => (!b || s.done > b.done ? s : b), null);
    const overTarget = series.filter((s) => (s.unaccountedPct ?? 0) > 20).length;
    const steps = stats.health.stepsPerDay;
    const stepAvg = avgOf(steps.map((s) => s.steps));
    const stepHit = steps.filter((s) => (s.steps ?? 0) >= stats.health.stepGoal).length;
    const stepDays = steps.filter((s) => s.steps !== null).length;
    const setsTotal = stats.health.setsPerDay.reduce((a, s) => a + s.sets, 0);
    const setDays = stats.health.setsPerDay.filter((s) => s.sets > 0).length;
    const bestDow = stats.weekday.reduce<(typeof stats.weekday)[number] | null>((b, w) => (w.avgScore !== null && (!b || (w.avgScore ?? 0) > (b.avgScore ?? 0)) ? w : b), null);
    const worstDow = stats.weekday.reduce<(typeof stats.weekday)[number] | null>((b, w) => (w.avgScore !== null && (!b || (w.avgScore ?? 11) < (b.avgScore ?? 11)) ? w : b), null);
    const byDate = new Map(diary.map((s) => [s.date, s.rating]));
    const diarySeries = series.map((s) => ({ date: s.date, rating: byDate.get(s.date) ?? null }));
    const diaryAvg = avgOf(diary.map((s) => s.rating));
    const sleep = stats.health.sleepPerDay;
    const sleepNights = sleep.filter((n) => n.hours !== null);
    const sleepAvg = avgOf(sleep.map((n) => n.hours));
    const sleepQ = avgOf(sleep.map((n) => n.quality));
    const shortNights = sleepNights.filter((n) => (n.hours ?? 0) < 7).length;
    const bestNight = sleepNights.reduce<(typeof sleep)[number] | null>((b, n) => (!b || (n.hours ?? 0) > (b.hours ?? 0) ? n : b), null);
    const worstNight = sleepNights.reduce<(typeof sleep)[number] | null>((b, n) => (!b || (n.hours ?? 99) < (b.hours ?? 99) ? n : b), null);
    return { scored, best, worst, worked, longest, busiest, overTarget, stepAvg, stepHit, stepDays, setsTotal, setDays, bestDow, worstDow, diarySeries, diaryAvg, sleepNights, sleepAvg, sleepQ, shortNights, bestNight, worstNight };
  }, [series, stats, diary]);

  const activeFilters = [
    f.project ? { k: "project", label: f.project === "none" ? "No project" : projects.find((p) => String(p.id) === f.project)?.name ?? "Project" } : null,
    f.type ? { k: "type", label: TYPE_OPTIONS.find(([v]) => v === f.type)?.[1] ?? f.type } : null,
    f.scope && f.scope !== "all" ? { k: "scope", label: f.scope === "work" ? "Work only" : "Personal only" } : null,
    f.person ? { k: "person", label: people.find((p) => p.id === f.person)?.name ?? "Person" } : null,
    f.via ? { k: "via", label: `via ${f.via}` } : null,
  ].filter((x): x is { k: string; label: string } => x !== null);

  const drillName = drill === "none" ? "No project" : projects.find((p) => String(p.id) === drill)?.name ?? null;
  const drillByDate = new Map<string, typeof stats.drill>();
  for (const r of stats.drill) drillByDate.set(r.date, [...(drillByDate.get(r.date) ?? []), r]);
  const highAttention = stats.attention.filter((a) => a.severity !== "info").length;
  const latestDiary = diary[0] ?? null;
  const unaccountedWarn = (cur.unaccountedPct ?? 0) > 20;
  const periodLabel = fmtRange(f.from, f.to);
  const prevLabel = fmtRange(stats.previousRange.from, stats.previousRange.to);
  const close = () => {
    if (open === "projects" && drill) setParam({ drill: null });
    setOpen(null);
  };

  return (
    <div className={cn("space-y-4 transition-opacity", pending && "opacity-70")}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="mr-auto flex items-baseline gap-3">
          <h1 className="font-display text-2xl">Stats</h1>
          <span className="text-sm text-subtle" title={`Compared with ${prevLabel}`}>{periodLabel}</span>
        </div>

        {stats.attention.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen("attention")}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors",
              highAttention ? "bg-warn-muted text-warn hover:bg-warn/20" : "bg-muted text-subtle hover:text-fg",
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" /> {stats.attention.length} to look at
          </button>
        ) : null}
        {stats.insights.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen("insights")}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent-muted px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
          >
            <Lightbulb className="h-3.5 w-3.5" /> {stats.insights.length} insight{stats.insights.length === 1 ? "" : "s"}
          </button>
        ) : null}

        <div className="inline-flex h-9 rounded-xl bg-muted p-0.5" role="group" aria-label="Date range">
          {(["7", "30", "90", "custom"] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setParam(r === "custom" ? { range: "custom", from: f.from, to: f.to } : { range: r, from: null, to: null })}
              className={cn("rounded-[10px] px-3 text-xs font-semibold transition-colors", range === r ? "bg-surface text-fg shadow-sm" : "text-subtle hover:text-fg")}
            >
              {r === "custom" ? "Custom" : `${r}d`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors",
            showFilters || activeFilters.length ? "border-accent/50 bg-accent-muted text-accent" : "border-border bg-surface text-subtle hover:text-fg",
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
          {activeFilters.length ? <span className="tabular rounded-full bg-accent px-1.5 text-[10px] text-accent-fg">{activeFilters.length}</span> : null}
        </button>
      </div>

      {range === "custom" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={f.from} max={today} onChange={(e) => e.target.value && setParam({ from: e.target.value })} className="h-9 w-[9rem] text-xs" aria-label="From" />
          <span className="text-xs text-subtle">to</span>
          <Input type="date" value={f.to} max={today} onChange={(e) => e.target.value && setParam({ to: e.target.value })} className="h-9 w-[9rem] text-xs" aria-label="To" />
        </div>
      ) : null}

      {showFilters ? (
        <Card className="p-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Select aria-label="Project" value={f.project ?? ""} onChange={(e) => setParam({ project: e.target.value, drill: null })} className="h-9 text-xs">
              <option value="">All projects</option>
              <option value="none">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select aria-label="Type" value={f.type ?? ""} onChange={(e) => setParam({ type: e.target.value })} className="h-9 text-xs">
              <option value="">All types</option>
              {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select aria-label="Scope" value={f.scope ?? "all"} onChange={(e) => setParam({ scope: e.target.value === "all" ? null : e.target.value })} className="h-9 text-xs">
              <option value="all">Work + personal</option>
              <option value="work">Work only</option>
              <option value="personal">Personal only</option>
            </Select>
            <Select aria-label="Person" value={f.person ? String(f.person) : ""} onChange={(e) => setParam({ person: e.target.value })} className="h-9 text-xs">
              <option value="">Anyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select aria-label="Source" value={f.via ?? ""} onChange={(e) => setParam({ via: e.target.value })} className="h-9 text-xs">
              <option value="">Any source</option>
              {vias.map((v) => <option key={v} value={v}>via {v}</option>)}
            </Select>
          </div>
          <p className="mt-2 text-[11px] text-subtle">Filters narrow the task numbers. Score, hours worked and unaccounted time always cover whole days.</p>
        </Card>
      ) : null}

      {activeFilters.length && !showFilters ? (
        <div className="flex flex-wrap gap-1.5">
          {activeFilters.map((a) => (
            <button
              key={a.k}
              type="button"
              onClick={() => setParam({ [a.k]: null })}
              className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20"
            >
              {a.label} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Charts ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          title="Day score"
          value={cur.avgScore === null ? "–" : cur.avgScore.toFixed(1)}
          delta={<Delta cur={cur.avgScore} prev={prev.avgScore} />}
          sub="avg / 10"
          onOpen={() => setOpen("score")}
        >
          <TrendChart data={series} y="score" avg="scoreAvg" kind="line" name="Score" height={TILE_H} domain={[0, 10]} />
        </Tile>
        <Tile
          title="Hours worked"
          value={cur.avgWorkedHours === null ? "–" : `${cur.avgWorkedHours.toFixed(1)}h`}
          delta={<Delta cur={cur.avgWorkedHours} prev={prev.avgWorkedHours} unit="h" neutral />}
          sub={`per day · ${Math.round(cur.totalWorkedHours)}h total`}
          onOpen={() => setOpen("hours")}
        >
          <TrendChart data={series} y="hours" avg="hoursAvg" kind="bar" name="Hours" unit="h" height={TILE_H} />
        </Tile>
        <Tile
          title="Tasks done"
          value={String(cur.tasksDone)}
          delta={<Delta cur={cur.tasksDone} prev={prev.tasksDone} digits={0} />}
          sub={cur.tasksPerHour === null ? undefined : `${cur.tasksPerHour.toFixed(2)} per worked hour`}
          onOpen={() => setOpen("done")}
        >
          <TrendChart data={series} y="done" avg="doneAvg" kind="bar" name="Done" height={TILE_H} />
        </Tile>

        <DayTimeline days={timeline} today={today} />

        <Tile
          title="Unaccounted time"
          value={cur.unaccountedPct === null ? "–" : `${Math.round(cur.unaccountedPct)}%`}
          delta={<Delta cur={cur.unaccountedPct} prev={prev.unaccountedPct} unit="pt" digits={0} lowerIsBetter />}
          sub="target under 20%"
          warn={unaccountedWarn}
          onOpen={() => setOpen("unaccounted")}
        >
          <TrendChart data={series} y="unaccountedPct" kind="bar" name="Unaccounted" unit="%" height={TILE_H} domain={[0, 100]} target={{ value: 20, label: "20% target" }} flag="over" />
        </Tile>
        <Tile
          title="Hours by project"
          value={fmtDuration(stats.totals.minutes)}
          sub={stats.hoursByProject.length ? `across ${stats.hoursByProject.length} project${stats.hoursByProject.length === 1 ? "" : "s"}` : undefined}
          onOpen={() => setOpen("projects")}
        >
          {stats.hoursByProject.length === 0 ? (
            <div style={{ height: TILE_H }} className="flex items-center justify-center text-xs text-subtle">No minutes logged on tasks</div>
          ) : (
            <ProjectBars data={stats.hoursByProject} limit={5} height={TILE_H} onPick={(key) => { setParam({ drill: key }); setOpen("projects"); }} />
          )}
        </Tile>
        <Tile
          title="Consistency"
          value={`${d.scored.length}/${series.length}`}
          sub="days scored"
          onOpen={() => setOpen("consistency")}
        >
          <div style={{ minHeight: TILE_H }} className="flex flex-wrap items-center gap-4">
            <Heatmap data={stats.heatmap} cell={series.length > 100 ? 8 : series.length > 42 ? 13 : 17} />
            <div className="space-y-1.5 text-xs">
              <p className="text-subtle">Best day <span className="block text-sm font-semibold text-fg">{d.best ? `${fmtDay(d.best.date)} · ${d.best.score}` : "–"}</span></p>
              <p className="text-subtle">Best weekday <span className="block text-sm font-semibold text-fg">{d.bestDow ? `${d.bestDow.label} · ${d.bestDow.avgScore}` : "–"}</span></p>
            </div>
          </div>
        </Tile>

        <Tile
          title="Weekday patterns"
          onOpen={() => setOpen("weekday")}
          action={
            <div className="inline-flex rounded-lg bg-muted p-0.5">
              {([["avgScore", "Score"], ["avgDone", "Tasks"], ["avgHours", "Hours"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWeekdayMetric(k)}
                  className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", weekdayMetric === k ? "bg-surface text-fg shadow-sm" : "text-subtle hover:text-fg")}
                >
                  {l}
                </button>
              ))}
            </div>
          }
        >
          <WeekdayChart
            data={stats.weekday}
            metric={weekdayMetric}
            label={weekdayMetric === "avgScore" ? "Average score" : weekdayMetric === "avgDone" ? "Tasks done" : "Hours worked"}
            height={TILE_H + 28}
          />
        </Tile>
        <Tile
          title="Steps"
          value={d.stepAvg === null ? "–" : Math.round(d.stepAvg).toLocaleString("en-US")}
          sub={`avg · goal hit ${d.stepHit}/${d.stepDays || 0} days`}
          onOpen={() => setOpen("steps")}
        >
          <TrendChart data={stats.health.stepsPerDay} y="steps" kind="bar" name="Steps" unit="k" height={TILE_H} color="blue" target={{ value: stats.health.stepGoal, label: "goal" }} flag="under" fmt={(v) => Math.round(v).toLocaleString("en-US")} />
        </Tile>
        <Tile
          title="Exercise"
          value={String(d.setsTotal)}
          sub={`sets · active ${d.setDays} day${d.setDays === 1 ? "" : "s"}`}
          onOpen={() => setOpen("exercise")}
        >
          <TrendChart data={stats.health.setsPerDay} y="sets" kind="bar" name="Sets" height={TILE_H} />
        </Tile>

        <Tile
          title="Sleep"
          value={d.sleepAvg === null ? "–" : `${d.sleepAvg.toFixed(1)}h`}
          sub={d.sleepNights.length ? `avg · ${d.shortNights} night${d.shortNights === 1 ? "" : "s"} under 7h` : "log sleep on Today"}
          warn={d.sleepAvg !== null && d.sleepAvg < 6.5}
          onOpen={() => setOpen("sleep")}
        >
          <TrendChart data={stats.health.sleepPerDay} y="hours" kind="bar" name="Sleep" unit="h" height={TILE_H} target={{ value: 7, label: "7h" }} flag="under" />
        </Tile>

        {/* Diary: AI rating trend + the latest day's headline */}
        <Tile
          title="Diary · AI day rating"
          value={d.diaryAvg === null ? "–" : d.diaryAvg.toFixed(1)}
          sub={diary.length ? `avg over ${diary.length} summarised day${diary.length === 1 ? "" : "s"}` : "no summaries yet"}
          onOpen={() => setOpen("diary")}
          className="sm:col-span-2 xl:col-span-2"
          action={
            <Link href="/diary" className="inline-flex items-center gap-1 rounded-lg bg-accent-muted px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20">
              <BookOpen className="h-3 w-3" /> Write today
            </Link>
          }
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TrendChart data={d.diarySeries} y="rating" kind="line" name="AI rating" height={TILE_H - 20} domain={[0, 10]} />
            </div>
            {latestDiary ? (
              <div className="flex flex-col justify-center gap-2 rounded-2xl bg-muted/60 p-4">
                <div className="flex items-center gap-2">
                  <span className={cn("tabular rounded-lg px-2 py-0.5 text-sm font-bold", ratingTone(latestDiary.rating))}>{latestDiary.rating ?? "–"}</span>
                  <span className="text-xs text-subtle">{fmtDay(latestDiary.date)}</span>
                </div>
                <p className="font-display text-base leading-snug">{latestDiary.headline}</p>
                <p className="line-clamp-2 text-xs text-subtle">{latestDiary.summary}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border p-4 text-center">
                <Sparkles className="h-5 w-5 text-accent/50" />
                <p className="text-sm font-medium">Talk about your day</p>
                <p className="text-xs text-subtle">Record a diary note at night; the AI rates and summarises each day here.</p>
              </div>
            )}
          </div>
        </Tile>
      </div>

      {/* ── Secondary numbers ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Completion" value={pct(cur.completionRate)} hint={<Delta cur={cur.completionRate === null ? null : cur.completionRate * 100} prev={prev.completionRate === null ? null : prev.completionRate * 100} unit="pt" digits={0} />} onOpen={() => setOpen("completion")} />
        <MiniStat label="Must-do hit" value={pct(cur.mustDoHitRate)} hint="done or progressed" good={(cur.mustDoHitRate ?? 0) >= 0.8} onOpen={() => setOpen("mustdo")} />
        <MiniStat label="Logged on tasks" value={stats.efficiency.utilizationPct === null ? "–" : `${Math.round(stats.efficiency.utilizationPct)}%`} hint="of worked time" onOpen={() => setOpen("logged")} />
        <MiniStat label="Estimates" value={stats.efficiency.estimateRatio === null ? "–" : `${stats.efficiency.estimateRatio.toFixed(1)}×`} hint="actual vs estimate" warn={(stats.efficiency.estimateRatio ?? 1) > 1.25} onOpen={() => setOpen("estimates")} />
        <MiniStat label="Plan streak" value={`${stats.summary.planningStreak}d`} hint="planned ahead" warn={stats.summary.planningStreak === 0} onOpen={() => setOpen("planstreak")} />
        <MiniStat label="Must-do streak" value={`${stats.summary.mustDoStreak}d`} hint="all must-dos done" warn={stats.summary.mustDoStreak === 0} onOpen={() => setOpen("mustdostreak")} />
      </div>

      {/* ── Lists (top 3, full list in a dialog) ──────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ListTile title="Rotting tasks" count={stats.rotting.length} empty="Nothing carried over repeatedly." onOpen={() => setOpen("rotting")}>
          {stats.rotting.slice(0, 3).map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
              <span className={cn("tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold", r.carry >= 3 ? "bg-bad-muted text-bad" : "bg-warn-muted text-warn")}>{r.carry}×</span>
            </div>
          ))}
        </ListTile>
        <ListTile title="Estimate vs actual" count={stats.estimateVsActual.length} empty="Add ~2h estimates and log minutes." onOpen={() => setOpen("estimates")}>
          {stats.estimateVsActual.slice(0, 3).map((e) => {
            const ratio = e.actual / e.estimate;
            return (
              <div key={e.taskId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                <span className={cn("tabular shrink-0 text-xs font-bold", ratio > 1.25 ? "text-bad" : ratio < 0.75 ? "text-good" : "text-subtle")}>{ratio.toFixed(1)}×</span>
              </div>
            );
          })}
        </ListTile>
        <ListTile title="Cadence" count={stats.cadence.length} empty="No cadence tasks." onOpen={() => setOpen("cadence")}>
          {stats.cadence.slice(0, 3).map((c) => (
            <div key={c.id}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                <span className="tabular shrink-0 text-[11px] text-subtle">every {c.target}d</span>
              </div>
              {c.avgInterval !== null ? <Progress className="mt-1 h-1" value={Math.min(1, c.target / c.avgInterval)} tone={c.avgInterval > c.target ? "warn" : "accent"} /> : null}
            </div>
          ))}
        </ListTile>
        <ListTile title="Project progress" count={stats.projectProgress.length} empty="No projects with tasks." onOpen={() => setOpen("progress")}>
          {stats.projectProgress.slice(0, 3).map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
              <Progress className="h-1.5 w-16 shrink-0" value={p.completionPct / 100} />
              <span className="tabular w-8 shrink-0 text-right text-[11px] font-semibold text-subtle">{p.completionPct}%</span>
            </div>
          ))}
        </ListTile>
      </div>

      {/* ── Detail dialogs ────────────────────────────────────── */}
      <DetailDialog open={open === "score"} onClose={close} title="Day score" subtitle={`${periodLabel}, compared with ${prevLabel}`}>
        <Facts>
          <Fact label="Average" value={cur.avgScore?.toFixed(1) ?? "–"} />
          <Fact label="Previous period" value={prev.avgScore?.toFixed(1) ?? "–"} />
          <Fact label="Best day" value={d.best ? `${d.best.score} · ${fmtDay(d.best.date)}` : "–"} tone="good" />
          <Fact label="Lowest day" value={d.worst ? `${d.worst.score} · ${fmtDay(d.worst.date)}` : "–"} tone="warn" />
        </Facts>
        <TrendChart data={series} y="score" avg="scoreAvg" kind="line" name="Score" height={BIG_H} domain={[0, 10]} large />
        <Note>Your own 0 to 10 rating of each day. The dashed line is the 7-day average, so a single bad day does not hide the trend.</Note>
      </DetailDialog>

      <DetailDialog open={open === "hours"} onClose={close} title="Hours worked" subtitle={periodLabel}>
        <Facts>
          <Fact label="Per day" value={cur.avgWorkedHours === null ? "–" : `${cur.avgWorkedHours.toFixed(1)}h`} />
          <Fact label="Total" value={`${cur.totalWorkedHours.toFixed(1)}h`} />
          <Fact label="Days worked" value={`${d.worked.length} of ${series.length}`} />
          <Fact label="Longest day" value={d.longest ? `${d.longest.hours.toFixed(1)}h · ${fmtDay(d.longest.date)}` : "–"} />
        </Facts>
        <TrendChart data={series} y="hours" avg="hoursAvg" kind="bar" name="Hours" unit="h" height={BIG_H} large />
        <Note>Previous period averaged {prev.avgWorkedHours?.toFixed(1) ?? "–"}h a day. Worked time comes from your office/outside segments or the manual hours you enter on Today.</Note>
      </DetailDialog>

      <DetailDialog open={open === "done"} onClose={close} title="Tasks done" subtitle={periodLabel}>
        <Facts>
          <Fact label="Done" value={cur.tasksDone} />
          <Fact label="Previous period" value={prev.tasksDone} />
          <Fact label="Per worked hour" value={cur.tasksPerHour?.toFixed(2) ?? "–"} />
          <Fact label="Busiest day" value={d.busiest && d.busiest.done > 0 ? `${d.busiest.done} · ${fmtDay(d.busiest.date)}` : "–"} />
        </Facts>
        <TrendChart data={series} y="done" avg="doneAvg" kind="bar" name="Done" height={BIG_H} large />
        <Note>Completion rate is {pct(cur.completionRate)} of everything scheduled; must-dos were done or progressed {pct(cur.mustDoHitRate)} of the time.</Note>
      </DetailDialog>

      <DetailDialog open={open === "unaccounted"} onClose={close} title="Unaccounted time" subtitle="Worked time not logged on any task">
        <Facts>
          <Fact label="Unaccounted" value={cur.unaccountedPct === null ? "–" : `${Math.round(cur.unaccountedPct)}%`} tone={unaccountedWarn ? "warn" : "good"} />
          <Fact label="Logged on tasks" value={stats.efficiency.utilizationPct === null ? "–" : `${Math.round(stats.efficiency.utilizationPct)}%`} />
          <Fact label="Days over 20%" value={`${d.overTarget}`} tone={d.overTarget ? "warn" : undefined} />
          <Fact label="Previous period" value={prev.unaccountedPct === null ? "–" : `${Math.round(prev.unaccountedPct)}%`} />
        </Facts>
        <TrendChart data={series} y="unaccountedPct" kind="bar" name="Unaccounted" unit="%" height={BIG_H} domain={[0, 100]} target={{ value: 20, label: "20% target" }} flag="over" large />
        <Note>Amber bars are days above the 20% target. Log minutes on tasks as you finish them to bring this down.</Note>
      </DetailDialog>

      <DetailDialog
        open={open === "projects"}
        onClose={close}
        title={drill ? drillName ?? "Project" : "Hours by project"}
        subtitle={drill ? "Every logged minute in this period, by day" : `${fmtDuration(stats.totals.minutes)} logged · click a bar to see its tasks`}
      >
        {drill ? (
          <>
            <button type="button" onClick={() => setParam({ drill: null })} className="text-xs font-medium text-accent hover:underline">← All projects</button>
            {pending ? <p className="text-sm text-subtle">Loading…</p> : stats.drill.length === 0 ? <p className="text-sm text-subtle">No minutes logged on this project in the period.</p> : (
              <ul className="divide-y divide-border">
                {[...drillByDate.entries()].map(([date, rows]) => (
                  <li key={date} className="py-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{fmtDay(date)}</p>
                    {rows.map((r) => (
                      <div key={r.taskId} className="flex items-center justify-between gap-3 py-0.5 text-sm">
                        <Link href={`/task/${r.taskId}`} className="min-w-0 truncate hover:underline">{r.title}</Link>
                        <span className="tabular shrink-0 text-xs text-subtle">{fmtDuration(r.minutes)}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <ProjectBars data={stats.hoursByProject} active={drill} onPick={(key) => setParam({ drill: key })} />
            {stats.projectProgress.length ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Completion</p>
                <ProgressList items={stats.projectProgress} />
              </div>
            ) : null}
          </>
        )}
      </DetailDialog>

      <DetailDialog open={open === "consistency"} onClose={close} title="Consistency" subtitle="Every day in the period, coloured by your score">
        <Facts>
          <Fact label="Days scored" value={`${d.scored.length} of ${series.length}`} />
          <Fact label="Best weekday" value={d.bestDow ? `${d.bestDow.label} · ${d.bestDow.avgScore}` : "–"} tone="good" />
          <Fact label="Hardest weekday" value={d.worstDow ? `${d.worstDow.label} · ${d.worstDow.avgScore}` : "–"} tone="warn" />
          <Fact label="Plan streak" value={`${stats.summary.planningStreak}d`} />
        </Facts>
        <Heatmap data={stats.heatmap} cell={22} />
      </DetailDialog>

      <DetailDialog open={open === "weekday"} onClose={close} title="Weekday patterns" subtitle="Average per weekday across the period">
        <div className="grid gap-4 md:grid-cols-3">
          {([["avgScore", "Average score"], ["avgDone", "Tasks done"], ["avgHours", "Hours worked"]] as const).map(([k, l]) => (
            <div key={k}>
              <p className="mb-1 text-xs font-semibold text-subtle">{l}</p>
              <WeekdayChart data={stats.weekday} metric={k} label={l} height={200} />
            </div>
          ))}
        </div>
        <Note>The darker bar is your best weekday for each measure.</Note>
      </DetailDialog>

      <DetailDialog open={open === "steps"} onClose={close} title="Steps" subtitle={`Goal ${stats.health.stepGoal.toLocaleString("en-US")} a day`}>
        <Facts>
          <Fact label="Average" value={d.stepAvg === null ? "–" : Math.round(d.stepAvg).toLocaleString("en-US")} />
          <Fact label="Goal hit" value={`${d.stepHit} of ${d.stepDays} days`} tone={d.stepDays && d.stepHit / d.stepDays >= 0.7 ? "good" : "warn"} />
          <Fact label="Goal" value={stats.health.stepGoal.toLocaleString("en-US")} />
          <Fact label="Days recorded" value={`${d.stepDays} of ${series.length}`} />
        </Facts>
        <TrendChart data={stats.health.stepsPerDay} y="steps" kind="bar" name="Steps" unit="k" height={BIG_H} color="blue" target={{ value: stats.health.stepGoal, label: "goal" }} flag="under" fmt={(v) => Math.round(v).toLocaleString("en-US")} large />
        <Note>Amber bars are days under the goal.</Note>
      </DetailDialog>

      <DetailDialog open={open === "exercise"} onClose={close} title="Exercise" subtitle={periodLabel}>
        <Facts>
          <Fact label="Sets done" value={d.setsTotal} />
          <Fact label="Active days" value={`${d.setDays} of ${series.length}`} />
          <Fact label="Per active day" value={d.setDays ? (d.setsTotal / d.setDays).toFixed(1) : "–"} />
          <Fact label="Exercise types" value={stats.health.amountByType.length} />
        </Facts>
        <TrendChart data={stats.health.setsPerDay} y="sets" kind="bar" name="Sets" height={BIG_H - 60} large />
        {stats.health.amountByType.length ? (
          <div className="flex flex-wrap gap-2">
            {stats.health.amountByType.map((a, i) => (
              <span key={`${a.name}-${i}`} className="rounded-xl bg-muted px-3 py-1.5 text-sm">
                <span className="font-semibold">{a.amount.toLocaleString("en-US")}</span> <span className="text-subtle">{a.unit} {a.name}</span>
              </span>
            ))}
          </div>
        ) : null}
      </DetailDialog>

      <DetailDialog open={open === "sleep"} onClose={close} title="Sleep" subtitle={periodLabel}>
        <Facts>
          <Fact label="Average" value={d.sleepAvg === null ? "–" : `${d.sleepAvg.toFixed(1)}h`} tone={d.sleepAvg !== null && d.sleepAvg < 7 ? "warn" : "good"} />
          <Fact label="Nights under 7h" value={`${d.shortNights} of ${d.sleepNights.length}`} tone={d.shortNights ? "warn" : undefined} />
          <Fact label="Longest / shortest" value={d.bestNight && d.worstNight ? `${d.bestNight.hours}h / ${d.worstNight.hours}h` : "–"} />
          <Fact label="Quality" value={d.sleepQ === null ? "–" : `${d.sleepQ.toFixed(1)} / 5`} />
        </Facts>
        <TrendChart data={stats.health.sleepPerDay} y="hours" kind="bar" name="Sleep" unit="h" height={BIG_H} target={{ value: 7, label: "7h" }} flag="under" large />
        <Note>Amber bars are nights under 7 hours. Log sleep each morning on Today or in Telegram ("slept 7h"); with a few weeks of data, compare it with your day score.</Note>
      </DetailDialog>

      <DetailDialog open={open === "diary"} onClose={close} title="Diary" subtitle={`${diary.length} summarised day${diary.length === 1 ? "" : "s"} in ${periodLabel}`}>
        <TrendChart data={d.diarySeries} y="rating" kind="line" name="AI rating" height={200} domain={[0, 10]} large />
        {diary.length === 0 ? (
          <p className="text-sm text-subtle">No summaries in this period yet. <Link href="/diary" className="font-medium text-accent hover:underline">Open the diary</Link> and record how your day went.</p>
        ) : (
          <div className="space-y-3">
            {diary.map((s) => (
              <details key={s.date} className="group rounded-2xl border border-border p-4 open:shadow-[var(--shadow-sm)]" open={s === latestDiary}>
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className={cn("tabular rounded-lg px-2 py-0.5 text-sm font-bold", ratingTone(s.rating))}>{s.rating ?? "–"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-subtle">{fmtDay(s.date)}</span>
                    <span className="block truncate font-medium">{s.headline}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-subtle transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-4">
                  <SummaryCard
                    s={s}
                    footer={<Link href={`/diary?date=${s.date}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Open this day <ChevronRight className="h-3 w-3" /></Link>}
                  />
                </div>
              </details>
            ))}
          </div>
        )}
      </DetailDialog>

      <DetailDialog open={open === "completion"} onClose={close} title="Completion rate" subtitle="Share of scheduled tasks that got done">
        <Facts>
          <Fact label="This period" value={pct(cur.completionRate)} />
          <Fact label="Previous period" value={pct(prev.completionRate)} />
          <Fact label="Tasks done" value={cur.tasksDone} />
          <Fact label="Must-do hit" value={pct(cur.mustDoHitRate)} />
        </Facts>
        <Note>Counts every task scheduled on a day in the range. Carrying tasks forward repeatedly pulls this down; plan fewer, finish more.</Note>
      </DetailDialog>

      <DetailDialog open={open === "mustdo"} onClose={close} title="Must-do hit rate" subtitle="Must-dos that were done or progressed">
        <Facts>
          <Fact label="This period" value={pct(cur.mustDoHitRate)} tone={(cur.mustDoHitRate ?? 0) >= 0.8 ? "good" : "warn"} />
          <Fact label="Previous period" value={pct(prev.mustDoHitRate)} />
          <Fact label="Must-do streak" value={`${stats.summary.mustDoStreak}d`} />
          <Fact label="Target" value="80%+" />
        </Facts>
        <Note>Progress counts, because a must-do moved forward is not a miss. Keep must-dos to the few things that truly have to happen.</Note>
      </DetailDialog>

      <DetailDialog open={open === "logged"} onClose={close} title="Logged on tasks" subtitle="How much worked time is attached to a task">
        <Facts>
          <Fact label="Logged" value={stats.efficiency.utilizationPct === null ? "–" : `${Math.round(stats.efficiency.utilizationPct)}%`} />
          <Fact label="Unaccounted" value={cur.unaccountedPct === null ? "–" : `${Math.round(cur.unaccountedPct)}%`} tone={unaccountedWarn ? "warn" : "good"} />
          <Fact label="Task time" value={fmtDuration(stats.totals.minutes)} />
          <Fact label="Worked" value={`${cur.totalWorkedHours.toFixed(1)}h`} />
        </Facts>
        <Note>The higher this is, the more honest the project and estimate numbers become.</Note>
      </DetailDialog>

      <DetailDialog open={open === "planstreak"} onClose={close} title="Planning streak" subtitle="Days planned before they started">
        <Facts>
          <Fact label="Current streak" value={`${stats.summary.planningStreak} days`} tone={stats.summary.planningStreak ? "good" : "warn"} />
        </Facts>
        <Note>Finish tomorrow&apos;s plan on the Plan page before the day boundary to keep the streak going.</Note>
        <Link href="/plan" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Plan tomorrow <ChevronRight className="h-4 w-4" /></Link>
      </DetailDialog>

      <DetailDialog open={open === "mustdostreak"} onClose={close} title="Must-do streak" subtitle="Days in a row with every must-do done">
        <Facts>
          <Fact label="Current streak" value={`${stats.summary.mustDoStreak} days`} tone={stats.summary.mustDoStreak ? "good" : "warn"} />
          <Fact label="Hit rate" value={pct(cur.mustDoHitRate)} />
        </Facts>
      </DetailDialog>

      <DetailDialog open={open === "rotting"} onClose={close} title="Rotting tasks" subtitle="Carried over again and again">
        {stats.rotting.length === 0 ? <p className="text-sm text-subtle">Nothing is being carried over repeatedly.</p> : (
          <ul className="divide-y divide-border">
            {stats.rotting.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <Link href={`/task/${r.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">{r.title}</Link>
                {r.project ? <span className="hidden shrink-0 text-xs text-subtle sm:inline">{r.project}</span> : null}
                <span className={cn("tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", r.carry >= 3 ? "bg-bad-muted text-bad" : "bg-warn-muted text-warn")}>carried {r.carry}×</span>
              </li>
            ))}
          </ul>
        )}
        <Note>Do it, shrink it, schedule it properly, or drop it. A task carried three times is telling you something.</Note>
      </DetailDialog>

      <DetailDialog open={open === "estimates"} onClose={close} title="Estimate vs actual" subtitle={stats.efficiency.estimateRatio === null ? undefined : `Median ${stats.efficiency.estimateRatio.toFixed(1)}× your estimate`}>
        {stats.estimateVsActual.length === 0 ? <p className="text-sm text-subtle">Add estimates like ~2h to tasks and log minutes to see this.</p> : (
          <ul className="space-y-3">
            {stats.estimateVsActual.map((e) => {
              const ratio = e.actual / e.estimate;
              const max = Math.max(e.actual, e.estimate);
              return (
                <li key={e.taskId}>
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/task/${e.taskId}`} className="min-w-0 truncate text-sm hover:underline">{e.title}</Link>
                    <span className="tabular shrink-0 text-xs text-subtle">{fmtDuration(e.estimate)} → {fmtDuration(e.actual)} <strong className={cn(ratio > 1.25 ? "text-bad" : ratio < 0.75 ? "text-good" : "text-fg")}>{ratio.toFixed(1)}×</strong></span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    <Progress className="h-1.5" value={e.estimate / max} tone="accent" />
                    <Progress className="h-1.5" value={e.actual / max} tone={ratio > 1.25 ? "bad" : "accent"} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Note>Top bar is the estimate, bottom bar what it took. 1.0× is perfect; above 1.25× means you are under-estimating.</Note>
      </DetailDialog>

      <DetailDialog open={open === "cadence"} onClose={close} title="Cadence adherence" subtitle="Are recurring habits happening as often as intended?">
        {stats.cadence.length === 0 ? <p className="text-sm text-subtle">No cadence tasks.</p> : (
          <ul className="space-y-3">
            {stats.cadence.map((c) => (
              <li key={c.id}>
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/task/${c.id}`} className="min-w-0 truncate text-sm hover:underline">{c.title}</Link>
                  <span className="tabular shrink-0 text-xs text-subtle">
                    every {c.target}d · actual {c.avgInterval === null ? "–" : `${c.avgInterval.toFixed(1)}d`} · {c.daysSince === null ? "never done" : `${c.daysSince}d ago`}
                  </span>
                </div>
                {c.avgInterval !== null ? <Progress className="mt-1 h-1.5" value={Math.min(1, c.target / c.avgInterval)} tone={c.avgInterval > c.target ? "warn" : "accent"} /> : null}
              </li>
            ))}
          </ul>
        )}
      </DetailDialog>

      <DetailDialog open={open === "progress"} onClose={close} title="Project progress" subtitle="Done tasks out of all tasks per project">
        <ProgressList items={stats.projectProgress} />
      </DetailDialog>

      <DetailDialog open={open === "attention"} onClose={close} title="Things to look at" subtitle="Worth a minute of your attention">
        <ul className="divide-y divide-border">
          {stats.attention.map((a) => (
            <li key={a.id}>
              <Link href={a.href} className="flex items-start gap-3 py-3 hover:opacity-80">
                {a.severity === "info"
                  ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
                  : <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", a.severity === "high" ? "text-bad" : "text-warn")} />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{a.title}</span>
                  <span className="block text-xs text-subtle">{a.detail}</span>
                </span>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </DetailDialog>

      <DetailDialog open={open === "insights"} onClose={close} title="Insights" subtitle="Patterns found in this period">
        <ul className="space-y-2">
          {stats.insights.map((t) => (
            <li key={t} className="flex items-start gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warn" />{t}
            </li>
          ))}
        </ul>
      </DetailDialog>
    </div>
  );
}

function ProgressList({ items }: { items: Stats["projectProgress"] }) {
  if (!items.length) return <p className="text-sm text-subtle">No projects with tasks.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((p) => (
        <li key={p.id} className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
          <Link href="/projects" className="min-w-0 flex-1 truncate text-sm hover:underline">{p.name}</Link>
          <span className="tabular hidden shrink-0 text-xs text-subtle sm:inline">{p.doneTasks}/{p.totalTasks}</span>
          <Progress className="h-2 w-28 shrink-0" value={p.completionPct / 100} tone={p.completionPct >= 80 ? "accent" : "warn"} />
          <span className={cn("tabular w-10 shrink-0 text-right text-xs font-semibold", p.completionPct === 100 ? "text-good" : "text-subtle")}>{p.completionPct}%</span>
        </li>
      ))}
    </ul>
  );
}
