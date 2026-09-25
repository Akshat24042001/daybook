import type { Metadata } from "next";
import { GoalsClient } from "@/components/goals/goals-client";
import { makeCtx } from "@/lib/settings";
import { fmtDateShort } from "@/lib/time";
import { addDays } from "@/lib/time";
import { listCadence, listSomeday, listTargets } from "@/lib/services/goals";
import { timeGoals } from "@/lib/services/time-goals";
import { TimeGoalsCard } from "@/components/goals/time-goals-card";
import { periodBounds } from "@/lib/services/review";

export const metadata: Metadata = { title: "Goals" };
export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const ctx = await makeCtx();
  const week = periodBounds("week", ctx.today);
  const [targets, cadence, someday, goals] = await Promise.all([
    listTargets(ctx), listCadence(ctx), listSomeday(), timeGoals(ctx, week.start, week.end),
  ]);
  const shape = (p: (typeof targets.week)[number]) => ({
    id: p.task.id,
    title: p.task.title,
    project: p.task.project_name ?? null,
    period: p.task.target_period,
    range: `${fmtDateShort(p.start)} to ${fmtDateShort(p.end)}`,
    minutes: p.minutes,
    count: p.count,
    goalMin: p.task.goal_min,
    goalCount: p.task.goal_count,
    minFraction: p.minFraction ?? null,
    countFraction: p.countFraction ?? null,
    elapsed: p.elapsed,
    daysLeft: p.daysLeft,
    met: p.met,
    behind: p.behind,
    hasGoal: p.hasGoal,
    done: p.task.state === "done",
  });
  return (
    <div className="mx-auto max-w-6xl">
    <GoalsClient
      today={ctx.today}
      tomorrow={addDays(ctx.today, 1)}
      targets={{ week: targets.week.map(shape), month: targets.month.map(shape), quarter: targets.quarter.map(shape), year: targets.year.map(shape) }}
      cadence={cadence.map((c) => ({
        id: c.task.id,
        title: c.task.title,
        project: c.task.project_name ?? null,
        daysSince: c.daysSince,
        limit: c.limit,
        overdue: c.overdue,
        snoozed: !!c.task.nudge_snoozed_until && c.task.nudge_snoozed_until >= ctx.today,
      }))}
      timeGoals={<TimeGoalsCard report={goals} title="Time goals · this week" />}
      someday={someday.map((t) => ({ id: t.id, title: t.title, project: t.project_name ?? null, estimate: t.estimate_min }))}
    />
    </div>
  );
}
