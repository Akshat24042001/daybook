"use client";

import { CheckCircle2, ChevronRight, Clock, Hourglass, ListChecks, RotateCcw, Search, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { reopenTaskAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { HUE, type Hue } from "@/lib/hue";
import { fmtDuration } from "@/lib/time";
import type { TaskListRow, TaskLogRow } from "@/lib/services/tasks";
import { useToast } from "../toast";
import { Button, Chip, Input } from "../ui";

type Tab = "all" | "active" | "done" | "dropped" | "waiting" | "log";

/** The state of a task, in one place and one colour each (see lib/hue.ts). */
function stateOf(t: TaskListRow): { key: "active" | "done" | "dropped" | "waiting"; label: string; hue: Hue } {
  if (t.state === "done") return { key: "done", label: "Completed", hue: "mint" };
  if (t.state === "dropped") return { key: "dropped", label: "Dropped", hue: "rose" };
  if (t.waiting) return { key: "waiting", label: "Waiting", hue: "peach" };
  return { key: "active", label: "Active", hue: "sky" };
}
const LOG_WORD: Record<string, [string, Hue]> = {
  done: ["Done", "mint"], progressed: ["Progressed", "teal"], attempted: ["Attempted", "butter"], skipped: ["Skipped", "rose"], dropped: ["Dropped", "rose"],
};

const TYPE_WORDS: Record<string, string> = {
  one_off: "One-off", ongoing: "Ongoing", follow_up: "Follow-up", cadence: "Every few days", recurring: "Repeats", someday: "Someday", target: "Target",
};
const LAST_WORD: Record<string, string> = { done: "done", open: "planned", skipped: "skipped", progressed: "worked on", attempted: "tried", dropped: "dropped", waiting: "waiting" };

function dayText(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function TaskRowItem({ t }: { t: TaskListRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const st = stateOf(t);
  const closed = st.key === "done" || st.key === "dropped";
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border shadow-[var(--shadow-sm)] bg-surface px-3 py-2.5" >
      <Link href={`/task/${t.id}`} className="group min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] font-medium leading-snug group-hover:underline">
          <span className={cn(st.key === "dropped" && "text-subtle line-through decoration-1")}>{t.title}</span>
          {t.project ? <Chip color={t.color}>{t.project}</Chip> : null}
          {/* "Active" is the default and would sit on every row; only the other states earn a badge */}
          {st.key !== "active" ? <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", HUE[st.hue].tint, HUE[st.hue].ink)}>{st.label}</span> : null}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-subtle">
          <span>{TYPE_WORDS[t.type] ?? t.type.replace(/_/g, " ")}</span>
          {t.closed_at ? <span>{st.key === "dropped" ? "dropped" : "closed"} {dayText(t.closed_at)}</span> : t.last_date ? <span>last {LAST_WORD[t.last_status ?? ""] ?? "planned"} {dayText(t.last_date)}</span> : <span>never scheduled</span>}
          {t.days_done > 0 ? <span>{t.days_done} {t.days_done === 1 ? "day" : "days"} done</span> : null}
          {t.minutes > 0 ? <span className="tabular">{fmtDuration(t.minutes)} logged</span> : null}
          {t.carry_count >= 2 ? <span className="text-p-butter-fg">carried {t.carry_count}×</span> : null}
        </p>
      </Link>
      {closed ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
          const r = await reopenTaskAction(t.id);
          toast(r.ok ? "Back on your active list" : r.error ?? "Could not reopen", r.ok ? "ok" : "error");
          router.refresh();
        })} className="shrink-0"><RotateCcw className="h-3.5 w-3.5" /> Reopen</Button>
      ) : <ChevronRight className="hidden h-4 w-4 shrink-0 text-subtle sm:block" aria-hidden />}
    </li>
  );
}

export function TasksView({ tasks, log }: { tasks: TaskListRow[]; log: TaskLogRow[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const counts = useMemo(() => {
    const c = { all: tasks.length, active: 0, done: 0, dropped: 0, waiting: 0 };
    for (const t of tasks) c[stateOf(t).key] += 1;
    return c;
  }, [tasks]);
  const projects = useMemo(() => [...new Set(tasks.map((t) => t.project).filter((p): p is string => !!p))].sort(), [tasks]);
  const needle = query.trim().toLowerCase();
  const rows = tasks.filter((t) => (tab === "all" || tab === "log" || stateOf(t).key === tab) && (!project || t.project === project) && (!needle || t.title.toLowerCase().includes(needle)));
  const logRows = log.filter((l) => (!project || l.project === project) && (!needle || l.title.toLowerCase().includes(needle)));

  const TABS: [Tab, string, typeof ListChecks][] = [
    ["all", `All · ${counts.all}`, ListChecks], ["active", `Active · ${counts.active}`, Clock], ["done", `Completed · ${counts.done}`, CheckCircle2],
    ["dropped", `Dropped · ${counts.dropped}`, XCircle], ["waiting", `Waiting · ${counts.waiting}`, Hourglass], ["log", "Day by day", ListChecks],
  ];
  const groups: { label: string; items: TaskLogRow[] }[] = [];
  if (tab === "log") for (const l of logRows) {
    const label = dayText(l.date);
    const g = groups.at(-1);
    if (g && g.label === label) g.items.push(l);
    else groups.push({ label, items: [l] });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <p className={cn("text-xs font-semibold uppercase tracking-wider", HUE.sky.ink)}>All tasks</p>
        <h1 className="font-display text-2xl sm:text-3xl leading-tight">Every task, in one place</h1>
        <p className="mt-1 text-sm text-subtle">Active, completed, dropped and waiting. Open any task to see its history. “Day by day” lists every day something was done, skipped or dropped.</p>
      </header>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="tablist">
        {TABS.map(([k, l, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium", tab === k ? "border-transparent bg-accent text-accent-fg" : "border-border text-subtle hover:bg-muted")}>
            <Icon className="h-3.5 w-3.5" /> {l}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" className="pl-9" aria-label="Search tasks" />
        </div>
        {projects.length ? (
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project" className="h-10 rounded-xl border border-border bg-surface px-3 text-sm">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p}>{p}</option>)}
          </select>
        ) : null}
      </div>

      {tab === "log" ? (
        groups.length ? groups.map((g) => (
          <section key={g.label} className="space-y-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{g.label}</h2>
            <ul className="space-y-1.5">
              {g.items.map((l) => {
                const [word, hue] = LOG_WORD[l.status] ?? [l.status, "sky" as Hue];
                return (
                  <li key={l.entry_id}>
                    <Link href={`/task/${l.task_id}`} className="flex items-center gap-3 rounded-xl border border-border shadow-[var(--shadow-sm)] bg-surface px-3 py-2 hover:bg-muted" >
                      <span className={cn("w-24 shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-medium", HUE[hue].tint, HUE[hue].ink)}>{word}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{l.title}</span>
                      {l.project ? <span className="hidden text-xs text-subtle sm:inline">{l.project}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )) : <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-subtle">Nothing matches.</p>
      ) : rows.length ? (
        <ul className="space-y-1.5">{rows.map((t) => <TaskRowItem key={t.id} t={t} />)}</ul>
      ) : <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-subtle">No tasks here.</p>}
      {tasks.length >= 2000 ? <p className="text-center text-xs text-subtle">Showing the 2,000 most recent tasks.</p> : null}
    </div>
  );
}
