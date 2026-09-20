import { one, q, tx, type Db, getPool } from "../db";
import { type Ctx, isWorkingDay } from "../settings";
import {
  type DateStr,
  type TargetPeriod,
  addDays,
  dateRange,
  diffDays,
  logicalDate,
  periodEnd,
  periodStart,
} from "../time";
import type { TaskRow } from "../types";
import { addEntry } from "./entries";

const TASK_SELECT = `
  select t.*, p.name as project_name, p.color as project_color, pe.name as person_name
  from tasks t
  left join projects p on p.id = t.project_id
  left join people pe on pe.id = t.person_id`;

export interface TargetProgress {
  task: TaskRow;
  start: DateStr;
  end: DateStr;
  minutes: number;
  count: number;
  /** 0..1+ per goal component, undefined when that goal is not set */
  minFraction?: number;
  countFraction?: number;
  /** Fraction of working days already completed in the period (0..1). */
  elapsed: number;
  daysLeft: number;
  met: boolean;
  behind: boolean;
  hasGoal: boolean;
}

const BEHIND_TOLERANCE = 0.1;

/** Working days completed before today / total working days in the period. */
export function elapsedFraction(ctx: Ctx, start: DateStr, end: DateStr): number {
  const days = dateRange(start, end);
  const working = days.filter((d) => isWorkingDay(ctx, d));
  if (working.length === 0) {
    const total = days.length;
    return Math.min(1, Math.max(0, diffDays(ctx.today, start) / total));
  }
  const done = working.filter((d) => d < ctx.today).length;
  return Math.min(1, done / working.length);
}

export function computePace(args: {
  minutes: number;
  count: number;
  goalMin: number | null;
  goalCount: number | null;
  elapsed: number;
  done: boolean;
}): { minFraction?: number; countFraction?: number; met: boolean; behind: boolean; hasGoal: boolean } {
  const { minutes, count, goalMin, goalCount, elapsed, done } = args;
  const minFraction = goalMin ? minutes / goalMin : undefined;
  const countFraction = goalCount ? count / goalCount : undefined;
  const hasGoal = !!(goalMin || goalCount);
  const goalsMet = hasGoal && (minFraction === undefined || minFraction >= 1) && (countFraction === undefined || countFraction >= 1);
  const met = done || goalsMet;
  let behind = false;
  if (!met) {
    if (hasGoal) {
      const worst = Math.min(minFraction ?? Infinity, countFraction ?? Infinity);
      behind = worst + BEHIND_TOLERANCE < elapsed;
    } else {
      behind = elapsed >= 0.5;
    }
  }
  return { minFraction, countFraction, met, behind, hasGoal };
}

export function targetBounds(ctx: Ctx, t: TaskRow): { start: DateStr; end: DateStr } {
  const period = (t.target_period ?? "week") as TargetPeriod;
  const start = t.period_start ?? periodStart(ctx.today, period);
  return { start, end: periodEnd(start, period) };
}

export async function targetProgress(ctx: Ctx, t: TaskRow, db: Db = getPool()): Promise<TargetProgress> {
  const { start, end } = targetBounds(ctx, t);
  const m = await one<{ minutes: number }>(
    "select coalesce(sum(minutes),0)::int as minutes from time_logs where task_id = $1 and date between $2 and $3",
    [t.id, start, end],
    db,
  );
  const c = await one<{ n: number }>(
    "select count(*)::int as n from day_entries where task_id = $1 and date between $2 and $3 and status in ('done','progressed')",
    [t.id, start, end],
    db,
  );
  const elapsed = elapsedFraction(ctx, start, end);
  const pace = computePace({
    minutes: m!.minutes,
    count: c!.n,
    goalMin: t.goal_min,
    goalCount: t.goal_count,
    elapsed,
    done: t.state === "done",
  });
  return {
    task: t,
    start,
    end,
    minutes: m!.minutes,
    count: c!.n,
    elapsed,
    daysLeft: Math.max(0, diffDays(end, ctx.today)),
    ...pace,
  };
}

