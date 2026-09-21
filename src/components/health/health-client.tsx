"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logExerciseCellAction, setStepsAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { useToast } from "../toast";
import { Button, Card, ErrorNote, Field, Input, Progress, Select, Sheet } from "../ui";
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

const STYLE: Record<Cell["status"], string> = {
  done: "border-good bg-good/15 text-fg",
  skipped: "border-warn/60 bg-warn/10 text-fg",
  missed: "border-bad/60 bg-bad/10 text-fg",
  pending: "border-border bg-surface text-subtle",
  upcoming: "border-dashed border-border bg-transparent text-subtle/70",
};
const WORD: Record<Cell["status"], string> = { done: "Done", skipped: "Skipped", missed: "Missed", pending: "Open", upcoming: "" };

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
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [typeId, setTypeId] = useState<number | null>(props.defaultTypeId);
  const [amount, setAmount] = useState(String(props.defaultAmount));
  const [steps, setSteps] = useState(props.steps === null ? "" : String(props.steps));
  const active = props.types.filter((t) => t.active);
  const unit = active.find((t) => t.id === typeId)?.unit ?? "reps";
  const stepPct = props.steps === null || props.stepGoal <= 0 ? 0 : props.steps / props.stepGoal;

  function log(status: "done" | "skipped") {
    if (!cell) return;
    setError(null);
    start(async () => {
      const r = await logExerciseCellAction(cell.iso, status, status === "done" ? typeId : null, status === "done" ? Math.round(Number(amount)) : null);
      if (!r.ok) setError(r.error);
      else {
        toast(status === "done" ? "Logged." : "Marked skipped.");
        setCell(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Health</h1>
        <p className="mt-1 text-sm text-subtle">
          {props.dateLabel} · <span className="font-medium text-fg">{props.counts.done}</span> done, {props.counts.skipped} skipped, {props.counts.missed} missed
          {props.paused ? <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">Pings paused</span> : null}
        </p>
      </header>

      <section aria-label="Exercise slots" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Today&apos;s slots</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {props.cells.map((c) => (
            <button
              key={c.iso}
              type="button"
              disabled={c.status === "upcoming"}
              onClick={() => setCell(c)}
              className={cn("flex min-h-[64px] flex-col justify-between rounded-xl border p-2 text-left transition-colors hover:brightness-95 disabled:cursor-default", STYLE[c.status])}
              aria-label={`${c.label} ${WORD[c.status]}`}
            >
              <span className="tabular text-sm font-medium">{c.label}</span>
              <span className="text-[11px] leading-tight">
                {c.status === "done" ? (
                  <>
                    {c.unit === "seconds" ? `${c.amount}s` : c.amount} {c.typeName}
                    {c.extraNames && c.extraNames.length > 0 && (
                      <span className="block text-subtle">+{c.extraNames.join(", ")}</span>
                    )}
                  </>
                ) : WORD[c.status]}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-subtle">Pings arrive in Telegram every {30} minutes. Tap a past slot to log or correct it here.</p>
      </section>

      <section aria-label="Steps" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Steps</h2>
        <Card className="p-4">
          <div className="flex items-baseline justify-between">
            <p className="tabular text-2xl font-medium">{props.steps === null ? "Not entered" : props.steps.toLocaleString("en-US")}</p>
            <p className="tabular text-sm text-subtle">goal {props.stepGoal.toLocaleString("en-US")}</p>
          </div>
          <Progress className="mt-2" value={stepPct} tone={stepPct >= 1 ? "accent" : "warn"} />
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
            <Input inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value.replace(/\D/g, ""))} placeholder="Steps today" aria-label="Steps today" />
            <Button type="submit" variant="outline" disabled={pending}>Save</Button>
          </form>
        </Card>
      </section>

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
