import { q } from "../db";
import { computeInsights, type DayFacts, type SlotFacts } from "../insights";
import { workedMinutes, type Segment } from "../hours";
import { type Ctx, windowOf } from "../settings";
import { type DateStr, addDays, dateRange, diffDays, isoDow, zonedParts } from "../time";
import type { TaskType } from "../types";
import { mustDoStreak, planningStreak } from "./days";
import { listExerciseTypes } from "./health";
import { listCadence, targetsBehind } from "./goals";
import { projectProgressForStats } from "./projects";

export interface StatsFilters {
  from: DateStr;
  to: DateStr;
  /** project id, or "none" for tasks without a project */
  project?: string | null;
  type?: TaskType | null;
  scope?: "all" | "work" | "personal";
  person?: number | null;
  via?: string | null;
}

function taskFilter(f: StatsFilters, params: unknown[]): string {
  let sql = "";
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.project === "none") sql += " and t.project_id is null";
  else if (f.project) sql += ` and t.project_id = ${add(Number(f.project))}`;
  if (f.type) sql += ` and t.type = ${add(f.type)}`;
  if (f.scope === "work") sql += " and not t.is_personal";
  if (f.scope === "personal") sql += " and t.is_personal";
  if (f.person) sql += ` and t.person_id = ${add(f.person)}`;
  if (f.via) sql += ` and lower(t.via) = lower(${add(f.via)})`;
  return sql;
}

async function workedByDay(ctx: Ctx, from: DateStr, to: DateStr): Promise<Map<DateStr, number>> {
  const start = windowOf(ctx, from).start;
  const end = windowOf(ctx, to).end;
  const rows = await q<{ kind: Segment["kind"]; start_at: Date; end_at: Date | null }>(
    "select kind, start_at, end_at from work_segments where start_at < $2 and (end_at is null or end_at > $1) order by start_at",
    [start, end],
  );
  const segs: Segment[] = rows.map((r) => ({ kind: r.kind, start: r.start_at, end: r.end_at }));
  const out = new Map<DateStr, number>();
  for (const d of dateRange(from, to)) out.set(d, workedMinutes(segs, windowOf(ctx, d), ctx.now));
  return out;
}

// ------------------------------------------------------------------ period metrics

export interface PeriodMetrics {
  avgScore: number | null;
  avgWorkedHours: number | null;
  totalWorkedHours: number;
  tasksDone: number;
  completionRate: number | null;
  mustDoHitRate: number | null;
  unaccountedPct: number | null;
  /** tasks completed per worked hour */
  tasksPerHour: number | null;
}

/** All the headline numbers for one date range. Used for the current period and the one before it. */
export async function periodMetrics(
  ctx: Ctx,
  f: StatsFilters,
  pre?: { worked?: Map<DateStr, number>; logged?: Map<DateStr, number> },
): Promise<PeriodMetrics> {
  const { from, to } = f;
  const dates = dateRange(from, to);
  const worked = pre?.worked ?? (await workedByDay(ctx, from, to));

  const [scoreRows, loggedRows] = await Promise.all([
    q<{ score: number }>(
      "select score from days where date between $1 and $2 and score is not null",
      [from, to],
    ),
    pre?.logged
      ? Promise.resolve([...pre.logged.entries()].map(([date, m]) => ({ date, m })))
      : q<{ date: DateStr; m: number }>(
          `select l.date, sum(l.minutes)::int as m from time_logs l join tasks t on t.id = l.task_id
           where l.date between $1 and $2 and not t.is_personal group by l.date`,
          [from, to],
        ),
  ]);
  const logged = pre?.logged ?? new Map(loggedRows.map((r) => [r.date, r.m]));
  const workedDays = dates.filter((d) => (worked.get(d) ?? 0) > 0);
  const totalWorked = workedDays.reduce((a, d) => a + (worked.get(d) ?? 0), 0);
  const totalUnacc = workedDays.reduce((a, d) => a + Math.max(0, (worked.get(d) ?? 0) - (logged.get(d) ?? 0)), 0);

  const p1: unknown[] = [from, to];
  const tf1 = taskFilter(f, p1);
  const md = await q<{ total: number; hit: number }>(
    `select count(*)::int as total, count(*) filter (where e.status in ('done','progressed'))::int as hit
     from day_entries e join tasks t on t.id = e.task_id
     where e.date between $1 and $2 and e.must_do and e.status <> 'dropped' ${tf1}`,
    p1,
  );
  const p2: unknown[] = [from, to, ctx.today > to ? addDays(to, 1) : ctx.today];
  const tf2 = taskFilter(f, p2);
  const comp = await q<{ total: number; done: number }>(
    `select count(*)::int as total, count(*) filter (where e.status = 'done')::int as done
     from day_entries e join tasks t on t.id = e.task_id
     where e.date between $1 and $2 and e.date < $3 and e.status <> 'dropped' ${tf2}`,
    p2,
  );
  const p3: unknown[] = [from, to];
  const tf3 = taskFilter(f, p3);
  const done = await q<{ n: number }>(
    `select count(*)::int as n from day_entries e join tasks t on t.id = e.task_id
     where e.date between $1 and $2 and e.status = 'done' ${tf3}`,
    p3,
  );

  const avgScore = scoreRows.length ? scoreRows.reduce((a, r) => a + r.score, 0) / scoreRows.length : null;
  return {
    avgScore,
    avgWorkedHours: workedDays.length ? totalWorked / workedDays.length / 60 : null,
    totalWorkedHours: totalWorked / 60,
    tasksDone: done[0].n,
    completionRate: comp[0].total ? comp[0].done / comp[0].total : null,
    mustDoHitRate: md[0].total ? md[0].hit / md[0].total : null,
    unaccountedPct: totalWorked > 0 ? (totalUnacc / totalWorked) * 100 : null,
    tasksPerHour: totalWorked > 0 ? done[0].n / (totalWorked / 60) : null,
  };
}

