import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskForm } from "@/components/task/task-form";
import { q } from "@/lib/db";
import { deepgramReady } from "@/lib/voice-config";
import { makeCtx } from "@/lib/settings";
import { fmtDateShort, fmtHM, logicalDate } from "@/lib/time";
import { getTask } from "@/lib/services/tasks";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) notFound();
  const ctx = await makeCtx();
  const task = await getTask(taskId);
  if (!task) notFound();

  const [history, totals, projects, people] = await Promise.all([
    q<{ date: string; status: string; must_do: boolean }>(
      "select date, status, must_do from day_entries where task_id = $1 order by date desc limit 12",
      [taskId],
    ),
    q<{ minutes: number; days: number }>(
      "select coalesce(sum(minutes),0)::int as minutes, count(distinct date)::int as days from time_logs where task_id = $1",
      [taskId],
    ),
    q<{ name: string }>("select name from projects where not archived order by lower(name)"),
    q<{ name: string }>("select name from people order by lower(name)"),
  ]);

  return (
    <TaskForm
      mode="edit"
      voiceEnabled={deepgramReady()}
      projects={projects.map((p) => p.name)}
      people={people.map((p) => p.name)}
      today={ctx.today}
      history={history.map((h) => ({ date: fmtDateShort(h.date), status: h.status, mustDo: h.must_do }))}
      totals={totals[0]}
      task={{
        id: task.id,
        title: task.title,
        notes: task.notes ?? "",
        type: task.type,
        project: task.project_name ?? "",
        person: task.person_name ?? "",
        personRole: task.person_role ?? "with",
        via: task.via ?? "",
        isPersonal: task.is_personal,
        estimateMin: task.estimate_min,
        dueDate: task.due_date ?? "",
        dueTime: task.due_at ? fmtHM(task.due_at, ctx.tz) : "",
        leadMin: task.lead_min,
        cadenceDays: task.cadence_days,
        rrule: task.rrule ?? "",
        targetPeriod: task.target_period,
        goalMin: task.goal_min,
        goalCount: task.goal_count,
        state: task.state,
        carry: task.carry_count,
        createdDay: logicalDate(task.created_at, ctx.tz, ctx.boundaryMin),
      }}
    />
  );
}
