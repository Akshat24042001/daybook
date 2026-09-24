"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Lightbulb, Minus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import type { Stats } from "@/lib/services/stats";
import { fmtDateShort, fmtDuration, type DateStr } from "@/lib/time";
import { Card, Chip, Empty, Input, Progress, Select } from "../ui";
import { DoneChart, Heatmap, ProjectBars, ScoreHoursChart, SetsChart, StepsChart, UnaccountedChart, WeekdayChart } from "./charts";

const TYPE_OPTIONS = [
  ["one_off", "One-off"], ["ongoing", "Ongoing"], ["follow_up", "Follow-up"], ["cadence", "Cadence"],
  ["recurring", "Recurring"], ["someday", "Someday"], ["target", "Target"],
] as const;

function Delta({ cur, prev, unit = "", digits = 1, lowerIsBetter = false, neutral = false }: {
  cur: number | null; prev: number | null; unit?: string; digits?: number; lowerIsBetter?: boolean; neutral?: boolean;
}) {
  if (cur === null || prev === null) return <span className="text-xs text-subtle">no earlier data</span>;
  const d = cur - prev;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return <span className="inline-flex items-center gap-0.5 text-xs text-subtle"><Minus className="h-3 w-3" /> same as before</span>;
  const good = neutral ? null : lowerIsBetter ? d < 0 : d > 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good === null ? "text-subtle" : good ? "text-good" : "text-bad")}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(d).toFixed(digits)}{unit} <span className="font-normal text-subtle">vs before</span>
    </span>
  );
}

function Kpi({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <Card className="p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</p>
      <p className="tabular mt-1 text-2xl font-medium leading-none">{value}</p>
      {sub ? <p className="mt-1 text-xs text-subtle">{sub}</p> : null}
      <div className="mt-1.5">{children}</div>
    </Card>
  );
}