/** Moving average that ignores missing values. */
export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return slice.length ? Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 100) / 100 : null;
  });
}

export interface AttentionItem {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  href: string;
}

export interface Stats {
  filters: StatsFilters;
  previousRange: { from: DateStr; to: DateStr };
  summary: {
    current: PeriodMetrics;
    previous: PeriodMetrics;
    planningStreak: number;
    mustDoStreak: number;
  };
  efficiency: {
    /** logged task minutes as a share of worked time */
    utilizationPct: number | null;
    /** median of actual / estimate for tasks with an estimate; above 1 means things take longer than planned */
    estimateRatio: number | null;
    tasksPerHour: number | null;
  };
  series: {
    date: DateStr;
    score: number | null;
    scoreAvg: number | null;
    hours: number;
    hoursAvg: number | null;
    done: number;
    doneAvg: number | null;
    unaccountedPct: number | null;
  }[];
  weekday: { dow: number; label: string; avgScore: number | null; avgDone: number | null; avgHours: number | null; days: number }[];
  hoursByProject: { id: number | null; name: string; color: string; minutes: number }[];
  projectProgress: { id: number; name: string; color: string; totalTasks: number; doneTasks: number; completionPct: number }[];
  drill: { date: DateStr; taskId: number; title: string; minutes: number }[];
  estimateVsActual: { taskId: number; title: string; estimate: number; actual: number }[];
  rotting: { id: number; title: string; carry: number; project: string | null }[];
  cadence: { id: number; title: string; target: number; avgInterval: number | null; doneCount: number; daysSince: number | null }[];
  heatmap: { date: DateStr; score: number | null }[];
  health: {
    setsPerDay: { date: DateStr; sets: number }[];
    amountByType: { name: string; unit: string; amount: number }[];
    stepsPerDay: { date: DateStr; steps: number | null }[];
    stepGoal: number;
  };
  attention: AttentionItem[];
  insights: string[];
  totals: { minutes: number; days: number };
}

