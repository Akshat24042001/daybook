"use client";

import {
  Archive, CheckCircle2, ChevronDown, Circle, Clock, FolderOpen, Pencil, Plus, RotateCcw, Search, Target, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createProjectAction, updateProjectAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { fmtDay, fmtDuration } from "@/lib/time";
import { setProjectTimeGoalAction } from "@/app/review-actions";
import { usePageSearch } from "../use-page-search";
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
  /** weekly hours budget in minutes, and this week so far */
  weeklyTargetMin: number | null;
  weekMin: number;
  /** 0..1 share of the week gone */
  weekElapsed: number;
}

// ─── project card: read-only by default, edit on demand ─────────────────────────

const SWATCHES = ["#6366f1", "#0ea5e9", "#10b981", "#84cc16", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

function ProjectCard({
  project,
  tasks,
  pending,
  onSave,
  onGoal,
}: {
  project: Project;
  tasks: ProjectTask[];
  pending: boolean;
  onSave: (patch: { name?: string; color?: string; archived?: boolean }) => void;
  onGoal: (weeklyHours: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [hours, setHours] = useState(project.weeklyTargetMin ? String(project.weeklyTargetMin / 60) : "");
  const [tasksOpen, setTasksOpen] = useState(false);

  const active = tasks.filter((t) => t.state === "active");
  const done = tasks.filter((t) => t.state === "done");
  const pct = project.completionPct ?? 0;
  const goal = project.weeklyTargetMin;
  const goalPct = goal ? Math.min(1, project.weekMin / goal) : 0;

  function save() {
    const h = hours.trim() === "" ? null : Number(hours);
    if (h !== null && (!Number.isFinite(h) || h <= 0 || h > 168)) return;
    const patch: { name?: string; color?: string } = {};
    if (name.trim() && name.trim() !== project.name) patch.name = name.trim();
    if (color !== project.color) patch.color = color;
    if (Object.keys(patch).length) onSave(patch);
    const before = goal ? goal / 60 : null;
    if (h !== before) onGoal(h);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-accent/40 bg-surface p-4 shadow-[var(--shadow-md)]">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="h-9" />
          </label>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Colour</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color.toLowerCase() === c}
                  onClick={() => setColor(c)}
                  className={cn("h-7 w-7 rounded-full transition-transform", color.toLowerCase() === c ? "scale-110 ring-2 ring-fg/60 ring-offset-2 ring-offset-surface" : "hover:scale-110")}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Custom colour"
                className="h-7 w-9 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
              />
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Weekly time goal</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                max="168"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="e.g. 20"
                className="h-9 w-28"
              />
              <span className="text-sm text-subtle">hours a week</span>
            </div>
            <span className="mt-1 block text-xs text-subtle">Leave empty for no goal. Shown on Goals and in your weekly review.</span>
          </label>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onSave({ archived: true });
                setEditing(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-subtle hover:bg-muted hover:text-fg"
            >
              <Archive className="h-3.5 w-3.5" /> Archive
            </button>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setName(project.name);
                  setColor(project.color);
                  setHours(goal ? String(goal / 60) : "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit" disabled={pending || !name.trim()}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  if (project.archived) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-surface/60 px-4 py-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full opacity-60" style={{ background: project.color }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-subtle">{project.name}</span>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onSave({ archived: false })}>
          <RotateCcw className="h-3.5 w-3.5" /> Restore
        </Button>
      </div>
    );
  }

  return (
    <div className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]">
      <div className="h-1" style={{ background: project.color }} aria-hidden />
      <div className="p-4">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate font-display text-lg leading-tight">{project.name}</h3>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${project.name}`}
            className="-mr-1 -mt-0.5 rounded-lg p-1.5 text-subtle opacity-100 transition-opacity hover:bg-muted hover:text-fg md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-subtle">
          <span className="flex items-center gap-1"><Circle className="h-3 w-3" /> {project.activeTasks} active</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-good" /> {project.doneTasks} done</span>
          <span className="tabular ml-auto font-semibold text-fg">{project.completionPct === null ? "–" : `${pct}%`}</span>
        </div>
        <Progress className="mt-1.5 h-1.5" value={pct / 100} tone="accent" />

        {goal ? (
          <div className="mt-3 rounded-xl bg-muted/60 px-3 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">This week</span>
              <span className="tabular text-subtle">
                <strong className="text-fg">{fmtDuration(project.weekMin)}</strong> of {fmtDuration(goal)}
              </span>
            </div>
            <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full" style={{ width: `${goalPct * 100}%`, background: project.color }} />
              {project.weekElapsed > 0 && project.weekElapsed < 1 ? (
                <div className="absolute top-0 h-full w-0.5 bg-fg/50" style={{ left: `${project.weekElapsed * 100}%` }} title="Even pace by today" />
              ) : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            <Target className="h-3.5 w-3.5" /> Set a weekly time goal
          </button>
        )}
      </div>

      {tasks.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setTasksOpen((v) => !v)}
            aria-expanded={tasksOpen}
            className="flex w-full items-center justify-between border-t border-border/60 px-4 py-2 text-xs font-medium text-subtle transition-colors hover:bg-muted/50 hover:text-fg"
          >
            <span>{tasksOpen ? "Hide tasks" : `Show ${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", tasksOpen && "rotate-180")} />
          </button>

          {tasksOpen ? (
            <ul className="max-h-80 divide-y divide-border/50 overflow-y-auto border-t border-border/50">
              {active.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Circle className="h-3.5 w-3.5 shrink-0 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/task/${t.id}`} className="block truncate text-sm font-medium underline-offset-2 hover:underline">
                      {t.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-subtle">
                      {t.estimateMin ? (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {fmtDuration(t.estimateMin)}
                        </span>
                      ) : null}
                      {t.dueDate ? <span>due {fmtDay(t.dueDate)}</span> : null}
                      {t.carry > 0 ? (
                        <Chip className={cn("text-[10px]", t.carry >= 3 ? "bg-bad-muted text-bad" : "bg-warn-muted text-warn")}>
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
                  <Link href={`/task/${t.id}`} className="block truncate text-sm text-subtle line-through underline-offset-2 hover:underline">
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
  // starts from ?q= and "/" jumps to it
  const { query, setQuery, ref: searchRef } = usePageSearch();

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
                onGoal={(h) => call(() => setProjectTimeGoalAction(p.id, h))}
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
                  onGoal={(h) => call(() => setProjectTimeGoalAction(p.id, h))}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
