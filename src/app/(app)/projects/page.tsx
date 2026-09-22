import type { Metadata } from "next";
import { ProjectsClient } from "@/components/projects/projects-client";
import { listProjectSummaries, listTasksForProject } from "@/lib/services/projects";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjectSummaries();
  const tasksByProject: Record<number, Awaited<ReturnType<typeof listTasksForProject>>> = {};
  await Promise.all(
    projects.map(async (p) => {
      tasksByProject[p.id] = await listTasksForProject(p.id);
    }),
  );
  return <ProjectsClient projects={projects} tasksByProject={tasksByProject} />;
}
