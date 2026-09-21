import type { Metadata } from "next";
import { HealthClient } from "@/components/health/health-client";
import { makeCtx } from "@/lib/settings";
import { fmtDateLong, fmtHM } from "@/lib/time";
import { getDay } from "@/lib/services/days";
import { exerciseCounts, exerciseGrid, lastExercise, listExerciseTypes } from "@/lib/services/health";

export const metadata: Metadata = { title: "Health" };
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const ctx = await makeCtx();
  const [grid, types, day, counts, last] = await Promise.all([
    exerciseGrid(ctx, ctx.today),
    listExerciseTypes(false),
    getDay(ctx.today),
    exerciseCounts(ctx.today),
    lastExercise(),
  ]);
  return (
    <HealthClient
      date={ctx.today}
      dateLabel={fmtDateLong(ctx.today)}
      cells={grid.map((c) => ({
        iso: c.slot.toISOString(),
        label: fmtHM(c.slot, ctx.tz),
        status: c.status,
        typeName: c.typeName,
        unit: c.unit,
        amount: c.amount,
        extraNames: c.extraNames,
      }))}
      types={types.map((t) => ({ id: t.id, name: t.name, defaultAmount: t.default_amount, unit: t.unit, active: t.active }))}
      steps={day?.steps ?? null}
      stepGoal={ctx.s.step_goal}
      counts={counts}
      defaultTypeId={last?.type.id ?? types.find((t) => t.active)?.id ?? null}
      defaultAmount={last?.amount ?? types.find((t) => t.active)?.default_amount ?? 20}
      paused={ctx.s.exercise_paused}
    />
  );
}
