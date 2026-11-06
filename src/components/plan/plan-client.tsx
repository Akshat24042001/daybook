"use client";

import {
  ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Star, X, ClipboardList,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import {
  addToDayAction, finishPlanAction, removeEntryAction, toggleMustAction,
} from "@/app/actions";
import { cn } from "@/lib/cn";
import { HUE, type Hue } from "@/lib/hue";
import { addDays, fmtDuration, type DateStr } from "@/lib/time";
import type { RowData } from "@/lib/view-types";
import { SortableEntries } from "../sortable-list";
import { useToast } from "../toast";
import { Button, Card, Chip, Empty, ErrorNote, Input, Progress, EmptyState, prefillQuickAdd } from "../ui";

interface Capacity {
  plannedMin: number;
  availableMin: number;
  ratio: number;
  level: "ok" | "amber" | "red";
  message: string | null;
}

/** Overdue = rose (urgent), carried = butter (attention), ongoing = teal (measured over time), recurring = lilac (rhythm). */
const LABEL_HUE: Record<string, Hue> = { "Overdue cadence": "rose", Carried: "butter", Ongoing: "teal", Recurring: "lilac" };

export function PlanClient(props: {
  date: DateStr;
  today: DateStr;
  dateLabel: string;
  triage: RowData[];
  entries: RowData[];
  capacity: Capacity;
  mustDoCount: number;
  mustCap: number;
  someday: { id: number; title: string; project: string | null; estimate: number | null }[];
  targets: { id: number; title: string; daysLeft: number; detail: string }[];
  plannedAt: string | null;
  streak: number;
  availableHours: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticRemoved, setOptimisticRemoved] = useOptimistic<Set<number>>(new Set());
  const { date, capacity } = props;
  const entries = props.entries.filter((r) => !optimisticRemoved.has(r.id));

  function removeFromDay(entryId: number) {
    setError(null);
    start(async () => {
      setOptimisticRemoved((s) => new Set([...s, entryId]));
      const r = await removeEntryAction(entryId);
      if (!r.ok) setError(r.error ?? "That did not work.");
      else router.refresh();
    });
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "That did not work.");
        return;
      }
      if (done) toast(done);
      router.refresh();
    });
  }

  const go = (d: DateStr) => router.push(`/plan?date=${d}`);
  const tone = capacity.level === "red" ? "bad" : capacity.level === "amber" ? "warn" : "accent";

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Plan</p>
            <h1 className="font-display text-3xl leading-tight">{props.dateLabel}</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className="h-10 w-[9.5rem]" aria-label="Plan date" />
            <Button variant="outline" size="icon" aria-label="Next day" onClick={() => go(addDays(date, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm text-subtle">
          Planning streak: <span className="font-medium text-fg">{props.streak} {props.streak === 1 ? "day" : "days"}</span>
          {props.plannedAt ? <span className="ml-2 inline-flex items-center gap-1 text-good"><CheckCircle2 className="h-4 w-4" /> Planned</span> : null}
        </p>
      </header>

      <ErrorNote message={error} />

      <>
        {/* capacity */}
          <Card className="p-4" aria-label="Capacity">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Capacity</p>
              <p className="tabular text-sm">
                <span className="font-medium">{fmtDuration(capacity.plannedMin)}</span> planned of {props.availableHours}h
              </p>
            </div>
            <Progress className="mt-2 h-3" value={Math.min(1, capacity.ratio)} tone={tone} />
            {capacity.message ? <p role="alert" className="mt-2 text-sm font-medium text-bad">{capacity.message}</p> : null}
            {capacity.level === "amber" ? <p className="mt-2 text-sm text-warn">You are close to your limit.</p> : null}
            <p className="mt-2 text-xs text-subtle">
              Must-dos: <span className="font-medium text-fg">{props.mustDoCount}</span>. Tasks without an estimate count as zero, so add estimates with ~30m or ~2h.
            </p>
          </Card>

          <section aria-label="The day" className="space-y-2">
            <h2 className={cn("text-xs font-semibold uppercase tracking-wider", HUE.lilac.ink)}>On the list ({entries.length})</h2>
            {entries.length === 0 ? (
              <EmptyState icon={ClipboardList} title="Nothing on this day yet" actions={[{ label: "Add a task", onClick: () => prefillQuickAdd("") }]}>
                Add new tasks, or pick from Someday and cadence suggestions below.
              </EmptyState>
            ) : null}
            {/* must-dos always sit above the rest, so each group is its own draggable list */}
            {[entries.filter((r) => r.mustDo), entries.filter((r) => !r.mustDo)].map((group, gi) =>
              group.length ? (
                <SortableEntries key={gi} date={date} items={group}>
                  {(r, slot) => {
                    const label =
                      r.type === "cadence" && r.source === "auto" ? "Overdue cadence" : r.type === "ongoing" ? "Ongoing" : r.type === "recurring" ? "Recurring" : r.source === "carried" ? "Carried" : null;
                    return (
                      <li
                        key={r.id}
                        ref={slot.setNodeRef}
                        style={{ ...slot.style, borderLeftColor: r.projectColor ?? undefined }}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border border-l-[5px] border-border px-2 py-2.5",
                          r.mustDo ? "highlighter border-y-transparent border-r-transparent" : "bg-surface",
                          slot.dragging && "shadow-[var(--shadow-lg)] ring-2 ring-accent/40",
                        )}
                      >
                        {slot.grip}
                        <button
                          type="button"
                          aria-pressed={r.mustDo}
                          aria-label={r.mustDo ? `Demote ${r.title} from must-do` : `Make ${r.title} a must-do`}
                          disabled={pending}
                          onClick={() => act(() => toggleMustAction(r.id, !r.mustDo))}
                          className={cn("shrink-0 rounded-full p-1", r.mustDo ? "text-warn" : "text-subtle hover:text-fg")}
                        >
                          <Star className={cn("h-5 w-5", r.mustDo && "fill-current")} />
                        </button>
                        {/* the whole title is a link: open the task to edit it, add notes, see its history */}
                        <Link href={`/task/${r.taskId}`} className="group min-w-0 flex-1" title="Open this task">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] font-medium leading-snug group-hover:underline">
                            {r.title}
                            {r.projectName ? <Chip color={r.projectColor}>{r.projectName}</Chip> : null}
                            {label ? <Chip className={cn(HUE[LABEL_HUE[label]].tint, HUE[LABEL_HUE[label]].ink)}>{label}</Chip> : null}
                          </p>
                          <p className="tabular text-xs text-subtle">
                            {[r.timeLabel, r.estimateMin ? `est ${fmtDuration(r.estimateMin)}` : "no estimate", r.personName && `with ${r.personName}`].filter(Boolean).join(" · ")}
                          </p>
                        </Link>
                        <Link href={`/task/${r.taskId}`} aria-label={`Open ${r.title}`} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-muted hover:text-fg sm:flex">
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                        {r.status === "open" && r.type !== "ongoing" ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${r.title} from this day`} onClick={() => removeFromDay(r.id)}>
                            <X className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </li>
                    );
                  }}
                </SortableEntries>
              ) : null,
            )}
          </section>

          {props.targets.length > 0 ? (
            <section aria-label="Targets behind pace" className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Targets behind pace</h2>
              <ul className="space-y-1.5">
                {props.targets.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2.5">
                    <div>
                      <p className="text-[15px] font-medium">{t.title}</p>
                      <p className="text-xs text-subtle">{t.detail} · {t.daysLeft} days left</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => addToDayAction(t.id, date))}>Add</Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {props.someday.length > 0 ? (
            <section aria-label="Someday" className="space-y-2">
              <h2 className={cn("text-xs font-semibold uppercase tracking-wider", HUE.lilac.ink)}>Someday pool</h2>
              <ul className="space-y-1.5">
                {props.someday.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/task/${t.id}`} className="block truncate text-[15px] hover:underline" title="Open this task">{t.title}</Link>
                      {t.project ? <p className="text-xs text-subtle">{t.project}</p> : null}
                    </div>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => addToDayAction(t.id, date))}>Add</Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="sticky bottom-20 z-10 md:bottom-4">
            <Card className="flex items-center justify-between gap-3 p-3 shadow-lg">
              <p className="text-sm text-subtle">{props.plannedAt ? "This day is planned." : "Done choosing?"}</p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    act(async () => {
                      const r = await finishPlanAction(date);
                      return r;
                    }, "Planned. Have a good day.")
                  }
                >
                  {props.plannedAt ? "Update plan" : "Finish planning"}
                </Button>
                {date > props.today ? (
                  <Link href="/today" className="inline-flex h-10 items-center gap-1 rounded-xl border border-border px-3 text-sm hover:bg-muted">
                    Today <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </Card>
          </div>
      </>
    </div>
  );
}
