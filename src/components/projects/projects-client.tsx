"use client";

import {
  Archive, CheckCircle2, ChevronDown, Circle, Clock, FolderOpen, Plus, RotateCcw, Search, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createProjectAction, updateProjectAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { fmtDuration } from "@/lib/time";
import { Button, Chip, Empty, Input, Progress } from "../ui";
import type { ProjectTask } from "@/lib/services/projects";

interface Project {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  activeTasks: number;
  doneTasks: number;
  droppedTasks: number;
  completionPct: number | null;
}

// ─── unified project card ─────────────────────────────────────────────────────

function ProjectCard({
  project,
  tasks,
  pending,
  onSave,
}: {
  project: Project;
  tasks: ProjectTask[];
  pending: boolean;
  onSave: (patch: { name?: string; color?: string; archived?: boolean }) => void;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [tasksOpen, setTasksOpen] = useState(false);
  const dirty = name !== project.name || color !== project.color;

  const active = tasks.filter((t) => t.state === "active");
  const done = tasks.filter((t) => t.state === "done");
  const pct = project.completionPct ?? 0;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface overflow-hidden transition-opacity",
        project.archived ? "border-border/50 opacity-60" : "border-border",
      )}
    >
      {/* ── top bar: color + name + save + archive ── */}
      <div className="flex items-center gap-2 p-3 border-b border-border/50">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`Colour for ${project.name}`}
          className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
          disabled={project.archived}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          className="h-8 min-w-0 flex-1 text-sm font-medium"
          disabled={project.archived}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={pending || !dirty || project.archived}
          onClick={() => onSave({ name: name.trim(), color })}
          className="shrink-0"
        >
          Save
        </Button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave({ archived: !project.archived })}
          title={project.archived ? "Restore project" : "Archive project"}
          className="shrink-0 rounded-lg p-1.5 text-subtle hover:bg-muted hover:text-fg transition-colors"
        >
          {project.archived ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* ── progress bar + stats ── */}
      {!project.archived ? (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-3 text-xs text-subtle">
              <span className="flex items-center gap-1">
                <Circle className="h-3 w-3" />
                {project.activeTasks} active
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-good" />
                {project.doneTasks} done
              </span>
              {project.droppedTasks > 0 ? (
                <span>{project.droppedTasks} dropped</span>
              ) : null}
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular",
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
          <Progress value={pct / 100} tone="accent" />
        </div>
      ) : null}

      {/* ── task list toggle ── */}
      {tasks.length > 0 && !project.archived ? (
        <>
          <button
            type="button"
            onClick={() => setTasksOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-subtle hover:text-fg hover:bg-muted/50 transition-colors"
          >
            <span>{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", tasksOpen && "rotate-180")} />
          </button>

          {tasksOpen ? (
            <ul className="border-t border-border/50 divide-y divide-border/50">
              {active.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Circle className="h-3.5 w-3.5 shrink-0 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/task/${t.id}`}
                      className="text-sm font-medium hover:underline underline-offset-2 block truncate"
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
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 opacity-50">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-good" />
                  <Link
                    href={`/task/${t.id}`}
                    className="text-sm text-subtle hover:underline underline-offset-2 line-through block truncate"
                  >
                    {t.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function ProjectsClient({
  projects,
  tasksByProject,
}: {
  projects: Project[];
  tasksByProject: Record<number, ProjectTask[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newProject, setNewProject] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to search, like most apps; ignored while typing in another field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || t.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function call(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => { await fn(); router.refresh(); });
  }

  const q = query.trim().toLowerCase();
  // a project matches on its own name or on any of its task titles
  const matches = (p: Project) =>
    !q || p.name.toLowerCase().includes(q) || (tasksByProject[p.id] ?? []).some((t) => t.title.toLowerCase().includes(q));
  const active = projects.filter((p) => !p.archived && matches(p));
  const archived = projects.filter((p) => p.archived && matches(p));
  const archivedOpen = showArchived || !!q;
  const shown = active.length + archived.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Projects</h1>
          <p className="mt-1 text-sm text-subtle">
            Type <code className="rounded bg-muted px-1 py-0.5 text-xs">Name:</code> in the quick-add bar to create a project automatically.
          </p>
        </div>
        {projects.length > 0 ? (
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search projects and tasks"
              aria-label="Search projects and tasks"
              className="pl-9 pr-16 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-subtle hover:bg-muted hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 text-[10px] font-medium text-subtle">/</kbd>
            )}
          </div>
        ) : null}
      </div>

      {q ? (
        <p className="-mt-2 text-sm text-subtle">
          {shown === 0 ? <>No project or task matches <strong className="text-fg">{query.trim()}</strong>.</> : <>{shown} of {projects.length} project{projects.length === 1 ? "" : "s"} match</>}
        </p>
      ) : null}

      {projects.length === 0 ? (
        <Empty>
          No projects yet. Add one below or type <code>Name:</code> in the quick-add bar.
        </Empty>
      ) : null}

      {/* active projects */}
      {active.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
            <FolderOpen className="h-3.5 w-3.5" /> Active · {active.length}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((p) => (
              <ProjectCard
                key={`${p.id}-${p.name}-${p.color}`}
                project={p}
                tasks={tasksByProject[p.id] ?? []}
                pending={pending}
                onSave={(patch) => call(() => updateProjectAction(p.id, patch))}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* add new */}
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
          placeholder="New project name…"
          aria-label="New project"
        />
        <Button type="submit" variant="outline" disabled={pending || !newProject.trim()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>

      {/* archived (collapsed by default) */}
      {archived.length > 0 ? (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle hover:text-fg transition-colors"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", archivedOpen && "rotate-180")} />
            Archived · {archived.length}
          </button>
          {archivedOpen ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {archived.map((p) => (
                <ProjectCard
                  key={`${p.id}-${p.name}`}
                  project={p}
                  tasks={[]}
                  pending={pending}
                  onSave={(patch) => call(() => updateProjectAction(p.id, patch))}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
