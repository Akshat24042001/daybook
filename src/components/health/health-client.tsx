"use client";

import { ChevronDown, Flame, Footprints, Moon, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logExerciseCellAction, setStepsAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import type { HealthWeekDay } from "@/lib/services/health";
import { fmtDuration, weekdayName } from "@/lib/time";
import { useToast } from "../toast";
import { Button, Card, ErrorNote, Field, Input, Select, Sheet } from "../ui";
import { ExerciseTypes, type ExerciseTypeData } from "./exercise-types";

interface Cell {
  iso: string;
  label: string;
  status: "done" | "skipped" | "missed" | "pending" | "upcoming";
  typeName: string | null;
  unit: "reps" | "seconds" | null;
  amount: number | null;
  extraNames?: string[];
}

/** Friendly, never guilt-tripping: celebrate what is done, point at the next small step. */
function cheer(done: number, pace: number, streak: number, paused: boolean): string {
  if (paused) return "Pings are paused. Log a set here whenever you move.";
  if (done === 0 && pace <= 1) return "A fresh day. One set is all it takes to start.";
  if (done === 0) return "Nothing logged yet. A quick set now counts.";
  if (done >= pace) return streak > 1 ? `Right on pace, and ${streak} active days in a row. Keep it rolling.` : "Right on pace. Keep it rolling.";
  return `${done} set${done === 1 ? "" : "s"} in. One more brings you closer to pace.`;
}

function Ring({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={`${value} of ${max} sets`}>
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className={cn("transition-[stroke-dashoffset] duration-700", pct >= 1 ? "stroke-good" : "stroke-accent")}
      />
    </svg>
  );
}

export function HealthClient(props: {
  date: string;
  dateLabel: string;
  cells: Cell[];
  types: ExerciseTypeData[];
  steps: number | null;
  stepGoal: number;
  counts: { done: number; skipped: number; missed: number };
  defaultTypeId: number | null;
  defaultAmount: number;
  paused: boolean;
  week: HealthWeekDay[];
  totals: { name: string; unit: "reps" | "seconds"; amount: number; sets: number }[];
  streak: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [typeId, setTypeId] = useState<number | null>(props.defaultTypeId);
  const [amount, setAmount] = useState(String(props.defaultAmount));
  const [steps, setSteps] = useState(props.steps === null ? "" : String(props.steps));
  const [allSlots, setAllSlots] = useState(false);
  const active = props.types.filter((t) => t.active);
  const unit = active.find((t) => t.id === typeId)?.unit ?? "reps";

  const totalSlots = props.cells.length;
  const past = props.cells.filter((c) => c.status !== "upcoming");
  const next = props.cells.find((c) => c.status === "upcoming") ?? null;
  const toLog = past.filter((c) => c.status === "pending");
  const done = props.counts.done;
  const stepPct = props.steps === null || props.stepGoal <= 0 ? 0 : Math.min(1, props.steps / props.stepGoal);
  const maxSets = Math.max(1, ...props.week.map((d) => d.sets));
  const sleepNights = props.week.filter((d) => d.sleepMin !== null);
  const sleepAvg = sleepNights.length ? sleepNights.reduce((a, d) => a + d.sleepMin!, 0) / sleepNights.length : null;
  const lastNight = props.week.at(-1)?.sleepMin ?? null;
  const stepHits = props.week.filter((d) => (d.steps ?? 0) >= props.stepGoal).length;

  // "Log now" uses the latest open slot, or the current one
  const logNowCell = toLog.at(-1) ?? past.at(-1) ?? props.cells[0] ?? null;

  function log(status: "done" | "skipped") {
    if (!cell) return;
    setError(null);
    start(async () => {
      const r = await logExerciseCellAction(cell.iso, status, status === "done" ? typeId : null, status === "done" ? Math.round(Number(amount)) : null);
      if (!r.ok) setError(r.error);
      else {
        toast(status === "done" ? "Logged. Nice work 💪" : "Marked skipped.");
        setCell(null);
        router.refresh();
      }
    });
  }

  const shown = allSlots ? props.cells : props.cells.filter((c) => c.status !== "upcoming" || c === next);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Health</h1>
          <p className="mt-1 text-sm text-subtle">{props.dateLabel}</p>
        </div>
        {props.paused ? <span className="rounded-full bg-warn-muted px-2.5 py-1 text-xs font-medium text-warn">Pings paused</span> : null}
      </header>

      {/* hero: today at a glance */}
      <Card className="overflow-hidden">
        <div className="grid gap-5 p-5 md:grid-cols-[auto_1fr_auto] md:items-center">
          <div className="relative flex items-center justify-center">
            <Ring value={done} max={Math.max(totalSlots, 1)} />
            <div className="absolute text-center">
              <p className="tabular font-display text-2xl leading-none">{done}</p>
              <p className="text-[10px] text-subtle">of {totalSlots} sets</p>
            </div>
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg leading-snug">{cheer(done, past.length, props.streak, props.paused)}</p>
            {props.totals.length ? (
              <p className="mt-1.5 text-sm text-subtle">
                Today:{" "}
                {props.totals.map((t, i) => (
                  <span key={t.name}>
                    {i ? " · " : ""}
                    <strong className="font-semibold text-fg">{t.unit === "seconds" ? `${t.amount}s` : t.amount}</strong> {t.name.toLowerCase()}
                  </span>
                ))}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", props.streak > 0 ? "bg-warn-muted text-warn" : "bg-muted text-subtle")}>
                <Flame className="h-3.5 w-3.5" /> {props.streak} day streak
              </span>
              {next ? <span className="text-subtle">Next ping at {next.label}</span> : null}
            </div>
          </div>
          {logNowCell && active.length ? (
            <Button variant="primary" size="lg" onClick={() => setCell(logNowCell)} className="w-full md:w-auto">
              <Plus className="h-4 w-4" /> Log a set
            </Button>
          ) : null}
        </div>

        {/* this week */}
        <div className="border-t border-border bg-muted/30 px-5 py-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">This week</p>
          <div className="grid grid-cols-7 gap-2">
            {props.week.map((d) => {
              const isToday = d.date === props.date;
              const hitSteps = (d.steps ?? 0) >= props.stepGoal;
              return (
                <div key={d.date} className="flex flex-col items-center gap-1" title={`${d.sets} sets${d.steps !== null ? ` · ${d.steps.toLocaleString("en-US")} steps` : ""}`}>
                  <div className="flex h-16 w-full items-end justify-center rounded-lg bg-surface px-1.5 pb-1">
                    <div
                      className={cn("w-full max-w-[22px] rounded-md transition-all", d.sets ? "bg-accent" : "bg-border")}
                      style={{ height: `${Math.max(8, (d.sets / maxSets) * 100)}%`, opacity: d.sets ? 1 : 0.5 }}
                    />
                  </div>
                  <span className={cn("text-[10px] font-semibold uppercase", isToday ? "text-accent" : "text-subtle")}>{weekdayName(d.date).slice(0, 2)}</span>
                  <Footprints className={cn("h-3 w-3", hitSteps ? "text-good" : "text-border")} aria-label={hitSteps ? "Step goal hit" : "Step goal missed"} />
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* timeline */}
        <section aria-label="Exercise log" className="space-y-3 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Today&apos;s log</h2>
            {props.cells.some((c) => c.status === "upcoming") ? (
              <button type="button" onClick={() => setAllSlots((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-subtle hover:text-fg">
                {allSlots ? "Hide later slots" : "Show all slots"}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", allSlots && "rotate-180")} />
              </button>
            ) : null}
          </div>
          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-subtle">No exercise slots today.</p>
          ) : (
            <ol className="relative space-y-1.5 border-l-2 border-border pl-4">
              {shown.map((c) => (
                <li key={c.iso} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[23px] top-3 h-3 w-3 rounded-full border-2 border-bg",
                      c.status === "done" ? "bg-good" : c.status === "skipped" ? "bg-warn" : c.status === "missed" ? "bg-bad/60" : c.status === "pending" ? "bg-accent" : "bg-border",
                    )}
                    aria-hidden
                  />
                  <button
                    type="button"
                    disabled={c.status === "upcoming"}
                    onClick={() => setCell(c)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                      c.status === "upcoming" ? "cursor-default text-subtle" : "hover:bg-muted",
                      c.status === "pending" && "bg-accent-muted/60",
                    )}
                  >
                    <span className="tabular w-11 shrink-0 text-xs font-semibold text-subtle">{c.label}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {c.status === "done" ? (
                        <>
                          <strong className="font-semibold">{c.unit === "seconds" ? `${c.amount}s` : c.amount}</strong> {c.typeName}
                          {c.extraNames?.length ? <span className="text-subtle"> + {c.extraNames.join(", ")}</span> : null}
                        </>
                      ) : c.status === "pending" ? (
                        <span className="font-medium text-accent">Tap to log this slot</span>
                      ) : c.status === "upcoming" ? (
                        c === next ? "Next ping" : "Later"
                      ) : (
                        <span className="text-subtle">{c.status === "skipped" ? "Skipped" : "Missed"}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-subtle">Telegram pings you every half hour in your exercise window. Tap any past slot to log or correct it.</p>
        </section>

        {/* steps + sleep */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold">Steps</h2>
              <span className="tabular ml-auto text-xs text-subtle">goal {props.stepGoal.toLocaleString("en-US")}</span>
            </div>
            <p className="tabular mt-2 font-display text-3xl leading-none">{props.steps === null ? "–" : props.steps.toLocaleString("en-US")}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all", stepPct >= 1 ? "bg-good" : "bg-accent")} style={{ width: `${stepPct * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-subtle">
              {stepPct >= 1 ? "Goal reached today 🎉" : props.steps === null ? "Not entered yet" : `${(props.stepGoal - props.steps).toLocaleString("en-US")} to go`}
              {" · "}goal hit {stepHits} of 7 days
            </p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await setStepsAction(props.date, steps === "" ? null : Math.round(Number(steps)));
                  if (!r.ok) toast(r.error, "error");
                  else {
                    toast("Steps saved.");
                    router.refresh();
                  }
                });
              }}
            >
              <Input inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 8000" aria-label="Steps today" className="h-9" />
              <Button type="submit" variant="outline" size="sm" className="h-9" disabled={pending}>Save</Button>
            </form>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold">Sleep</h2>
              <Link href="/today" className="ml-auto text-xs font-medium text-accent hover:underline">Log on Today</Link>
            </div>
            <div className="mt-2 flex items-baseline gap-4">
              <div>
                <p className="tabular font-display text-3xl leading-none">{lastNight === null ? "–" : fmtDuration(lastNight)}</p>
                <p className="text-xs text-subtle">last night</p>
              </div>
              <div>
                <p className="tabular text-lg font-semibold leading-none">{sleepAvg === null ? "–" : fmtDuration(Math.round(sleepAvg))}</p>
                <p className="text-xs text-subtle">7-day average</p>
              </div>
            </div>
            {sleepAvg !== null && sleepAvg < 420 ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-subtle">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> Under 7 hours on average. An earlier night this week will show up in your day scores.
              </p>
            ) : null}
          </Card>
        </div>
      </div>

      <section aria-label="Exercise types" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Exercise types</h2>
        <ExerciseTypes types={props.types} />
      </section>

      <Sheet open={!!cell} onOpenChange={(o) => !o && setCell(null)} title={cell ? `${cell.label} exercise` : "Exercise"} description="Log what you did, or mark the slot skipped.">
        <div className="space-y-3">
          <Field label="Exercise">
            <Select value={typeId ?? ""} onChange={(e) => { const id = Number(e.target.value); setTypeId(id); const t = active.find((x) => x.id === id); if (t) setAmount(String(t.defaultAmount)); }}>
              {active.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={unit === "seconds" ? "Seconds" : "Reps"}>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Minus 5" onClick={() => setAmount(String(Math.max(1, Number(amount) - 5)))}>−5</Button>
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="text-center" />
              <Button variant="outline" size="icon" aria-label="Plus 5" onClick={() => setAmount(String(Number(amount) + 5))}>+5</Button>
            </div>
          </Field>
          <ErrorNote message={error} />
          <div className="flex gap-2">
            <Button variant="primary" disabled={pending || !typeId} onClick={() => log("done")}>Log it</Button>
            <Button variant="outline" disabled={pending} onClick={() => log("skipped")}>Skip</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
