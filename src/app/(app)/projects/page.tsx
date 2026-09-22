import type { Metadata } from "next";
import { ProjectsClient } from "@/components/projects/projects-client";
import { listTasksForProject } from "@/lib/services/projects";
import { q } from "@/lib/db";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  // fetch all projects (including archived) with task counts
  const rows = await q<{
    id: number; name: string; color: string; archived: boolean;
    active: number; done: number; dropped: number;
  }>(
    `select p.id, p.name, p.color, p.archived,
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
    completionPct:
      r.active + r.done === 0 ? null : Math.round((r.done / (r.active + r.done)) * 100),
  }));

  return <ProjectsClient projects={projects} tasksByProject={tasksByProject} />;
}
