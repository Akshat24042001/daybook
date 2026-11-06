import type { Metadata } from "next";
import { TasksView } from "@/components/tasks/tasks-view";
import { allTasks, taskLog } from "@/lib/services/tasks";

export const metadata: Metadata = { title: "All tasks" };
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const [tasks, log] = await Promise.all([allTasks(), taskLog()]);
  return <TasksView tasks={tasks} log={log} />;
}
