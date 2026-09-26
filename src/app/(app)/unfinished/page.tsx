import type { Metadata } from "next";
import { UnfinishedClient } from "@/components/unfinished/unfinished-client";
import { makeCtx } from "@/lib/settings";
import { unfinishedTasks, waitingTasks } from "@/lib/services/unfinished";
import { fmtRelDay } from "@/lib/time";
import { toUnfinishedRow } from "@/lib/view-types";

export const metadata: Metadata = { title: "Unfinished" };
export const dynamic = "force-dynamic";

export default async function UnfinishedPage() {
  const ctx = await makeCtx();
  const [tasks, parked] = await Promise.all([unfinishedTasks(ctx.today), waitingTasks(ctx.today)]);
  const rows = tasks.map((t) => toUnfinishedRow(ctx.today, t));
  const waiting = parked.map((w) => ({
    taskId: w.taskId,
    title: w.title,
    projectName: w.projectName,
    projectColor: w.projectColor,
    waitingOn: w.waitingOn,
    sinceLabel: w.since ? fmtRelDay(w.since, ctx.today) : null,
    untilLabel: fmtRelDay(w.until, ctx.today),
  }));
  return (
    <div className="mx-auto max-w-4xl">
      <UnfinishedClient rows={rows} waiting={waiting} />
    </div>
  );
}