/** Targets whose period contains today (active ones, plus ones already completed this period). */
export async function listTargets(ctx: Ctx, db: Db = getPool()): Promise<Record<TargetPeriod, TargetProgress[]>> {
  const rows = await q<TaskRow>(
    `${TASK_SELECT} where t.type = 'target' and t.state in ('active','done') order by t.period_start, t.id`,
    [],
    db,
  );
  const out: Record<TargetPeriod, TargetProgress[]> = { week: [], month: [], quarter: [] };
  for (const t of rows) {
    const { start, end } = targetBounds(ctx, t);
    if (ctx.today < start || ctx.today > end) continue;
    out[(t.target_period ?? "week") as TargetPeriod].push(await targetProgress(ctx, t, db));
  }
  return out;
}

export async function targetsBehind(ctx: Ctx, db: Db = getPool()): Promise<TargetProgress[]> {
  const all = await listTargets(ctx, db);
  return [...all.week, ...all.month, ...all.quarter].filter((p) => p.task.state === "active" && p.behind);
}

export interface CadenceStatus {
  task: TaskRow;
  daysSince: number;
  limit: number;
  overdue: boolean;
  lastDoneDay: DateStr | null;
}

export function cadenceStatus(ctx: Ctx, t: TaskRow, asOf: DateStr = ctx.today): CadenceStatus {
  const anchor = t.last_done_at ?? t.created_at;
  const anchorDay = logicalDate(anchor, ctx.tz, ctx.boundaryMin);
  const daysSince = Math.max(0, diffDays(asOf, anchorDay));
  const limit = t.cadence_days ?? 7;
  return {
    task: t,
    daysSince,
    limit,
    overdue: daysSince >= limit,
    lastDoneDay: t.last_done_at ? logicalDate(t.last_done_at, ctx.tz, ctx.boundaryMin) : null,
  };
}

export async function listCadence(ctx: Ctx, asOf: DateStr = ctx.today, db: Db = getPool()): Promise<CadenceStatus[]> {
  const rows = await q<TaskRow>(`${TASK_SELECT} where t.type = 'cadence' and t.state = 'active' order by t.id`, [], db);
  return rows
    .map((t) => cadenceStatus(ctx, t, asOf))
    .sort((a, b) => b.daysSince / b.limit - a.daysSince / a.limit);
}

/** Cadence tasks that should be nudged today: overdue and not snoozed. */
export async function cadenceToNudge(ctx: Ctx, db: Db = getPool()): Promise<CadenceStatus[]> {
  const all = await listCadence(ctx, ctx.today, db);
  return all.filter((c) => c.overdue && (!c.task.nudge_snoozed_until || c.task.nudge_snoozed_until < ctx.today));
}

/** "Snooze 1 day": skip tomorrow's nudge too, so the next one comes the day after. */
export async function snoozeCadence(ctx: Ctx, taskId: number): Promise<void> {
  await q("update tasks set nudge_snoozed_until = $2 where id = $1", [taskId, addDays(ctx.today, 1)]);
}

export async function listSomeday(db: Db = getPool()): Promise<TaskRow[]> {
  return q<TaskRow>(`${TASK_SELECT} where t.type = 'someday' and t.state = 'active' order by t.sort, t.id`, [], db);
}

export async function reorderSomeday(id: number, direction: "up" | "down"): Promise<void> {
  await tx(async (db) => {
    const rows = await q<{ id: number }>(
      "select id from tasks where type = 'someday' and state = 'active' order by sort, id for update",
      [],
      db,
    );
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    for (let k = 0; k < ids.length; k++) await db.query("update tasks set sort = $2 where id = $1", [ids[k], k + 1]);
  });
}

/** One tap: add a Someday / cadence / target task to a date. */
export async function addToDay(ctx: Ctx, taskId: number, date: DateStr, mustDo = false) {
  return addEntry(ctx, taskId, date, { source: "planned", mustDo });
}
