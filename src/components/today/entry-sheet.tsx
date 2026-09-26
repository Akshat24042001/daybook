"use client";

import { ArrowRight, ExternalLink, Pencil, RotateCcw, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import {
  createRemarkAction, clearMinutesAction, logMinutesAction, moveEntryAction, retryAction, setStatusAction,
  toggleMustAction, updateTaskAction,
} from "@/app/actions";
import { cn } from "@/lib/cn";
import { addDays, fmtDuration, type DateStr } from "@/lib/time";
import type { EntryStatus } from "@/lib/types";
import type { RowData } from "@/lib/view-types";
import { useToast } from "../toast";
import { Button, Chip, ErrorNote, Input, Select, Sheet, Textarea } from "../ui";
import { VoiceButton } from "../voice-button";
import { StatusGlyph } from "./entry-row";

const STATUSES: { status: EntryStatus; label: string }[] = [
  { status: "done", label: "Done" },
  { status: "progressed", label: "Progressed" },
  { status: "attempted", label: "Attempted" },
  { status: "skipped", label: "Skipped" },
  { status: "dropped", label: "Dropped" },
];
const CHIPS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

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

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          setRetryOpen(false);
          onClose();
        }
      }}
      title={row.title}
      description={[row.projectName, row.personName && `${row.personRole === "requested_by" ? "for" : "with"} ${row.personName}`, row.timeLabel]
        .filter(Boolean)
        .join(" · ") || undefined}
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Status</p>
          <div className="grid grid-cols-5 gap-1.5">
            {STATUSES.map(({ status, label }) => (
              <button
                key={status}
                type="button"
                onClick={() =>
                  start(async () => {
                    setOptimisticStatus(status);
                    setError(null);
                    const r = await setStatusAction(row.id, status);
                    if (!r.ok) { setError(r.error ?? "That did not work."); return; }
                    if (status === "attempted") setRetryOpen(true);
                    router.refresh();
                  })
                }
                aria-pressed={displayStatus === status}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition-colors",
                  displayStatus === status ? "border-accent bg-accent/10 text-accent" : "border-border hover:bg-muted",
                )}
              >
                <StatusGlyph status={status} className="h-6 w-6" />
                {label}
              </button>
            ))}
          </div>
          {displayStatus !== "open" ? (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 text-xs text-subtle underline-offset-2 hover:underline"
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

        {row.status === "attempted" || retryOpen ? (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-3">
            <p className="mb-2 text-sm font-medium">Retry when?</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => retryAction(row.id, "2h"), () => setRetryOpen(false))}>
                In 2h
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => retryAction(row.id, "am"), () => setRetryOpen(false))}>
                Tomorrow AM
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => retryAction(row.id, "pm"), () => setRetryOpen(false))}>
                Tomorrow PM
              </Button>
            </div>
            <div className="mt-2 flex gap-2">
              <Input type="date" min={tomorrow} value={retryDate} onChange={(e) => setRetryDate(e.target.value)} className="h-9" aria-label="Pick a date" />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !retryDate}
                onClick={() => act(() => retryAction(row.id, { date: retryDate }), () => setRetryOpen(false))}
              >
                Pick date
              </Button>
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Time spent {isToday ? "today" : "that day"}</p>
            {row.minutes ? (
              <span className="tabular flex items-center gap-2 text-sm font-medium">
                {fmtDuration(row.minutes)}
                <button type="button" className="text-xs font-normal text-subtle underline-offset-2 hover:underline" onClick={() => act(() => clearMinutesAction(row.id))}>
                  Clear
                </button>
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((m) => (
              <Button key={m} size="sm" variant="soft" disabled={pending} onClick={() => act(() => logMinutesAction(row.id, m))}>
                +{m}
              </Button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const m = Math.round(Number(custom));
              if (m > 0) act(() => logMinutesAction(row.id, m), () => setCustom(""));
            }}
          >
            <Input inputMode="numeric" placeholder="Custom minutes" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))} className="h-9" aria-label="Custom minutes" />
            <Button type="submit" size="sm" variant="outline" disabled={pending || !custom}>
              Add
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={row.mustDo ? "primary" : "outline"}
            size="sm"
            disabled={pending}
            onClick={() => act(() => toggleMustAction(row.id, !row.mustDo))}
            aria-pressed={row.mustDo}
          >
            <Star className={cn("h-4 w-4", row.mustDo && "fill-current")} /> {row.mustDo ? "Must-do" : "Make must-do"}
          </Button>
          {!isToday ? (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => moveEntryAction(row.id, today), onClose)}>
              <ArrowRight className="h-4 w-4" /> Move to today
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => moveEntryAction(row.id, tomorrow), onClose)}>
            <ArrowRight className="h-4 w-4" /> Move to tomorrow
          </Button>
        </div>
        {projects.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">Project</p>
            <Select
              value={row.projectName ? String(projects.find((p) => p.name === row.projectName)?.id ?? "") : ""}
              onChange={(e) => {
                const val = e.target.value;
                const name = val === "" ? null : projects.find((p) => String(p.id) === val)?.name ?? null;
                act(() => updateTaskAction(row.taskId, { project: name }), undefined);
              }}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
        ) : null}

        <Link
          href={`/task/${row.taskId}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium hover:bg-muted transition-colors"
        >
          <span className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-subtle" />
            Open task · edit details, notes &amp; history
          </span>
          <ExternalLink className="h-4 w-4 text-subtle shrink-0" />
        </Link>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Add a note</p>
          <div className="flex items-start gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type, or tap the mic and speak" className="min-h-[64px]" />
            <VoiceButton enabled={voiceEnabled} onText={(t) => setNote((n) => (n ? `${n} ${t}` : t))} className="mt-0" />
          </div>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            disabled={pending || !note.trim()}
            onClick={() => act(() => createRemarkAction(row.taskId, note), () => { setNote(""); toast("Remark saved."); })}
          >
            Save note
          </Button>
        </div>

        <ErrorNote message={error} />
        <div className="flex items-center justify-between text-xs text-subtle">
          <Link href={`/task/${row.taskId}`} className="underline-offset-2 hover:underline">
            Open task page
          </Link>
          {row.carry > 0 ? <Chip>carried {row.carry}×</Chip> : null}
        </div>
      </div>
    </Sheet>
  );
}
