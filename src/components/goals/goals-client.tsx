"use client";

import {
  ArrowDown, ArrowUp, Plus, Target, Repeat, Lightbulb,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addToDayAction, markTargetDoneAction, reorderSomedayAction, snoozeCadenceAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { fmtDuration, type DateStr, type TargetPeriod } from "@/lib/time";
import { useToast } from "../toast";
import { Button, Card, Chip, Empty, ErrorNote, Progress, EmptyState, prefillQuickAdd } from "../ui";

import { Check } from "lucide-react";

interface Target {
  id: number;
  title: string;
  project: string | null;
  period: TargetPeriod | null;
  range: string;
  minutes: number;
  count: number;
  goalMin: number | null;
  goalCount: number | null;
  minFraction: number | null;
  countFraction: number | null;
  elapsed: number;
  daysLeft: number;
  met: boolean;
  behind: boolean;
  hasGoal: boolean;
  done: boolean;
}

const PERIOD_LABEL: Record<TargetPeriod, string> = { week: "This week", month: "This month", quarter: "This quarter", year: "This year" };

// A small dot identifies each period; the heading itself stays in normal text colour.
const PERIOD_DOT: Record<TargetPeriod, string> = {
  week: "bg-accent",
  month: "bg-good",
  quarter: "bg-warn",
  year: "bg-subtle",
};

function TargetCard({ t, onAdd, onDone, pending }: { t: Target; onAdd: () => void; onDone: () => void; pending: boolean }) {
  const tone = t.met ? "accent" : t.behind ? "warn" : "accent";
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/task/${t.id}`} className="font-medium leading-snug hover:underline">{t.title}</Link>
          <p className="mt-0.5 text-xs text-subtle">
            {t.range} · {t.daysLeft} {t.daysLeft === 1 ? "day" : "days"} left {t.project ? `· ${t.project}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            t.met ? "bg-good/15 text-good" : t.behind ? "bg-warn/15 text-warn" : "bg-accent/15 text-accent",
          )}
        >
          {t.met ? "Met" : t.behind ? "Behind pace" : "On track"}
        </span>
      </div>
      <div className="mt-3 space-y-2.5">
        {t.goalMin ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-subtle">
              <span>Hours</span>
              <span className="tabular">{fmtDuration(t.minutes)} of {fmtDuration(t.goalMin)}</span>
            </div>
            <Progress value={t.minFraction ?? 0} tone={tone} marker={t.elapsed} />
          </div>
        ) : null}
        {t.goalCount ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-subtle">
              <span>Sessions</span>
              <span className="tabular">{t.count} of {t.goalCount}</span>
            </div>
            <Progress value={t.countFraction ?? 0} tone={tone} marker={t.elapsed} />
          </div>
        ) : null}
        {!t.hasGoal ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-subtle">
              <span>{t.done ? "Done" : "Not done yet"}</span>
              <span className="tabular">{Math.round(t.elapsed * 100)}% of the period gone</span>
            </div>
            <Progress value={t.done ? 1 : 0} tone={tone} marker={t.elapsed} />
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-subtle">The tick mark shows where you should be by now.</p>
        <div className="flex shrink-0 gap-2">
          {!t.done ? (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={onAdd}>
                <Plus className="h-3.5 w-3.5" /> Today
              </Button>
              <Button size="sm" variant="primary" disabled={pending} onClick={onDone}>
                <Check className="h-3.5 w-3.5" /> Done
              </Button>
            </>
          ) : (
            <span className="text-xs font-medium text-good">✓ Completed</span>
          )}
        </div>
      </div>
    </Card>
  );
}

