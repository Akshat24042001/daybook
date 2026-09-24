import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlanClient } from "@/components/plan/plan-client";
import { makeCtx } from "@/lib/settings";
import { addDays, fmtDateLong } from "@/lib/time";
import { planView } from "@/lib/services/plan";
import { planningStreak } from "@/lib/services/days";
import { toRow } from "@/lib/view-types";

export const metadata: Metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const ctx = await makeCtx();
  if (!date || !DATE.test(date)) redirect(`/plan?date=${addDays(ctx.today, 1)}`);

  const view = await planView(ctx, date);
  const streak = await planningStreak(ctx);
  return (
    <div className="mx-auto max-w-4xl">
    <PlanClient
      date={date}
      today={ctx.today}
      dateLabel={fmtDateLong(date)}
      triage={view.triage.map((e) => ({ ...toRow(ctx, e), date: e.date }))}
      entries={view.entries.map((e) => toRow(ctx, e))}
      capacity={view.capacity}
      mustDoCount={view.mustDoCount}
      mustCap={ctx.s.must_do_cap}
      someday={view.suggestions.someday.map((t) => ({ id: t.id, title: t.title, project: t.project_name ?? null, estimate: t.estimate_min }))}
      targets={view.suggestions.targets.map((p) => ({
        id: p.task.id,
        title: p.task.title,
        daysLeft: p.daysLeft,
        detail: p.task.goal_min ? `${Math.round(p.minutes / 60 * 10) / 10}h of ${Math.round(p.task.goal_min / 60 * 10) / 10}h` : p.task.goal_count ? `${p.count} of ${p.task.goal_count}` : "not done yet",
      }))}
      plannedAt={view.plannedAt ? view.plannedAt.toISOString() : null}
      streak={streak}
      availableHours={ctx.s.available_hours}
    />
    </div>
  );
}
