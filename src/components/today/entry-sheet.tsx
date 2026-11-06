"use client";

import { AlarmClockOff, ArrowRight, CalendarDays, Check, CircleHelp, CloudMoon, ExternalLink, Hourglass, RotateCcw, Star, Timer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import {
  createRemarkAction, clearMinutesAction, logMinutesAction, moveEntryAction, retryAction, setSkipReasonAction, setStatusAction,
  setWaitingAction, somedayUnfinishedAction, toggleMustAction, updateTaskAction,
} from "@/app/actions";
import { HUE } from "@/lib/hue";
import { TASK_TYPE_INFO } from "@/lib/task-types";
import { cn } from "@/lib/cn";
import { addDays, fmtDuration, fmtRelDay, type DateStr } from "@/lib/time";
import { SKIP_REASONS, type EntryStatus } from "@/lib/types";
import type { RowData } from "@/lib/view-types";
import { useToast } from "../toast";
import { Button, Chip, ErrorNote, Input, Select, Sheet, Textarea } from "../ui";
import { VoiceButton } from "../voice-button";
import { StatusGlyph } from "./entry-row";

const PRIMARY: { status: EntryStatus; label: string; hint: string; tone: string }[] = [
  { status: "done", label: "Done", hint: "Finished. The task closes (repeating tasks come round again).", tone: "border-transparent bg-good text-good-on shadow-[var(--shadow-sm)]" },
  { status: "progressed", label: "Progressed", hint: "Worked on it, not finished. Comes back tomorrow, no penalty.", tone: "border-[hsl(var(--teal-fill))] bg-p-teal text-p-teal-fg" },
  { status: "skipped", label: "Not today", hint: "Put off on purpose. Comes back tomorrow and adds to its carried count.", tone: "border-[hsl(var(--butter-fill))] bg-p-butter text-p-butter-fg" },
];
const OTHER: { status: EntryStatus; label: string; hint: string }[] = [
  { status: "attempted", label: "Tried, could not", hint: "Tried but couldn't (no answer, blocked). Pick when to retry, no penalty." },
  { status: "waiting", label: "Waiting on someone", hint: "Ball is in someone else's court. Off your list until the check-back date." },
  { status: "dropped", label: "Drop it", hint: "Not doing it. The task closes and stays in history." },
];
const STATUS_HINT = Object.fromEntries([...PRIMARY, ...OTHER].map((s) => [s.status, s.hint])) as Partial<Record<EntryStatus, string>>;
const CHIPS = [15, 30, 60];

export function EntrySheet({
  row,
  onClose,
  today,
  voiceEnabled,
  projects = [],
}: {
  row: RowData | null;
  onClose: () => void;
  today: DateStr;
  voiceEnabled: boolean;
  projects?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic<EntryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryDate, setRetryDate] = useState("");
  const [waitOpen, setWaitOpen] = useState(false);
  const [waitOn, setWaitOn] = useState("");
  const [waitUntil, setWaitUntil] = useState("");
  const [moreTime, setMoreTime] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [showMove, setShowMove] = useState(false);

  function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "That did not work.");
        return;
      }
      if (r.message) toast(r.message);
      after?.();
      router.refresh();
    });
  }

  if (!row) return <Sheet open={false} onOpenChange={onClose} title="Task">{null}</Sheet>;
  const isToday = row.date === today;
  const tomorrow = addDays(today, 1);
  const displayStatus = optimisticStatus ?? row.status;
  const info = TASK_TYPE_INFO[row.type];
  const hue = HUE[info.hue];
  const stuck = row.carry >= 3 && (displayStatus === "open" || displayStatus === "skipped");

  function setOutcome(status: EntryStatus) {
    if (!row) return;
    if (status === "waiting") {
      // needs a date (and maybe a person) first
      setWaitOn(row.waiting?.on ?? row.personName ?? "");
      setWaitUntil(row.waiting?.until ?? addDays(row.date, 3));
      setWaitOpen(true);
      setRetryOpen(false);
      return;
    }
    start(async () => {
      setOptimisticStatus(status);
      setError(null);
      const r = await setStatusAction(row.id, status);
      if (!r.ok) { setError(r.error ?? "That did not work."); return; }
      if (status === "attempted") setRetryOpen(true);
      if (status === "done" || status === "dropped") onClose();
      router.refresh();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          setRetryOpen(false);
          setWaitOpen(false);
          onClose();
        }
      }}
      title={row.title}
      description={[row.projectName, row.personName && `${row.personRole === "requested_by" ? "for" : "with"} ${row.personName}`].filter(Boolean).join(" · ") || undefined}
    >
      <div className="space-y-4">
        {/* what kind of task this is, in one line */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cn("rounded-full px-2.5 py-1 font-semibold", hue.tint, hue.ink)} title={`${info.shows} ${info.missed}`}>{info.label}</span>
          {row.timeLabel ? <span className="tabular rounded-full bg-muted px-2.5 py-1 font-medium">{row.timeLabel}</span> : null}
          {row.estimateMin ? <span className="tabular rounded-full bg-muted px-2.5 py-1">est {fmtDuration(row.estimateMin)}</span> : null}
          {row.carry >= 1 ? <span className={cn("rounded-full px-2.5 py-1 font-medium", row.carry >= 3 ? "bg-p-rose text-p-rose-fg" : "bg-p-butter text-p-butter-fg")}>carried {row.carry}×</span> : null}
          <button type="button" className="ml-auto inline-flex items-center gap-1 text-subtle hover:text-fg" onClick={() => toast(`${info.shows} ${info.missed}`)} aria-label="What does this type of task do?">
            <CircleHelp className="h-3.5 w-3.5" /> How it works
          </button>
        </div>

        {/* a task that keeps coming back asks for a decision instead of nagging forever */}
        {stuck ? (
          <section className="rounded-2xl border border-[hsl(var(--rose-fill))] bg-p-rose p-3 text-p-rose-fg">
            <p className="text-sm font-semibold">This has come back {row.carry} times.</p>
            <p className="mt-0.5 text-xs">Decide once instead of seeing it every day.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => toggleMustAction(row.id, true))}><Star className="h-3.5 w-3.5" /> Do it today</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowMove(true)}><CalendarDays className="h-3.5 w-3.5" /> Pick a day</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => somedayUnfinishedAction([row.taskId]), onClose)}><CloudMoon className="h-3.5 w-3.5" /> Park in Someday</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOutcome("dropped")}><Trash2 className="h-3.5 w-3.5" /> Drop it</Button>
            </div>
          </section>
        ) : null}

        {/* the one question: how did it go? */}
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-subtle">How did it go?</p>
          <div className="grid grid-cols-3 gap-2">
            {PRIMARY.map(({ status, label, hint, tone }) => (
              <button
                key={status}
                type="button"
                title={hint}
                aria-pressed={displayStatus === status}
                disabled={pending}
                onClick={() => setOutcome(status)}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 text-sm font-semibold transition-all active:scale-[0.97]",
                  displayStatus === status ? tone : "border-border bg-surface hover:bg-muted",
                )}
              >
                <StatusGlyph status={status} className="h-6 w-6" />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {OTHER.map(({ status, label, hint }) => (
              <button
                key={status}
                type="button"
                title={hint}
                aria-pressed={displayStatus === status || (status === "waiting" && waitOpen)}
                disabled={pending}
                onClick={() => setOutcome(status)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  displayStatus === status || (status === "waiting" && waitOpen) ? "border-transparent bg-accent text-accent-fg" : "border-border bg-surface hover:bg-muted",
                )}
              >
                {status === "waiting" ? <Hourglass className="h-3.5 w-3.5" /> : status === "attempted" ? <AlarmClockOff className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                {label}
              </button>
            ))}
            {displayStatus !== "open" ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-subtle hover:bg-muted hover:text-fg"
                onClick={() => start(async () => {
                  setOptimisticStatus("open");
                  const r = await setStatusAction(row.id, "open");
                  if (!r.ok) setError(r.error ?? "That did not work.");
                  else router.refresh();
                })}
              >
                <RotateCcw className="h-3 w-3" /> Reopen
              </button>
            ) : null}
          </div>
          {STATUS_HINT[displayStatus] ? <p className="mt-2 text-xs text-subtle">{STATUS_HINT[displayStatus]}</p> : null}
          {displayStatus === "waiting" && row.waiting ? (
            <p className="mt-1 text-xs font-medium text-accent">
              Waiting{row.waiting.on ? ` on ${row.waiting.on}` : ""}
              {row.waiting.until ? ` · back on your list ${fmtRelDay(row.waiting.until, today)}` : ""}
            </p>
          ) : null}
        </div>

        {waitOpen ? (
          <form
            className="rounded-2xl border border-border bg-p-sky p-3 text-p-sky-fg"
            onSubmit={(e) => {
              e.preventDefault();
              if (!waitUntil) return;
              act(() => setWaitingAction(row.id, waitUntil, waitOn || null), () => setWaitOpen(false));
            }}
          >
            <p className="mb-2 text-sm font-semibold">Waiting on whom, and when should it come back?</p>
            <Input value={waitOn} onChange={(e) => setWaitOn(e.target.value)} placeholder="Person or team (optional)" aria-label="Waiting on" className="mb-2 h-9" />
            <div className="flex flex-wrap gap-2">
              {([["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]] as const).map(([l, n]) => (
                <Button key={n} type="button" size="sm" variant={waitUntil === addDays(row.date, n) ? "primary" : "outline"} onClick={() => setWaitUntil(addDays(row.date, n))}>
                  {l}
                </Button>
              ))}
              <Input type="date" min={addDays(row.date, 1)} value={waitUntil} onChange={(e) => setWaitUntil(e.target.value)} className="h-8 w-40" aria-label="Check-back date" />
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="submit" size="sm" variant="primary" disabled={pending || !waitUntil}>Set waiting</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setWaitOpen(false)}>Cancel</Button>
            </div>
          </form>
        ) : null}

        {displayStatus === "skipped" ? (
          <div>
            <p className="mb-1.5 text-xs text-subtle">Why? (optional, shows patterns in Stats)</p>
            <div className="flex flex-wrap gap-1.5">
              {SKIP_REASONS.map(({ reason, label }) => {
                const on = row.reason === reason;
                return (
                  <button key={reason} type="button" aria-pressed={on} disabled={pending} onClick={() => act(() => setSkipReasonAction(row.id, on ? null : reason))}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-transparent bg-p-butter text-p-butter-fg" : "border-border hover:bg-muted")}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {row.status === "attempted" || retryOpen ? (
          <div className="rounded-2xl border border-border bg-p-butter p-3 text-p-butter-fg">
            <p className="mb-2 text-sm font-semibold">Retry when?</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => retryAction(row.id, "2h"), () => setRetryOpen(false))}>In 2h</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => retryAction(row.id, "am"), () => setRetryOpen(false))}>Tomorrow AM</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => retryAction(row.id, "pm"), () => setRetryOpen(false))}>Tomorrow PM</Button>
            </div>
            <div className="mt-2 flex gap-2">
              <Input type="date" min={tomorrow} value={retryDate} onChange={(e) => setRetryDate(e.target.value)} className="h-9" aria-label="Pick a date" />
              <Button size="sm" variant="outline" disabled={pending || !retryDate} onClick={() => act(() => retryAction(row.id, { date: retryDate }), () => setRetryOpen(false))}>Pick date</Button>
            </div>
          </div>
        ) : null}

        {/* time: three taps cover almost everything */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-subtle"><Timer className="h-3.5 w-3.5" /> Time {isToday ? "today" : "that day"}</p>
            {row.minutes ? (
              <span className="tabular flex items-center gap-2 text-sm font-semibold">
                {fmtDuration(row.minutes)}
                <button type="button" className="text-xs font-normal text-subtle underline-offset-2 hover:underline" onClick={() => act(() => clearMinutesAction(row.id))}>Clear</button>
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((m) => (
              <Button key={m} size="sm" variant="soft" disabled={pending} onClick={() => act(() => logMinutesAction(row.id, m))}>+{m} min</Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setMoreTime((v) => !v)}>{moreTime ? "Less" : "Other…"}</Button>
          </div>
          {moreTime ? (
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const m = Math.round(Number(custom)); if (m > 0) act(() => logMinutesAction(row.id, m), () => setCustom("")); }}>
              <Input inputMode="numeric" placeholder="Minutes" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))} className="h-9" aria-label="Custom minutes" />
              <Button type="submit" size="sm" variant="outline" disabled={pending || !custom}>Add</Button>
            </form>
          ) : null}
        </div>

        {/* moving it */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-subtle"><CalendarDays className="h-3.5 w-3.5" /> Move it</p>
          <div className="flex flex-wrap gap-1.5">
            {!isToday ? <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => moveEntryAction(row.id, today), onClose)}><ArrowRight className="h-3.5 w-3.5" /> Today</Button> : null}
            <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => moveEntryAction(row.id, tomorrow), onClose)}><ArrowRight className="h-3.5 w-3.5" /> Tomorrow</Button>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => moveEntryAction(row.id, addDays(today, 7)), onClose)}><ArrowRight className="h-3.5 w-3.5" /> Next week</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowMove((v) => !v)}>Pick a day…</Button>
            <Button variant={row.mustDo ? "primary" : "ghost"} size="sm" disabled={pending} onClick={() => act(() => toggleMustAction(row.id, !row.mustDo))} aria-pressed={row.mustDo}>
              <Star className={cn("h-3.5 w-3.5", row.mustDo && "fill-current")} /> {row.mustDo ? "Must-do" : "Make must-do"}
            </Button>
          </div>
          {showMove ? (
            <div className="mt-2 flex gap-2">
              <Input type="date" min={tomorrow} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} className="h-9" aria-label="Move to" />
              <Button size="sm" variant="primary" disabled={pending || !moveDate} onClick={() => act(() => moveEntryAction(row.id, moveDate as DateStr), onClose)}>Move</Button>
            </div>
          ) : null}
        </div>

        {/* project and a note */}
        <details className="group rounded-2xl border border-border bg-surface/70 p-3">
          <summary className="cursor-pointer text-sm font-semibold">Project and notes</summary>
          <div className="mt-3 space-y-3">
            {projects.length > 0 ? (
              <Select
                value={row.projectName ? String(projects.find((p) => p.name === row.projectName)?.id ?? "") : ""}
                onChange={(e) => {
                  const val = e.target.value;
                  const name = val === "" ? null : projects.find((p) => String(p.id) === val)?.name ?? null;
                  act(() => updateTaskAction(row.taskId, { project: name }), undefined);
                }}
                aria-label="Project"
              >
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : null}
            <div className="flex items-start gap-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note. Type, or tap the mic and speak" className="min-h-[64px]" />
              <VoiceButton enabled={voiceEnabled} onText={(t) => setNote((n) => (n ? `${n} ${t}` : t))} className="mt-0" />
            </div>
            <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => act(() => createRemarkAction(row.taskId, note), () => { setNote(""); toast("Note saved."); })}>Save note</Button>
          </div>
        </details>

        <ErrorNote message={error} />

        <Link href={`/task/${row.taskId}`} className="flex items-center justify-between gap-3 rounded-2xl bg-[linear-gradient(135deg,hsl(var(--accent-fill)),hsl(var(--lilac-fill)))] px-4 py-3 text-sm font-semibold text-accent-fg shadow-[var(--shadow-sm)] transition-transform hover:-translate-y-0.5">
          <span className="flex items-center gap-2"><Check className="h-4 w-4" /> Open the full task: schedule, history, notes</span>
          <ExternalLink className="h-4 w-4 shrink-0" />
        </Link>
      </div>
    </Sheet>
  );
}
