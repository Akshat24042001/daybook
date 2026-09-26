"use client";

import { Archive, Check, CheckCheck, History, Plus, Search, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { bringToTodayAction, closeUnfinishedAction, somedayUnfinishedAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { useToast } from "../toast";
import { Button, Chip, EmptyState } from "../ui";

/** One unfinished task, already formatted on the server. */
export interface UnfinishedRow {
  taskId: number;
  title: string;
  type: "one_off" | "follow_up";
  projectName: string | null;
  projectColor: string | null;
  personName: string | null;
  isPersonal: boolean;
  /** days since it was last on a list; null if it never was */
  ageDays: number | null;
  lastLabel: string | null;
  lastStatus: string | null;
  days: number;
  carryCount: number;
  minutesLabel: string | null;
}

type Bucket = "recent" | "week" | "month" | "older" | "never";
const BUCKETS: { key: Bucket; label: string; hint: string }[] = [
  { key: "recent", label: "Yesterday", hint: "Fell off the list last night" },
  { key: "week", label: "This week", hint: "2 to 7 days ago" },
  { key: "month", label: "This month", hint: "8 to 30 days ago" },
  { key: "older", label: "Older", hint: "More than a month ago: still worth it?" },
  { key: "never", label: "Never on a day", hint: "Added without a date, or removed from its day" },
];

function bucketOf(r: UnfinishedRow): Bucket {
  if (r.ageDays === null) return "never";
  if (r.ageDays <= 1) return "recent";
  if (r.ageDays <= 7) return "week";
  if (r.ageDays <= 30) return "month";
  return "older";
}

const STATUS_WORD: Record<string, string> = {
  open: "untouched",
  progressed: "progressed",
  attempted: "attempted",
  skipped: "skipped",
  done: "done",
  dropped: "dropped",
};

export function useUnfinishedActions() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "That did not work.", "error");
      else {
        toast(done);
        after?.();
        router.refresh();
      }
    });
  const plural = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);
  return {
    pending,
    today: (ids: number[], must = false, after?: () => void) =>
      run(() => bringToTodayAction(ids, must), `${plural(ids.length)} added to today${must ? " as must-do" : ""}`, after),
    done: (ids: number[], after?: () => void) => run(() => closeUnfinishedAction(ids, "done"), `${plural(ids.length)} marked done`, after),
    drop: (ids: number[], after?: () => void) => run(() => closeUnfinishedAction(ids, "dropped"), `${plural(ids.length)} dropped`, after),
    someday: (ids: number[], after?: () => void) => run(() => somedayUnfinishedAction(ids), `${plural(ids.length)} moved to Someday`, after),
  };
}

export function ageLabel(r: Pick<UnfinishedRow, "ageDays" | "lastLabel">): string {
  if (r.ageDays === null) return "never scheduled";
  if (r.ageDays <= 1) return "yesterday";
  return `${r.ageDays} days ago`;
}

function IconAction({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-subtle transition-colors disabled:opacity-40", className)}
    >
      {children}
    </button>
  );
}

