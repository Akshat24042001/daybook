import type { Metadata } from "next";
import { ProjectsClient } from "@/components/projects/projects-client";
import { listTasksForProject } from "@/lib/services/projects";
import { q } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import { periodBounds } from "@/lib/services/review";
import { timeGoals } from "@/lib/services/time-goals";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const ctx = await makeCtx();
  const week = periodBounds("week", ctx.today);
  // also makes sure the weekly_target_min column exists before the query below
  const goals = await timeGoals(ctx, week.start, week.end);
  const weekMin = new Map(goals.goals.map((g) => [g.projectId, g.actualMin]));
  // fetch all projects (including archived) with task counts
  const rows = await q<{
    id: number; name: string; color: string; archived: boolean; weekly_target_min: number | null;
    active: number; done: number; dropped: number;
  }>(
    `select p.id, p.name, p.color, p.archived, p.weekly_target_min,
       count(*) filter (where t.state = 'active')::int as active,
       count(*) filter (where t.state = 'done')::int as done,
       count(*) filter (where t.state = 'dropped')::int as dropped
     from projects p
     left join tasks t on t.project_id = p.id and t.type <> 'someday'
     group by p.id
     order by p.archived, lower(p.name)`,
  );

  const tasksByProject: Record<number, Awaited<ReturnType<typeof listTasksForProject>>> = {};
  await Promise.all(
    rows.filter((r) => !r.archived).map(async (r) => {
      tasksByProject[r.id] = await listTasksForProject(r.id);
    }),
  );

  const projects = rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    archived: r.archived,
    activeTasks: r.active,
    doneTasks: r.done,
    droppedTasks: r.dropped,
    weeklyTargetMin: r.weekly_target_min,
    weekMin: weekMin.get(r.id) ?? 0,
    weekElapsed: goals.elapsed,
    completionPct:
      r.active + r.done === 0 ? null : Math.round((r.done / (r.active + r.done)) * 100),
  }));

  return <div className="mx-auto max-w-6xl"><ProjectsClient projects={projects} tasksByProject={tasksByProject} /></div>;
}