export function GoalsClient(props: {
  today: DateStr;
  tomorrow: DateStr;
  targets: Record<TargetPeriod, Target[]>;
  cadence: { id: number; title: string; project: string | null; daysSince: number; limit: number; overdue: boolean; snoozed: boolean }[];
  someday: { id: number; title: string; project: string | null; estimate: number | null }[];
  /** server-rendered time goals card for this week */
  timeGoals?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That did not work.");
      else {
        if (done) toast(done);
        router.refresh();
      }
    });
  }

  const periods = (["week", "month", "quarter", "year"] as const).filter((p) => props.targets[p].length > 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Goals</h1>
        <p className="mt-1 text-sm text-subtle">Where your time should go, targets, habits that need a nudge, and things to do when you are free.</p>
      </header>

      {props.timeGoals}
      <ErrorNote message={error} />

      <section aria-label="Targets" className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Targets</h2>
        {periods.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No targets yet"
            actions={[
              { label: "Weekly target", onClick: () => prefillQuickAdd(" #w ~5h") },
              { label: "Monthly target", onClick: () => prefillQuickAdd(" #m"), primary: false },
            ]}
          >
            A target is something to finish or put hours into within a week, month, quarter or year, e.g.{" "}
            <span className="font-mono text-fg">Finish proposal #w ~6h</span> (week),{" "}
            <span className="font-mono text-fg">#m</span> (month),{" "}
            <span className="font-mono text-fg">#q</span> (quarter), or{" "}
            <span className="font-mono text-fg">#y</span> (year).
          </EmptyState>
        ) : null}
        {periods.map((p) => (
          <div key={p} className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", PERIOD_DOT[p])} aria-hidden />
              <h3 className="text-sm font-semibold text-fg">{PERIOD_LABEL[p]}</h3>
              <span className="tabular rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-subtle">{props.targets[p].length}</span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {props.targets[p].map((t) => (
                <TargetCard
                  key={t.id}
                  t={t}
                  pending={pending}
                  onAdd={() => act(() => addToDayAction(t.id, props.today), "Added to today.")}
                  onDone={() => act(() => markTargetDoneAction(t.id), "Target marked as done! 🎉")}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-label="Cadence" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Cadence</h2>
        {props.cadence.length === 0 ? (
          <EmptyState icon={Repeat} title="No habits on a cadence" actions={[{ label: "Add a habit", onClick: () => prefillQuickAdd(" *7d") }]}>
            Things to do every few days, like a LinkedIn post every 7 days. You get a nudge when one is due.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {props.cadence.map((c) => (
              <li key={c.id} className="rounded-2xl border border-border bg-surface p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/task/${c.id}`} className="font-medium hover:underline">{c.title}</Link>
                    <p className={cn("tabular text-sm", c.overdue ? "font-medium text-bad" : "text-subtle")}>
                      {c.daysSince} of {c.limit} days {c.overdue ? "· overdue" : ""} {c.snoozed ? "· snoozed" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {c.overdue && !c.snoozed ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => snoozeCadenceAction(c.id), "Snoozed for a day.")}>
                        Snooze
                      </Button>
                    ) : null}
                    <Button size="sm" variant={c.overdue ? "primary" : "outline"} disabled={pending} onClick={() => act(() => addToDayAction(c.id, props.today), "Added to today.")}>
                      Do it today
                    </Button>
                  </div>
                </div>
                <Progress className="mt-2.5" value={c.daysSince / c.limit} tone={c.overdue ? "bad" : "accent"} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Someday" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Someday pool</h2>
        {props.someday.length === 0 ? (
          <EmptyState icon={Lightbulb} title="Someday is empty" actions={[{ label: "Park an idea", onClick: () => prefillQuickAdd(" ?"), primary: false }]}>
            A calm place for ideas and nice-to-dos. No dates, no nudges, ever.
          </EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {props.someday.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
                <div className="flex flex-col">
                  <button type="button" aria-label={`Move ${t.title} up`} disabled={pending || i === 0} onClick={() => act(() => reorderSomedayAction(t.id, "up"))} className="text-subtle hover:text-fg disabled:opacity-30">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={`Move ${t.title} down`} disabled={pending || i === props.someday.length - 1} onClick={() => act(() => reorderSomedayAction(t.id, "down"))} className="text-subtle hover:text-fg disabled:opacity-30">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
                <Link href={`/task/${t.id}`} className="min-w-0 flex-1 truncate text-[15px] hover:underline">
                  {t.title}
                </Link>
                {t.project ? <Chip>{t.project}</Chip> : null}
                <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => addToDayAction(t.id, props.today), "Added to today.")}>
                  <Plus className="h-3.5 w-3.5" /> Today
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
