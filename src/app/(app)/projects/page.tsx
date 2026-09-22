import type { Metadata } from "next";
import { ProjectsClient } from "@/components/projects/projects-client";
import { listProjectSummaries, listTasksForProject } from "@/lib/services/projects";
import { q } from "@/lib/db";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [summaries, managed] = await Promise.all([
    listProjectSummaries(),
    q<{ id: number; name: string; color: string; archived: boolean }>(
      "select id, name, color, archived from projects order by archived, lower(name)",
    ),
  ]);
  const tasksByProject: Record<number, Awaited<ReturnType<typeof listTasksForProject>>> = {};
  await Promise.all(
    summaries.map(async (p) => {
      tasksByProject[p.id] = await listTasksForProject(p.id);
    }),
  );
  return <ProjectsClient projects={summaries} managed={managed} tasksByProject={tasksByProject} />;
}
