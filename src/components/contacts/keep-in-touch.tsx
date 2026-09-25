"use client";

import { AlarmClockOff, Check, HeartHandshake, MessageCircle, Phone, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logTouchAction, setTouchIntervalAction, snoozeTouchAction } from "@/app/contact-actions";
import { cn } from "@/lib/cn";
import type { TouchKind, TouchState } from "@/lib/services/keep-in-touch";
import { useToast } from "../toast";
import { Select } from "../ui";

const KINDS: { kind: TouchKind; label: string; Icon: typeof Phone }[] = [
  { kind: "call", label: "Called", Icon: Phone },
  { kind: "meet", label: "Met", Icon: Users },
  { kind: "message", label: "Messaged", Icon: MessageCircle },
];

export function sinceLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function useTouchActions() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "That did not work.", "error");
      else {
        if (done) toast(done);
        router.refresh();
      }
    });
  return { pending, run };
}

/** One-tap "we talked" buttons plus an optional note. */
function LogTouch({ contactId, name, compact, onDone }: { contactId: number; name: string; compact?: boolean; onDone?: () => void }) {
  const { pending, run } = useTouchActions();
  const [note, setNote] = useState("");
  const [withNote, setWithNote] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map(({ kind, label, Icon }) => (
          <button
            key={kind}
            type="button"
            disabled={pending}
            onClick={() => {
              run(() => logTouchAction(contactId, kind, note), `${label} ${name.split(" ")[0]} ✓`);
              setNote("");
              setWithNote(false);
              onDone?.();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium transition-colors hover:border-good/50 hover:bg-good-muted hover:text-good"
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
        {!compact && !withNote ? (
          <button type="button" onClick={() => setWithNote(true)} className="text-xs text-subtle hover:text-fg">+ note</button>
        ) : null}
      </div>
      {withNote ? (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
          maxLength={500}
          placeholder="What did you talk about? (optional)"
          aria-label="Touch note"
          className="h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-xs outline-none focus:border-accent/60"
        />
      ) : null}
    </div>
  );
}

/** Footer on every contact card: last touch, interval, and logging a touch. */
export function TouchFooter({ state }: { state: TouchState | undefined }) {
  const { pending, run } = useTouchActions();
  const [open, setOpen] = useState(false);
  if (!state) return null;
  const tone = state.due ? "text-warn" : "text-subtle";
  return (
    <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <HeartHandshake className={cn("h-3.5 w-3.5 shrink-0", tone)} />
        <span className={cn("text-xs", tone)}>
          {state.lastTouch ? `Last touch ${sinceLabel(state.sinceDays)}` : `Added ${sinceLabel(state.sinceDays)}, no touch yet`}
          {state.snoozedUntil ? " · snoozed" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Select
            aria-label="Keep in touch every"
            value={state.everyDays === null ? "never" : String(state.everyDays)}
            disabled={pending}
            onChange={(e) => run(() => setTouchIntervalAction(state.contactId, e.target.value === "never" ? null : Number(e.target.value)))}
            className="h-7 w-[7.5rem] rounded-lg px-2 text-[11px]"
          >
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d === 7 ? "Weekly" : d === 14 ? "Every 2 weeks" : d === 30 ? "Monthly" : d === 60 ? "Every 2 months" : "Quarterly"}</option>)}
            <option value="never">Don&apos;t nudge</option>
          </Select>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn("h-7 rounded-lg px-2.5 text-[11px] font-semibold transition-colors", open ? "bg-accent text-accent-fg" : "bg-accent-muted text-accent hover:bg-accent/20")}
          >
            Log touch
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-2.5">
          <LogTouch contactId={state.contactId} name={state.name} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** "Reach out" list: everyone past their interval, most overdue first. */
export function ReachOut({ due, limit = 5, title = "Reach out", compact = false }: { due: TouchState[]; limit?: number; title?: string; compact?: boolean }) {
  const { pending, run } = useTouchActions();
  const [all, setAll] = useState(false);
  if (!due.length) return null;
  const shown = all ? due : due.slice(0, limit);
  return (
    <section className="rounded-2xl border border-warn/30 bg-warn-muted/30 p-4" aria-label={title}>
      <div className="mb-3 flex items-center gap-2">
        <HeartHandshake className="h-4 w-4 text-warn" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="tabular rounded-full bg-warn-muted px-2 py-0.5 text-[11px] font-semibold text-warn">{due.length}</span>
        <span className="ml-auto hidden text-xs text-subtle sm:inline">People you haven&apos;t been in touch with for a while</span>
      </div>
      <ul className="divide-y divide-border/60">
        {shown.map((s) => (
          <li key={s.contactId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-xs text-subtle">
                {s.lastTouch ? `Last touch ${sinceLabel(s.sinceDays)}` : `No touch since added ${sinceLabel(s.sinceDays)}`}
                {s.overdueDays ? ` · ${s.overdueDays} day${s.overdueDays === 1 ? "" : "s"} overdue` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <LogTouch contactId={s.contactId} name={s.name} compact />
              <button
                type="button"
                disabled={pending}
                title="Remind me in a week"
                aria-label={`Snooze ${s.name} for a week`}
                onClick={() => run(() => snoozeTouchAction(s.contactId, 7), "Snoozed for a week")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-muted hover:text-fg"
              >
                <AlarmClockOff className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!compact && due.length > limit ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <Check className="h-3 w-3" /> {all ? "Show fewer" : `Show all ${due.length}`}
        </button>
      ) : null}
    </section>
  );
}