function Section({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="space-y-2">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h2>
        {hint ? <p className="text-xs text-subtle">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

export function StatsView({
  stats, range, projects, people, vias, drill, today,
}: {
  stats: Stats;
  range: "7" | "30" | "90" | "custom";
  projects: { id: number; name: string }[];
  people: { id: number; name: string }[];
  vias: string[];
  drill: string | null;
  today: DateStr;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [, start] = useTransition();
  const [via, setVia] = useState(stats.filters.via ?? "");
  const { current: cur, previous: prev } = stats.summary;
  const f = stats.filters;

  function setParam(next: Record<string, string | null>) {
    const sp = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    start(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  const drillName = drill === "none" ? "No project" : projects.find((p) => String(p.id) === drill)?.name ?? null;
  const noData = stats.series.every((d) => d.score === null && d.hours === 0 && d.done === 0) && stats.hoursByProject.length === 0;
  const byDate = new Map<string, typeof stats.drill>();
  for (const r of stats.drill) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Stats</h1>
        <p className="mt-1 text-sm text-subtle">
          {fmtDateShort(f.from)} to {fmtDateShort(f.to)} · compared with the {stats.totals.days} days before ({fmtDateShort(stats.previousRange.from)} to {fmtDateShort(stats.previousRange.to)}).
        </p>
      </header>

      {/* filters */}
      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Date range">
            {(["7", "30", "90", "custom"] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setParam(r === "custom" ? { range: "custom", from: f.from, to: f.to } : { range: r, from: null, to: null })}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", range === r ? "bg-surface shadow-sm" : "text-subtle hover:text-fg")}
              >
                {r === "custom" ? "Custom" : `${r} days`}
              </button>
            ))}
          </div>
          {range === "custom" ? (
            <div className="flex items-center gap-2">
              <Input type="date" value={f.from} max={today} onChange={(e) => e.target.value && setParam({ from: e.target.value })} className="h-9 w-[9.5rem]" aria-label="From" />
              <span className="text-subtle">to</span>
              <Input type="date" value={f.to} max={today} onChange={(e) => e.target.value && setParam({ to: e.target.value })} className="h-9 w-[9.5rem]" aria-label="To" />
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Select aria-label="Project" value={f.project ?? ""} onChange={(e) => setParam({ project: e.target.value, drill: null })} className="h-9">
            <option value="">All projects</option>
            <option value="none">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select aria-label="Task type" value={f.type ?? ""} onChange={(e) => setParam({ type: e.target.value })} className="h-9">
            <option value="">All types</option>
            {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select aria-label="Work or personal" value={f.scope ?? "all"} onChange={(e) => setParam({ scope: e.target.value === "all" ? null : e.target.value })} className="h-9">
            <option value="all">Work + personal</option>
            <option value="work">Work only</option>
            <option value="personal">Personal only</option>
          </Select>
          <Select aria-label="Person" value={f.person ? String(f.person) : ""} onChange={(e) => setParam({ person: e.target.value })} className="h-9">
            <option value="">Anyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select aria-label="Via" value={via} onChange={(e) => { setVia(e.target.value); setParam({ via: e.target.value }); }} className="h-9">
            <option value="">Any source</option>
            {vias.map((v) => <option key={v} value={v}>via {v}</option>)}
          </Select>
        </div>
        <p className="text-xs text-subtle">Filters apply to task numbers (hours by project, tasks done, estimates). Score, worked time and unaccounted time are whole-day measures.</p>
      </Card>

      {noData ? <Empty>No data in this range yet. Score your days, log minutes on tasks and track your time, and this page fills in.</Empty> : null}

      {/* headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Average score" value={cur.avgScore === null ? "–" : cur.avgScore.toFixed(1)} sub="out of 10">
          <Delta cur={cur.avgScore} prev={prev.avgScore} />
        </Kpi>
        <Kpi label="Worked per day" value={cur.avgWorkedHours === null ? "–" : `${cur.avgWorkedHours.toFixed(1)}h`} sub={`${cur.totalWorkedHours.toFixed(0)}h in total`}>
          <Delta cur={cur.avgWorkedHours} prev={prev.avgWorkedHours} unit="h" neutral />
        </Kpi>
        <Kpi label="Tasks done" value={String(cur.tasksDone)} sub={cur.tasksPerHour === null ? undefined : `${cur.tasksPerHour.toFixed(2)} per worked hour`}>
          <Delta cur={cur.tasksDone} prev={prev.tasksDone} digits={0} />
        </Kpi>
        <Kpi label="Completion rate" value={pct(cur.completionRate)} sub="done of everything scheduled">
          <Delta cur={cur.completionRate === null ? null : cur.completionRate * 100} prev={prev.completionRate === null ? null : prev.completionRate * 100} unit=" pts" digits={0} />
        </Kpi>
        <Kpi label="Must-do hit rate" value={pct(cur.mustDoHitRate)} sub="done or progressed">
          <Delta cur={cur.mustDoHitRate === null ? null : cur.mustDoHitRate * 100} prev={prev.mustDoHitRate === null ? null : prev.mustDoHitRate * 100} unit=" pts" digits={0} />
        </Kpi>
        <Kpi label="Unaccounted time" value={cur.unaccountedPct === null ? "–" : `${Math.round(cur.unaccountedPct)}%`} sub="target below 20%">
          <Delta cur={cur.unaccountedPct} prev={prev.unaccountedPct} unit=" pts" digits={0} lowerIsBetter />
        </Kpi>
        <Kpi label="Planning streak" value={`${stats.summary.planningStreak}d`} sub="planned ahead in time" />
        <Kpi label="Must-do streak" value={`${stats.summary.mustDoStreak}d`} sub="all must-dos done" />
      </div>

      {/* needs attention + insights */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Needs attention">
          {stats.attention.length === 0 ? (
            <Card className="p-4 text-sm text-subtle">Nothing is flagged. Numbers are inside your targets.</Card>
          ) : (
            <ul className="space-y-2">
              {stats.attention.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="flex gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-muted">
                    {a.severity === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-subtle" /> : <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", a.severity === "high" ? "text-bad" : "text-warn")} />}
                    <span>
                      <span className="block text-sm font-medium">{a.title}</span>
                      <span className="block text-xs text-subtle">{a.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="What the data says" hint="Shown only when each group being compared has at least 5 days of data.">
          {stats.insights.length === 0 ? (
            <Card className="p-4 text-sm text-subtle">Not enough data for a fair comparison yet. Keep scoring your days.</Card>
          ) : (
            <ul className="space-y-2">
              {stats.insights.map((t) => (
                <li key={t} className="flex gap-3 rounded-xl border border-border bg-surface p-3 text-sm">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                  {t}
                </li>
              ))}
            </ul>
          )}
          <Card className="mt-3 grid grid-cols-3 gap-2 p-3 text-center">
            <div>
              <p className="tabular text-lg font-medium">{stats.efficiency.utilizationPct === null ? "–" : `${Math.round(stats.efficiency.utilizationPct)}%`}</p>
              <p className="text-[11px] text-subtle">of worked time logged on tasks</p>
            </div>
            <div>
              <p className="tabular text-lg font-medium">{stats.efficiency.tasksPerHour === null ? "–" : stats.efficiency.tasksPerHour.toFixed(2)}</p>
              <p className="text-[11px] text-subtle">tasks done per worked hour</p>
            </div>
            <div>
              <p className="tabular text-lg font-medium">{stats.efficiency.estimateRatio === null ? "–" : `${stats.efficiency.estimateRatio.toFixed(1)}×`}</p>
              <p className="text-[11px] text-subtle">actual vs estimate (1× is perfect)</p>
            </div>
          </Card>
        </Section>
      </div>

      {/* ── Daily trends ─────────────────────────────────────────── */}
      <Section title="Daily trends" hint="Score, hours, unaccounted time, and tasks done over the selected range.">
        <div className="space-y-3">
          <Card className="p-3">
            <p className="mb-1 text-xs font-medium text-subtle">Score and hours worked</p>
            <ScoreHoursChart series={stats.series} />
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-3">
              <p className="mb-1 text-xs font-medium text-subtle">Unaccounted time per day</p>
              <p className="mb-2 text-[11px] text-subtle">Worked time not logged on any task. Bars above 20% are amber.</p>
              <UnaccountedChart series={stats.series} />
            </Card>
            <Card className="p-3">
              <p className="mb-1 text-xs font-medium text-subtle">Tasks completed per day</p>
              <DoneChart series={stats.series} />
            </Card>
          </div>
          <Card className="p-3">
            <p className="mb-1 text-xs font-medium text-subtle">Score heatmap — one square per day, darker is higher</p>
            <Heatmap data={stats.heatmap} />
          </Card>
        </div>
      </Section>

      {/* ── Weekday patterns ─────────────────────────────────────── */}
      <Section title="Weekday patterns" hint="Averages by weekday over this range. The darkest bar is the best day.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-3"><p className="mb-1 text-xs font-medium text-subtle">Average score</p><WeekdayChart data={stats.weekday} metric="avgScore" label="Average score" /></Card>
          <Card className="p-3"><p className="mb-1 text-xs font-medium text-subtle">Tasks done</p><WeekdayChart data={stats.weekday} metric="avgDone" label="Tasks done" /></Card>
          <Card className="p-3"><p className="mb-1 text-xs font-medium text-subtle">Hours worked</p><WeekdayChart data={stats.weekday} metric="avgHours" label="Hours worked" /></Card>
        </div>
      </Section>

      {/* ── Projects ─────────────────────────────────────────────── */}
      <Section title="Projects" hint="Time logged and task completion per project." id="projects">
        {stats.hoursByProject.length === 0 ? (
          <Empty>No minutes logged in this range.</Empty>
        ) : (
          <Card className="p-3">
            <p className="mb-1 text-xs font-medium text-subtle">Hours by project — click a bar to drill in</p>
            <ProjectBars
              data={stats.hoursByProject}
              active={drill}
              onPick={(id) => setParam({ drill: id === null ? "none" : String(id) === drill ? null : String(id) })}
            />
            <p className="tabular mt-1 text-xs text-subtle">Total {fmtDuration(stats.totals.minutes)}</p>
          </Card>
        )}
        {drill ? (
          <Card className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">{drillName ?? "Project"}: every task, by day</p>
              <button type="button" className="text-xs text-subtle underline-offset-2 hover:underline" onClick={() => setParam({ drill: null })}>Close</button>
            </div>
            {stats.drill.length === 0 ? (
              <p className="text-sm text-subtle">No time logged.</p>
            ) : (
              <ul className="divide-y divide-border">
                {[...byDate.entries()].map(([date, rows]) => (
                  <li key={date} className="py-2">
                    <p className="text-xs font-semibold text-subtle">{fmtDateShort(date)}</p>
                    {rows.map((r) => (
                      <div key={r.taskId} className="flex items-center justify-between py-0.5 text-sm">
                        <Link href={`/task/${r.taskId}`} className="hover:underline">{r.title}</Link>
                        <span className="tabular text-subtle">{fmtDuration(r.minutes)}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
        {stats.projectProgress.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {stats.projectProgress.map((p) => (
              <Card key={p.id} className="p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
                    <Link href="/projects" className="truncate text-sm font-medium hover:underline">{p.name}</Link>
                  </div>
                  <span className={cn("shrink-0 text-xs font-semibold tabular", p.completionPct === 100 ? "text-good" : p.completionPct >= 50 ? "text-accent" : "text-subtle")}>
                    {p.completionPct}%
                  </span>
                </div>
                <Progress className="mt-2" value={p.completionPct / 100} tone={p.completionPct >= 80 ? "accent" : p.completionPct >= 40 ? "accent" : "warn"} />
                <p className="mt-1.5 text-xs text-subtle">
                  {p.doneTasks} done in period · {p.totalTasks} total tasks
                </p>
              </Card>
            ))}
          </div>
        ) : null}
      </Section>

      {/* ── Task quality ─────────────────────────────────────────── */}
      <Section title="Task quality" hint="Estimate accuracy, task rot, and cadence habits.">
        <div className="space-y-3">
          {stats.estimateVsActual.length === 0 ? null : (
            <div>
              <p className="mb-1.5 text-xs font-medium text-subtle">Estimate vs actual</p>
              <Card className="divide-y divide-border">
                {stats.estimateVsActual.map((e) => {
                  const ratio = e.actual / e.estimate;
                  const max = Math.max(e.actual, e.estimate);
                  return (
                    <div key={e.taskId} className="p-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <Link href={`/task/${e.taskId}`} className="truncate font-medium hover:underline">{e.title}</Link>
                        <span className={cn("tabular shrink-0 text-xs font-medium", ratio > 1.25 ? "text-bad" : ratio < 0.75 ? "text-good" : "text-subtle")}>{ratio.toFixed(1)}×</span>
                      </div>
                      <div className="mt-1.5 space-y-1">
                        <div className="flex items-center gap-2"><span className="w-14 text-[11px] text-subtle">Estimate</span><Progress className="h-1.5 flex-1" value={e.estimate / max} /><span className="tabular w-14 text-right text-xs">{fmtDuration(e.estimate)}</span></div>
                        <div className="flex items-center gap-2"><span className="w-14 text-[11px] text-subtle">Actual</span><Progress className="h-1.5 flex-1" tone={ratio > 1.25 ? "bad" : "accent"} value={e.actual / max} /><span className="tabular w-14 text-right text-xs">{fmtDuration(e.actual)}</span></div>
                      </div>
                    </div>
                  );
                })}
              </Card>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium text-subtle">Rotting tasks</p>
              {stats.rotting.length === 0 ? (
                <Empty>Nothing is being carried over.</Empty>
              ) : (
                <Card className="divide-y divide-border">
                  {stats.rotting.map((r) => (
                    <Link key={r.id} href={`/task/${r.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        {r.project ? <span className="text-xs text-subtle">{r.project}</span> : null}
                      </span>
                      <span className={cn("tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", r.carry >= 3 ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn")}>{r.carry}×</span>
                    </Link>
                  ))}
                </Card>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-subtle">Cadence adherence</p>
              {stats.cadence.length === 0 ? (
                <Empty>No cadence tasks.</Empty>
              ) : (
                <Card className="divide-y divide-border">
                  {stats.cadence.map((c) => (
                    <div key={c.id} className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <Link href={`/task/${c.id}`} className="truncate text-sm font-medium hover:underline">{c.title}</Link>
                        <span className="tabular shrink-0 text-xs text-subtle">target every {c.target}d</span>
                      </div>
                      <p className="tabular mt-0.5 text-xs text-subtle">
                        {c.avgInterval === null ? `${c.doneCount} done in range, not enough for an interval` : `actually every ${c.avgInterval.toFixed(1)} days (${c.doneCount} done)`}
                        {c.daysSince !== null ? ` · last done ${c.daysSince}d ago` : ""}
                      </p>
                      {c.avgInterval !== null ? <Progress className="mt-1.5 h-1.5" value={Math.min(1, c.target / c.avgInterval)} tone={c.avgInterval > c.target ? "warn" : "accent"} /> : null}
                    </div>
                  ))}
                </Card>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Health ───────────────────────────────────────────────── */}
      <Section title="Health">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-3"><p className="mb-1 text-xs font-medium text-subtle">Exercise sets per day</p><SetsChart data={stats.health.setsPerDay} /></Card>
          <Card className="p-3"><p className="mb-1 text-xs font-medium text-subtle">Steps per day vs goal</p><StepsChart data={stats.health.stepsPerDay} goal={stats.health.stepGoal} /></Card>
        </div>
        {stats.health.amountByType.length ? (
          <div className="flex flex-wrap gap-2">
            {stats.health.amountByType.map((a, i) => (
              <Chip key={`${a.name}-${i}`}>{a.name}: {a.amount.toLocaleString("en-US")} {a.unit}</Chip>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}
