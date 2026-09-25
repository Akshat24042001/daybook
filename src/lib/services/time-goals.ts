/**
 * Time goals: a weekly hours budget per project, compared with the minutes actually logged on its tasks.
 * For any date range the budget scales with the range (a month is about 4.3 weekly budgets), and "pace" says how
 * much of the range has already passed, so a Tuesday is not judged against a full week.
 */
import { q, UserError } from "../db";
import type { Ctx } from "../settings";
import { dateRange, diffDays, type DateStr } from "../time";

export type TimeGoalStatus = "done" | "on_track" | "behind" | "not_started";

export interface TimeGoal {
  projectId: number;
  name: string;
  color: string;
  weeklyTargetMin: number;
  /** budget for the whole range */
  targetMin: number;
  actualMin: number;
  /** what should be logged by now at an even pace */
  expectedMin: number;
  status: TimeGoalStatus;
}

export interface TimeGoalReport {
  from: DateStr;
  to: DateStr;
  /** 0..1 share of the range that has passed */
  elapsed: number;
  goals: TimeGoal[];
  /** logged minutes on projects with a goal, and on everything else */
  goalMin: number;
  otherMin: number;
  otherByProject: { name: string; color: string | null; minutes: number }[];
}

// Migration 014 adds the column on cold start; this covers the first request after a deploy that skipped it.
let ensured: Promise<unknown> | null = null;
function ensureColumn(): Promise<unknown> {
  ensured ??= q(
    `alter table projects add column if not exists weekly_target_min int
       check (weekly_target_min is null or (weekly_target_min > 0 and weekly_target_min <= 10080))`,
  ).catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

export async function setProjectTimeGoal(projectId: number, weeklyMin: number | null): Promise<void> {
  await ensureColumn();
  if (weeklyMin !== null && (!Number.isFinite(weeklyMin) || weeklyMin <= 0 || weeklyMin > 10080)) {
    throw new UserError("A weekly time goal is between a few minutes and 168 hours.");
  }
  await q("update projects set weekly_target_min = $2 where id = $1", [projectId, weeklyMin === null ? null : Math.round(weeklyMin)]);
}

export async function timeGoals(ctx: Ctx, from: DateStr, to: DateStr): Promise<TimeGoalReport> {
  await ensureColumn();
  const days = dateRange(from, to).length;
  const passed = ctx.today < from ? 0 : ctx.today > to ? days : diffDays(ctx.today, from) + 1;
  const elapsed = days > 0 ? passed / days : 1;

  const rows = await q<{ id: number | null; name: string | null; color: string | null; weekly_target_min: number | null; minutes: number }>(
    `select p.id, p.name, p.color, p.weekly_target_min, coalesce(sum(l.minutes), 0)::int as minutes
     from projects p
     left join tasks t on t.project_id = p.id
     left join time_logs l on l.task_id = t.id and l.date between $1 and $2
     where not p.archived
     group by p.id
     union all
     select null, null, null, null, coalesce(sum(l.minutes), 0)::int
     from time_logs l join tasks t on t.id = l.task_id
     where t.project_id is null and l.date between $1 and $2`,
    [from, to],
  );

  const goals: TimeGoal[] = [];
  const otherByProject: TimeGoalReport["otherByProject"] = [];
  for (const r of rows) {
    if (r.id !== null && r.weekly_target_min) {
      const targetMin = Math.round((r.weekly_target_min * days) / 7);
      const expectedMin = Math.round(targetMin * elapsed);
      const status: TimeGoalStatus =
        r.minutes >= targetMin ? "done"
        : r.minutes === 0 && elapsed < 0.3 ? "not_started"
        : r.minutes >= expectedMin * 0.9 ? "on_track"
        : "behind";
      goals.push({
        projectId: r.id, name: r.name!, color: r.color!, weeklyTargetMin: r.weekly_target_min,
        targetMin, actualMin: r.minutes, expectedMin, status,
      });
    } else if (r.minutes > 0) {
      otherByProject.push({ name: r.name ?? "No project", color: r.color, minutes: r.minutes });
    }
  }
  goals.sort((a, b) => b.targetMin - a.targetMin);
  otherByProject.sort((a, b) => b.minutes - a.minutes);
  return {
    from, to, elapsed, goals, otherByProject,
    goalMin: goals.reduce((s, g) => s + g.actualMin, 0),
    otherMin: otherByProject.reduce((s, o) => s + o.minutes, 0),
  };
}