const DOW_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function computeStats(ctx: Ctx, f: StatsFilters, drillProject?: string | null): Promise<Stats> {
  const { from, to } = f;
  const dates = dateRange(from, to);
  const len = dates.length;
  const prevRange = { from: addDays(from, -len), to: addDays(from, -1) };
  const [worked, dayRows, loggedRows] = await Promise.all([
    workedByDay(ctx, from, to),
    q<{ date: DateStr; score: number | null; steps: number | null }>(
      "select date, score, steps from days where date between $1 and $2",
      [from, to],
    ),
    q<{ date: DateStr; m: number }>(
      `select l.date, sum(l.minutes)::int as m from time_logs l join tasks t on t.id = l.task_id
       where l.date between $1 and $2 and not t.is_personal group by l.date`,
      [from, to],
    ),
  ]);
  const logged = new Map(loggedRows.map((r) => [r.date, r.m]));

  const [current, previous] = await Promise.all([
    periodMetrics(ctx, f, { worked, logged }),
    periodMetrics(ctx, { ...f, ...prevRange }),
  ]);

  // ---- per-day facts
  const dayMap = new Map(dayRows.map((r) => [r.date, r]));
  const mustRows = await q<{ date: DateStr; n: number }>(
    "select date, count(*)::int as n from day_entries where date between $1 and $2 and must_do and status <> 'dropped' group by date",
    [from, to],
  );
  const mustByDay = new Map(mustRows.map((r) => [r.date, r.n]));
  const pd: unknown[] = [from, to];
  const tfd = taskFilter(f, pd);
  const doneRows = await q<{ date: DateStr; n: number }>(
    `select e.date, count(*)::int as n from day_entries e join tasks t on t.id = e.task_id
     where e.date between $1 and $2 and e.status = 'done' ${tfd} group by e.date`,
    pd,
  );
  const doneByDay = new Map(doneRows.map((r) => [r.date, r.n]));

  const facts: DayFacts[] = dates.map((d) => {
    const w = worked.get(d) ?? 0;
    const l = logged.get(d) ?? 0;
    return {
      date: d,
      score: dayMap.get(d)?.score ?? null,
      mustDoCount: mustByDay.get(d) ?? 0,
      workedMin: w,
      unaccountedPct: w > 0 ? (Math.max(0, w - l) / w) * 100 : null,
    };
  });

  const scoreArr = facts.map((d) => d.score);
  const hoursArr = facts.map((d) => (d.workedMin > 0 ? Math.round((d.workedMin / 60) * 100) / 100 : null));
  const doneArr = dates.map((d) => doneByDay.get(d) ?? 0);
  const scoreAvg = movingAverage(scoreArr, 7);
  const hoursAvg = movingAverage(hoursArr, 7);
  const doneAvg = movingAverage(doneArr, 7);
  const series = dates.map((d, i) => ({
    date: d,
    score: scoreArr[i],
    scoreAvg: scoreAvg[i],
    hours: hoursArr[i] ?? 0,
    hoursAvg: hoursAvg[i],
    done: doneArr[i],
    doneAvg: doneAvg[i],
    unaccountedPct: facts[i].unaccountedPct,
  }));

  // ---- weekday pattern
  const weekday = [1, 2, 3, 4, 5, 6, 7].map((dow) => {
    const idx = dates.map((d, i) => (isoDow(d) === dow ? i : -1)).filter((i) => i >= 0);
    const scores = idx.map((i) => scoreArr[i]).filter((v): v is number => v !== null);
    const hours = idx.map((i) => hoursArr[i]).filter((v): v is number => v !== null);
    const dones = idx.map((i) => doneArr[i]);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
    return { dow, label: DOW_LABEL[dow], avgScore: avg(scores), avgDone: avg(dones), avgHours: avg(hours), days: idx.length };
  });

  // ---- filtered task-derived tables
  const [projectProgress] = await Promise.all([projectProgressForStats(from, to)]);

  const p3: unknown[] = [from, to];
  const tf3 = taskFilter(f, p3);
  const byProject = await q<{ id: number | null; name: string; color: string | null; minutes: number }>(
    `select p.id, coalesce(p.name, 'No project') as name, p.color, sum(l.minutes)::int as minutes
     from time_logs l join tasks t on t.id = l.task_id left join projects p on p.id = t.project_id
     where l.date between $1 and $2 ${tf3}
     group by p.id, p.name, p.color order by minutes desc`,
    p3,
  );

  let drill: Stats["drill"] = [];
  if (drillProject !== undefined && drillProject !== null) {
    const p4: unknown[] = [from, to];
    const tf4 = taskFilter({ ...f, project: drillProject }, p4);
    drill = await q(
      `select l.date, t.id as "taskId", t.title, sum(l.minutes)::int as minutes
       from time_logs l join tasks t on t.id = l.task_id
       where l.date between $1 and $2 ${tf4}
       group by l.date, t.id, t.title order by l.date, minutes desc`,
      p4,
    );
  }

  const p5: unknown[] = [from, to];
  const tf5 = taskFilter(f, p5);
  const est = await q<{ taskId: number; title: string; estimate: number; actual: number }>(
    `select t.id as "taskId", t.title, t.estimate_min as estimate, sum(l.minutes)::int as actual
     from tasks t join time_logs l on l.task_id = t.id and l.date between $1 and $2
     where t.estimate_min is not null ${tf5}
     group by t.id, t.title, t.estimate_min order by actual desc limit 15`,
    p5,
  );

  const p6: unknown[] = [];
  const tf6 = taskFilter(f, p6);
  const rot = await q<{ id: number; title: string; carry: number; project: string | null }>(
    `select t.id, t.title, t.carry_count as carry, p.name as project
     from tasks t left join projects p on p.id = t.project_id
     where t.state = 'active' and t.carry_count > 0 ${tf6}
     order by t.carry_count desc, t.id limit 10`,
    p6,
  );

  // ---- cadence adherence
  const p7: unknown[] = [];
  const tf7 = taskFilter(f, p7);
  const cadTasks = await q<{ id: number; title: string; cadence_days: number; last_done_at: Date | null }>(
    `select t.id, t.title, t.cadence_days, t.last_done_at from tasks t
     where t.type = 'cadence' and t.state = 'active' ${tf7} order by t.id`,
    p7,
  );
  const cadence: Stats["cadence"] = [];
  if (cadTasks.length > 0) {
    const cadIds = cadTasks.map((c) => c.id);
    const allDoneRows = await q<{ task_id: number; date: DateStr }>(
      "select task_id, date from day_entries where task_id = any($1) and status = 'done' and date between $2 and $3 order by task_id, date",
      [cadIds, from, to],
    );
    const doneByTask = new Map<number, DateStr[]>();
    for (const r of allDoneRows) {
      const arr = doneByTask.get(r.task_id) ?? [];
      arr.push(r.date);
      doneByTask.set(r.task_id, arr);
    }
    for (const c of cadTasks) {
      const ds = doneByTask.get(c.id) ?? [];
      let avgInterval: number | null = null;
      if (ds.length >= 2) {
        const gaps = ds.slice(1).map((d, i) => diffDays(d, ds[i]));
        avgInterval = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      }
      const lastDone = c.last_done_at ? zonedDay(ctx, c.last_done_at) : null;
      cadence.push({
        id: c.id,
        title: c.title,
        target: c.cadence_days,
        avgInterval,
        doneCount: ds.length,
        daysSince: lastDone ? Math.max(0, diffDays(ctx.today, lastDone)) : null,
      });
    }
  }

  // ---- health
  const logs = await q<{ date: DateStr; slot_at: Date; status: string; exercise_type_id: number | null; amount: number | null }>(
    "select date, slot_at, status, exercise_type_id, amount from exercise_logs where date between $1 and $2",
    [from, to],
  );
  const setsByDay = new Map<DateStr, number>();
  const amountByType = new Map<number, number>();
  const hourStats = new Map<number, { days: Set<DateStr>; notDone: Set<DateStr> }>();
  for (const l of logs) {
    if (l.status === "done") {
      setsByDay.set(l.date, (setsByDay.get(l.date) ?? 0) + 1);
      if (l.exercise_type_id) amountByType.set(l.exercise_type_id, (amountByType.get(l.exercise_type_id) ?? 0) + (l.amount ?? 0));
    }
    const hour = zonedParts(l.slot_at, ctx.tz).h;
    const h = hourStats.get(hour) ?? { days: new Set(), notDone: new Set() };
    h.days.add(l.date);
    if (l.status !== "done") h.notDone.add(l.date);
    hourStats.set(hour, h);
  }
  const types = await listExerciseTypes(false);
  const slotFacts: SlotFacts[] = [...hourStats.entries()].map(([hour, h]) => ({ hour, days: h.days.size, notDone: h.notDone.size }));
  const stepVals = dates.map((d) => dayMap.get(d)?.steps ?? null).filter((v): v is number => v !== null);

  // ---- efficiency
  const ratios = est.filter((e) => e.estimate > 0).map((e) => e.actual / e.estimate).sort((a, b) => a - b);
  const estimateRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;

  // ---- needs attention
  const attention: AttentionItem[] = [];
  const weekAgo = addDays(ctx.today, -6);
  if (rot.length) {
    const worst = rot[0];
    attention.push({
      id: "rot",
      severity: rot.some((r) => r.carry >= ctx.s.rot_threshold + 2) ? "high" : "medium",
      title: `${rot.length} task${rot.length === 1 ? "" : "s"} keep getting carried over`,
      detail: `"${worst.title}" has been carried ${worst.carry} times. Do it, break it down or drop it.`,
      href: "/stats#rotting",
    });
  }
  const overdue = (await listCadence(ctx)).filter((c) => c.overdue);
  if (overdue.length) {
    const c = overdue[0];
    attention.push({
      id: "cadence",
      severity: c.daysSince >= c.limit * 2 ? "high" : "medium",
      title: `${overdue.length} habit${overdue.length === 1 ? "" : "s"} overdue`,
      detail: `${c.task.title}: ${c.daysSince} of ${c.limit} days since last done.`,
      href: "/goals",
    });
  }
  const behind = await targetsBehind(ctx);
  if (behind.length) {
    attention.push({
      id: "targets",
      severity: "medium",
      title: `${behind.length} target${behind.length === 1 ? "" : "s"} behind pace`,
      detail: `${behind[0].task.title} has ${behind[0].daysLeft} day${behind[0].daysLeft === 1 ? "" : "s"} left.`,
      href: "/goals",
    });
  }
  if (current.unaccountedPct !== null && current.unaccountedPct > 20) {
    attention.push({
      id: "unaccounted",
      severity: current.unaccountedPct > 35 ? "high" : "medium",
      title: `${Math.round(current.unaccountedPct)}% of worked time is unaccounted`,
      detail: "The target is below 20%. Log minutes on tasks as you finish them.",
      href: "/stats",
    });
  }
  if (current.mustDoHitRate !== null && current.mustDoHitRate < 0.6) {
    attention.push({
      id: "mustdo",
      severity: "medium",
      title: `Must-do hit rate is ${Math.round(current.mustDoHitRate * 100)}%`,
      detail: "Fewer must-dos, chosen more carefully, tend to get done.",
      href: "/plan",
    });
  }
  const streak = await planningStreak(ctx);
  if (streak === 0) {
    attention.push({
      id: "planning",
      severity: "medium",
      title: "You have not planned ahead recently",
      detail: "Planning tomorrow before the day boundary is the habit everything else depends on.",
      href: `/plan?date=${addDays(ctx.today, 1)}`,
    });
  }
  if (current.avgScore !== null && previous.avgScore !== null && current.avgScore - previous.avgScore <= -1) {
    attention.push({
      id: "score",
      severity: "medium",
      title: "Your average score dropped",
      detail: `${current.avgScore.toFixed(1)} against ${previous.avgScore.toFixed(1)} in the previous ${len} days.`,
      href: "/stats",
    });
  }
  if (stepVals.length >= 3 && stepVals.reduce((a, b) => a + b, 0) / stepVals.length < ctx.s.step_goal * 0.7) {
    attention.push({
      id: "steps",
      severity: "info",
      title: "Steps are well under your goal",
      detail: `Average ${Math.round(stepVals.reduce((a, b) => a + b, 0) / stepVals.length).toLocaleString("en-US")} against a goal of ${ctx.s.step_goal.toLocaleString("en-US")}.`,
      href: "/health",
    });
  }
  const recent = await q<{ date: DateStr }>("select date from days where date between $1 and $2 and score is not null", [weekAgo, ctx.today]);
  if (recent.length < 4 && ctx.today >= from) {
    attention.push({
      id: "noscore",
      severity: "info",
      title: `Score entered on ${recent.length} of the last 7 days`,
      detail: "The score is only useful next to the hours if it is entered every day.",
      href: "/today",
    });
  }
  const order = { high: 0, medium: 1, info: 2 } as const;
  attention.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    filters: f,
    previousRange: prevRange,
    summary: { current, previous, planningStreak: streak, mustDoStreak: await mustDoStreak(ctx) },
    efficiency: {
      utilizationPct: current.unaccountedPct === null ? null : 100 - current.unaccountedPct,
      estimateRatio,
      tasksPerHour: current.tasksPerHour,
    },
    series,
    weekday,
    hoursByProject: byProject.map((r) => ({ id: r.id, name: r.name, color: r.color ?? "#94a3b8", minutes: r.minutes })),
    projectProgress,
    drill,
    estimateVsActual: est,
    rotting: rot,
    cadence,
    heatmap: facts.map((d) => ({ date: d.date, score: d.score })),
    health: {
      setsPerDay: dates.map((d) => ({ date: d, sets: setsByDay.get(d) ?? 0 })),
      amountByType: [...amountByType.entries()].map(([id, amount]) => {
        const t = types.find((x) => x.id === id);
        return { name: t?.name ?? "Removed exercise", unit: t?.unit ?? "reps", amount };
      }),
      stepsPerDay: dates.map((d) => ({ date: d, steps: dayMap.get(d)?.steps ?? null })),
      stepGoal: ctx.s.step_goal,
    },
    attention,
    insights: computeInsights(facts, slotFacts),
    totals: { minutes: byProject.reduce((a, r) => a + r.minutes, 0), days: len },
  };
}

function zonedDay(ctx: Ctx, at: Date): DateStr {
  const p = zonedParts(new Date(at.getTime() - ctx.boundaryMin * 60_000), ctx.tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function presetRange(ctx: Ctx, days: number): { from: DateStr; to: DateStr } {
  return { from: addDays(ctx.today, -(days - 1)), to: ctx.today };
}
