"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Dumbbell, Eye, EyeOff, Pencil, Play, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createExerciseTypeAction, deleteExerciseTypeAction, updateExerciseTypeAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { amountMeaning, catalogFor, type ExerciseInfo, type Unit } from "@/lib/exercise-catalog";
import { useToast } from "../toast";
import { Button, ErrorNote, Input, Select } from "../ui";
import { ExerciseFigure } from "./exercise-figure";

export interface ExerciseTypeData {
  id: number;
  name: string;
  defaultAmount: number;
  unit: Unit;
  active: boolean;
  /** "today", "3 days ago"; null if never logged */
  lastUsed?: string | null;
  sets30d?: number;
}

const LEVEL_TONE = { easy: "bg-good-muted text-good", medium: "bg-warn-muted text-warn", hard: "bg-bad-muted text-bad" } as const;

const UNIT_HELP = "Reps: count each repetition of the movement. Seconds: hold the position (plank, wall sit) or keep moving (high knees) for that long.";
const AMOUNT_HELP = "One set = this amount. It is filled in for you each time you log this exercise; change it whenever you do more or less.";

/** Big demo, steps, what to avoid, easier and harder options. */
export function HowToDialog({ info, name, amount, unit, open, onClose }: {
  info: ExerciseInfo | null;
  name: string;
  amount: number;
  unit: Unit;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet-content fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 pb-safe shadow-[var(--shadow-lg)] sm:bottom-auto sm:top-[6vh] sm:rounded-3xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-xl leading-tight">{name}</Dialog.Title>
              <p className="mt-0.5 text-sm text-subtle">
                {unit === "seconds" ? `${amount} seconds a set` : `${amount} reps a set`}
                {info ? ` · ${info.muscles}` : ""}
              </p>
            </div>
            <Dialog.Close className="-mr-1 -mt-1 rounded-full p-2 text-subtle hover:bg-muted hover:text-fg" aria-label="Close">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          {info ? (
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <div className="rounded-2xl bg-muted/50 p-3">
                  <ExerciseFigure rig={info.rig} controls fps={60} className="mx-auto h-72 w-full max-w-sm" label={`${info.name} demonstration`} />
                  <p className="mt-1 text-center text-[11px] text-subtle">Drag to turn it around · double-click to reset</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  <span className={cn("rounded-full px-2 py-0.5 capitalize", LEVEL_TONE[info.level])}>{info.level}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-subtle">{info.needs ?? "No equipment"}</span>
                </div>
                <p className="mt-3 rounded-xl bg-accent-muted px-3 py-2 text-xs text-fg">
                  <strong className="font-semibold">What the number means. </strong>{amountMeaning(unit, amount, info)}
                </p>
              </div>
              <div className="space-y-4 text-sm">
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">How to do it</h3>
                  <ol className="space-y-1.5">
                    {info.steps.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">{i + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </section>
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">Avoid</h3>
                  <ul className="list-disc space-y-1 pl-5 text-subtle">
                    {info.avoid.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </section>
                <div className="grid gap-2 sm:grid-cols-2">
                  <p className="rounded-xl border border-border p-3 text-xs"><strong className="block text-[11px] uppercase tracking-wider text-good">Easier</strong>{info.easier}</p>
                  <p className="rounded-xl border border-border p-3 text-xs"><strong className="block text-[11px] uppercase tracking-wider text-bad">Harder</strong>{info.harder}</p>
                </div>
                <p className="text-[11px] text-subtle">Stop if anything hurts (beyond normal muscle effort). Form cues follow standard coaching guidance.</p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-subtle">
              <Dumbbell className="mx-auto mb-2 h-6 w-6 text-accent/60" />
              This is your own exercise, so there is no demonstration for it.
              <p className="mt-2 text-xs">{amountMeaning(unit, amount)}</p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Card({ t, onHowTo }: { t: ExerciseTypeData; onHowTo: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [amount, setAmount] = useState(String(t.defaultAmount));
  const [unit, setUnit] = useState<Unit>(t.unit);
  const [error, setError] = useState<string | null>(null);
  const info = catalogFor(t.name);

  function save(active?: boolean) {
    setError(null);
    start(async () => {
      const r = await updateExerciseTypeAction(t.id, { name, default_amount: Math.round(Number(amount)), unit, active });
      if (!r.ok) setError(r.error);
      else {
        toast(active === undefined ? "Saved." : active ? "Back in your list." : "Hidden from logging and pings.");
        setEditing(false);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!confirm(`Delete "${t.name}"? Sets you already logged stay in your history.`)) return;
    start(async () => {
      const r = await deleteExerciseTypeAction(t.id);
      if (!r.ok) toast(r.error, "error");
      else { toast("Exercise deleted."); router.refresh(); }
    });
  }

  return (
    <li
      className={cn("group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-shadow hover:shadow-[var(--shadow-sm)]", !t.active && "opacity-60")}
    >
      <button type="button" onClick={onHowTo} className="relative block bg-muted/40 px-2 pt-1" aria-label={`How to do ${t.name}`}>
        {info ? (
          <ExerciseFigure rig={info.rig} className="mx-auto h-32 w-full" label={`${t.name} demonstration`} />
        ) : (
          <div className="flex h-24 items-center justify-center text-subtle"><Dumbbell className="h-8 w-8 opacity-40" /></div>
        )}
        <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[10px] font-semibold text-accent shadow-sm">
          <Play className="h-3 w-3" /> How to
        </span>
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {editing ? (
          <div className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Exercise name" className="h-9" />
            <div className="flex gap-2">
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} aria-label="Amount per set" className="h-9 w-20" />
              <Select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit" className="h-9">
                <option value="reps">reps</option>
                <option value="seconds">seconds</option>
              </Select>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="primary" disabled={pending} onClick={() => save()}>Save</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setEditing(false); setName(t.name); setAmount(String(t.defaultAmount)); setUnit(t.unit); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold leading-tight">{t.name}</p>
              {info ? <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize", LEVEL_TONE[info.level])}>{info.level}</span> : null}
            </div>
            <p className="text-xs">
              <span className="tabular font-semibold">{t.defaultAmount}</span>{" "}
              <span className="text-subtle">{t.unit === "seconds" ? "seconds a set (hold or keep going)" : "reps a set (times in a row)"}</span>
            </p>
            {info ? <p className="line-clamp-1 text-[11px] text-subtle" title={info.muscles}>{info.muscles}</p> : <p className="text-[11px] text-subtle">Your own exercise</p>}
            <p className="mt-auto text-[11px] text-subtle">
              {t.lastUsed ? `Last done ${t.lastUsed}` : "Not logged yet"}
              {t.sets30d ? ` · ${t.sets30d} set${t.sets30d === 1 ? "" : "s"} in 30 days` : ""}
              {!t.active ? " · hidden" : ""}
            </p>
          </>
        )}
        <ErrorNote message={error} />
      </div>
      {!editing ? (
        <div className="flex border-t border-border text-subtle">
          <button type="button" onClick={() => setEditing(true)} className="flex flex-1 items-center justify-center gap-1 py-1.5 text-[11px] font-medium hover:bg-muted hover:text-fg" title="Change the name, amount or unit">
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button type="button" disabled={pending} onClick={() => save(!t.active)} className="flex flex-1 items-center justify-center gap-1 border-l border-border py-1.5 text-[11px] font-medium hover:bg-muted hover:text-fg" title={t.active ? "Hide it from logging and Telegram pings" : "Show it again"}>
            {t.active ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Show</>}
          </button>
          <button type="button" disabled={pending} onClick={remove} className="flex items-center justify-center border-l border-border px-3 py-1.5 hover:bg-bad-muted hover:text-bad" aria-label={`Delete ${t.name}`} title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** The exercise library: every exercise with an animated demo, the amount explained, and edit / hide / delete. */
export function ExerciseTypes({ types }: { types: ExerciseTypeData[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("20");
  const [unit, setUnit] = useState<Unit>("reps");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "active" | "hidden">("active");
  const [howTo, setHowTo] = useState<ExerciseTypeData | null>(null);

  const shown = useMemo(() => {
    const qq = query.trim().toLowerCase();
    return types.filter((t) => {
      if (show === "active" && !t.active) return false;
      if (show === "hidden" && t.active) return false;
      if (!qq) return true;
      const info = catalogFor(t.name);
      return `${t.name} ${info?.muscles ?? ""} ${info?.needs ?? ""}`.toLowerCase().includes(qq);
    });
  }, [types, query, show]);
  const hiddenCount = types.filter((t) => !t.active).length;
  const known = catalogFor(name);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or muscle, e.g. core, chair" className="h-9 pl-9" aria-label="Search exercises" />
        </div>
        <div className="inline-flex h-9 rounded-xl bg-muted p-0.5 text-xs font-semibold" role="group" aria-label="Which exercises">
          {([["active", "In use"], ["hidden", `Hidden${hiddenCount ? ` (${hiddenCount})` : ""}`], ["all", "All"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={cn("rounded-[10px] px-3", show === k ? "bg-surface text-fg shadow-sm" : "text-subtle hover:text-fg")}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-subtle">
        Most recently done first. Drag any figure to turn it around in 3D; click a card for step-by-step instructions.
        {" "}{UNIT_HELP}
      </p>

      {shown.length ? (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((t) => (
            <Card key={`${t.id}-${t.name}-${t.defaultAmount}-${t.unit}-${t.active}`} t={t} onHowTo={() => setHowTo(t)} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-subtle">No exercises match.</p>
      )}

      <form
        className="rounded-2xl border border-dashed border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await createExerciseTypeAction({ name, default_amount: Math.round(Number(amount)), unit });
            if (!r.ok) setError(r.error);
            else {
              setName("");
              toast("Exercise added.");
              router.refresh();
            }
          });
        }}
      >
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
          Add your own
        </p>
        <div className="grid grid-cols-[1fr_5rem_7rem] gap-2 sm:grid-cols-[1fr_6rem_8rem_auto]">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              const k = catalogFor(e.target.value);
              if (k) { setAmount(String(k.amount)); setUnit(k.unit); }
            }}
            placeholder="Name, e.g. Skipping"
            aria-label="New exercise name"
            className="col-span-3 sm:col-span-1"
          />
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} aria-label="Amount per set" title={AMOUNT_HELP} />
          <Select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit" title={UNIT_HELP}>
            <option value="reps">reps</option>
            <option value="seconds">seconds</option>
          </Select>
          <Button type="submit" variant="outline" disabled={pending || !name.trim()} className="col-span-3 sm:col-span-1">Add</Button>
        </div>
        {known ? <p className="mt-1.5 text-xs text-good">Recognised as {known.name}: it will get the demonstration and instructions.</p> : null}
        <ErrorNote message={error} />
      </form>

      <HowToDialog
        info={howTo ? catalogFor(howTo.name) : null}
        name={howTo?.name ?? ""}
        amount={howTo?.defaultAmount ?? 0}
        unit={howTo?.unit ?? "reps"}
        open={!!howTo}
        onClose={() => setHowTo(null)}
      />
    </div>
  );
}