export function UnfinishedClient({ rows }: { rows: UnfinishedRow[] }) {
  const act = useUnfinishedActions();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.title, r.projectName, r.personName].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [rows, query]);

  const groups = BUCKETS.map((b) => ({ ...b, rows: filtered.filter((r) => bucketOf(r) === b.key) })).filter((g) => g.rows.length);
  const ids = [...picked].filter((id) => rows.some((r) => r.taskId === id));
  const clear = () => setPicked(new Set());
  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleGroup = (groupIds: number[]) =>
    setPicked((p) => {
      const n = new Set(p);
      const all = groupIds.every((id) => n.has(id));
      for (const id of groupIds) {
        if (all) n.delete(id);
        else n.add(id);
      }
      return n;
    });

  const stale = rows.filter((r) => r.ageDays !== null && r.ageDays > 7).length;
  const withTime = rows.filter((r) => r.minutesLabel).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl leading-none">Unfinished</h1>
          <p className="mt-1 max-w-xl text-sm text-subtle">
            Open tasks from earlier days that are not on today or any later day. Bring back what still matters; close the rest.
          </p>
        </div>
      </header>

      {rows.length ? (
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          {[
            { label: "Unfinished", value: rows.length, tone: "text-fg" },
            { label: "Over a week old", value: stale, tone: stale ? "text-warn" : "text-fg" },
            { label: "Already worked on", value: withTime, tone: "text-accent" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]">
              <p className={cn("tabular text-xl font-semibold leading-tight", s.tone)}>{s.value}</p>
              <p className="text-[11px] text-subtle">{s.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      {rows.length ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, project or person"
            aria-label="Filter unfinished tasks"
            className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-accent/60 sm:max-w-md"
          />
        </div>
      ) : null}

      {!rows.length ? (
        <EmptyState icon={CheckCheck} title="Nothing left behind">
          Every open task is on today or a later day. Tasks that fall off a list, for example after you mark them progressed or remove them from a day, show up here.
        </EmptyState>
      ) : !filtered.length ? (
        <p className="text-sm text-subtle">No unfinished task matches &ldquo;{query}&rdquo;.</p>
      ) : null}

      {groups.map((g) => {
        const gIds = g.rows.map((r) => r.taskId);
        const allOn = gIds.every((id) => picked.has(id));
        return (
          <section key={g.key} aria-label={g.label}>
            <div className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={allOn}
                onChange={() => toggleGroup(gIds)}
                aria-label={`Select all in ${g.label}`}
                className="h-4 w-4 rounded"
              />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{g.label}</h2>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-fg">{g.rows.length}</span>
              <span className="hidden text-xs text-subtle sm:inline">· {g.hint}</span>
            </div>
            <ul className="space-y-1.5">
              {g.rows.map((r) => {
                const on = picked.has(r.taskId);
                return (
                  <li
                    key={r.taskId}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 transition-colors",
                      on ? "border-accent/50 bg-accent-muted/30" : "border-border",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(r.taskId)}
                      aria-label={`Select ${r.title}`}
                      className="h-4 w-4 shrink-0 rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Link href={`/task/${r.taskId}`} className="text-[15px] font-medium leading-snug hover:underline">
                          {r.title}
                        </Link>
                        {r.projectName ? <Chip color={r.projectColor}>{r.projectName}</Chip> : null}
                        {r.isPersonal ? <Chip>Personal</Chip> : null}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                        <span className={cn(r.ageDays !== null && r.ageDays > 7 && "font-medium text-warn")}>
                          {r.lastLabel ? `Last on ${r.lastLabel}` : "Never on a day"}
                        </span>
                        {r.lastStatus && r.lastStatus !== "open" ? <span>· {STATUS_WORD[r.lastStatus] ?? r.lastStatus}</span> : null}
                        {r.days > 1 ? <span>· on {r.days} days</span> : null}
                        {r.personName ? <span>· {r.type === "follow_up" ? "follow up with" : "with"} {r.personName}</span> : null}
                        {r.minutesLabel ? (
                          <span className="tabular rounded-full bg-accent/15 px-1.5 py-0.5 font-medium text-accent">{r.minutesLabel} spent</span>
                        ) : null}
                        {r.carryCount >= 2 ? (
                          <span className={cn("rounded-full px-1.5 py-0.5 font-medium", r.carryCount >= 3 ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn")}>
                            carried {r.carryCount}×
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button size="sm" variant="outline" disabled={act.pending} onClick={() => act.today([r.taskId])} className="hidden sm:inline-flex">
                        <Plus className="h-3.5 w-3.5" /> Today
                      </Button>
                      <IconAction label={`Add ${r.title} to today`} disabled={act.pending} onClick={() => act.today([r.taskId])} className="text-accent hover:bg-accent-muted sm:hidden">
                        <Plus className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Add to today as must-do" disabled={act.pending} onClick={() => act.today([r.taskId], true)} className="hover:bg-warn-muted hover:text-warn">
                        <Star className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Already done" disabled={act.pending} onClick={() => act.done([r.taskId])} className="hover:bg-good-muted hover:text-good">
                        <Check className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Move to Someday" disabled={act.pending} onClick={() => act.someday([r.taskId])} className="hidden hover:bg-muted hover:text-fg sm:flex">
                        <Archive className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Drop: not doing this" disabled={act.pending} onClick={() => act.drop([r.taskId])} className="hover:bg-bad-muted hover:text-bad">
                        <X className="h-4 w-4" />
                      </IconAction>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {ids.length ? (
        <div className="sticky bottom-20 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface/95 p-2 shadow-[var(--shadow-lg,0_8px_24px_rgb(0_0_0/0.15))] backdrop-blur md:bottom-4">
          <span className="px-2 text-xs font-semibold">{ids.length} selected</span>
          <Button size="sm" variant="primary" disabled={act.pending} onClick={() => act.today(ids, false, clear)}>
            <Plus className="h-3.5 w-3.5" /> Add to today
          </Button>
          <Button size="sm" variant="outline" disabled={act.pending} onClick={() => act.today(ids, true, clear)}>
            <Star className="h-3.5 w-3.5" /> As must-do
          </Button>
          <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => act.done(ids, clear)}>
            <Check className="h-3.5 w-3.5" /> Done
          </Button>
          <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => act.someday(ids, clear)}>
            <Archive className="h-3.5 w-3.5" /> Someday
          </Button>
          <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => act.drop(ids, clear)} className="hover:text-bad">
            <X className="h-3.5 w-3.5" /> Drop
          </Button>
          <button type="button" onClick={clear} className="px-2 text-xs text-subtle hover:text-fg">
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Today's right rail: the most recent few unfinished tasks, one tap to bring each back. */
export function UnfinishedCard({ rows, total }: { rows: UnfinishedRow[]; total: number }) {
  const act = useUnfinishedActions();
  if (!total) return null;
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Unfinished from earlier">
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold">Unfinished from earlier</h2>
        <span className="tabular rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-semibold text-accent">{total}</span>
        <Link href="/unfinished" className="ml-auto text-xs font-medium text-accent hover:underline">
          See all
        </Link>
      </div>
      <ul className="divide-y divide-border/60">
        {rows.map((r) => (
          <li key={r.taskId} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <Link href={`/task/${r.taskId}`} className="block truncate text-sm font-medium hover:underline">
                {r.title}
              </Link>
              <p className="truncate text-xs text-subtle">
                {ageLabel(r)}
                {r.projectName ? ` · ${r.projectName}` : ""}
              </p>
            </div>
            <IconAction label="Add to today as must-do" disabled={act.pending} onClick={() => act.today([r.taskId], true)} className="hover:bg-warn-muted hover:text-warn">
              <Star className="h-4 w-4" />
            </IconAction>
            <IconAction label={`Add ${r.title} to today`} disabled={act.pending} onClick={() => act.today([r.taskId])} className="text-accent hover:bg-accent-muted">
              <Plus className="h-4 w-4" />
            </IconAction>
          </li>
        ))}
      </ul>
    </section>
  );
}
