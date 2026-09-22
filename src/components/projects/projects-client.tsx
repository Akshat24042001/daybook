"use client";

import { CheckCircle2, Circle, Clock, FolderOpen } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProjectAction, updateProjectAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { fmtDuration } from "@/lib/time";
import { Button, Card, Chip, Empty, Input, Progress } from "../ui";
import type { ProjectSummary, ProjectTask } from "@/lib/services/projects";

function statusColor(state: string) {
  if (state === "done") return "text-good";
  if (state === "dropped") return "text-subtle line-through";
  return "text-fg";
}

function ProjectCard({
  project,
  tasks,
}: {
  project: ProjectSummary;
  tasks: ProjectTask[];
}) {
  const [expanded, setExpanded] = useState(false);
  const active = tasks.filter((t) => t.state === "active");
  const done = tasks.filter((t) => t.state === "done");
  const pct = project.completionPct ?? 0;

  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: project.color }}
            />
            <h3 className="font-semibold leading-snug">{project.name}</h3>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              pct === 100
                ? "bg-good/15 text-good"
                : pct >= 50
                ? "bg-accent/15 text-accent"
                : "bg-muted text-subtle",
            )}
          >
            {pct}%
          </span>
        </div>

        <div className="mt-3">
          <Progress value={pct / 100} tone="accent" />
          <div className="mt-1.5 flex items-center gap-3 text-xs text-subtle">
            <span className="flex items-center gap-1">
              <Circle className="h-3 w-3" /> {project.activeTasks} active
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-good" /> {project.doneTasks} done
            </span>
            {project.droppedTasks > 0 ? (
              <span>{project.droppedTasks} dropped</span>
            ) : null}
          </div>
        </div>

        {tasks.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 text-xs font-medium text-accent hover:underline underline-offset-2"
          >
            {expanded ? "Hide tasks" : `Show ${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-border">
          <ul className="divide-y divide-border">
            {active.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <Circle className="h-4 w-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/task/${t.id}`}
                    className="text-sm font-medium hover:underline underline-offset-2"
                  >
                    {t.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-subtle">
                    {t.estimateMin ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {fmtDuration(t.estimateMin)}
                      </span>
                    ) : null}
                    {t.dueDate ? <span>due {t.dueDate}</span> : null}
                    {t.carry > 0 ? (
                      <Chip className={cn("text-[10px]", t.carry >= 3 ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn")}>
                        carried {t.carry}×
                      </Chip>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
            {done.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-good" />
                <Link
                  href={`/task/${t.id}`}
                  className="text-sm text-subtle hover:underline underline-offset-2 line-through"
                >
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function ManageProjectRow({
  p,
  pending,
  onSave,
}: {
  p: { id: number; name: string; color: string; archived: boolean };
  pending: boolean;
  onSave: (patch: { name?: string; color?: string; archived?: boolean }) => void;
}) {
  const [name, setName] = useState(p.name);
  const [color, setColor] = useState(p.color);
  const dirty = name !== p.name || color !== p.color;
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-surface p-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        aria-label={`Colour for ${p.name}`}
        className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Project name"
        className={p.archived ? "opacity-60" : ""}
      />
      <Button size="sm" variant="primary" disabled={pending || !dirty} onClick={() => onSave({ name, color })}>
        Save
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => onSave({ archived: !p.archived })}>
        {p.archived ? "Restore" : "Archive"}
      </Button>
    </li>
  );
}

export function ProjectsClient({
  projects,
  managed,
  tasksByProject,
}: {
  projects: ProjectSummary[];
  managed: { id: number; name: string; color: string; archived: boolean }[];
  tasksByProject: Record<number, ProjectTask[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newProject, setNewProject] = useState("");

  function call(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  const active = projects.filter((p) => p.activeTasks > 0 || p.doneTasks > 0);
  const empty = projects.filter((p) => p.activeTasks === 0 && p.doneTasks === 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Projects</h1>
        <p className="mt-1 text-sm text-subtle">
          Tasks are grouped by project. Assign a project when creating or editing any task.
        </p>
      </header>

      {/* manage: rename, recolour, archive */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Manage</h2>
        {managed.length === 0 ? (
          <p className="text-sm text-subtle">No projects yet.</p>
        ) : (
          <ul className="space-y-2">
            {managed.map((p) => (
              <ManageProjectRow
                key={`${p.id}-${p.name}-${p.color}-${p.archived}`}
                p={p}
                pending={pending}
                onSave={(patch) => call(() => updateProjectAction(p.id, patch))}
              />
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newProject.trim()) return;
            call(() => createProjectAction(newProject));
            setNewProject("");
          }}
        >
          <Input
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            placeholder="New project name"
            aria-label="New project"
          />
          <Button type="submit" variant="outline" disabled={pending || !newProject.trim()}>
            Add
          </Button>
        </form>
      </section>

      {/* progress overview */}
      {projects.length > 0 ? (
        <>
          {active.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle flex items-center gap-1.5">
                <FolderOpen className="h-4 w-4" /> Active ({active.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((p) => (
                  <ProjectCard key={p.id} project={p} tasks={tasksByProject[p.id] ?? []} />
                ))}
              </div>
            </section>
          ) : null}

          {empty.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                No tasks yet ({empty.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {empty.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-subtle"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    {p.name}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <Empty>
          No projects yet. Add one above or type <code>Name:</code> in the quick-add bar — it creates the project automatically.
        </Empty>
      )}
    </div>
  );
}
