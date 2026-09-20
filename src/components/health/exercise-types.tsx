"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createExerciseTypeAction, updateExerciseTypeAction } from "@/app/actions";
import { useToast } from "../toast";
import { Button, ErrorNote, Input, Select } from "../ui";

export interface ExerciseTypeData {
  id: number;
  name: string;
  defaultAmount: number;
  unit: "reps" | "seconds";
  active: boolean;
}

function Row({ t }: { t: ExerciseTypeData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(t.name);
  const [amount, setAmount] = useState(String(t.defaultAmount));
  const [unit, setUnit] = useState(t.unit);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== t.name || Number(amount) !== t.defaultAmount || unit !== t.unit;

  function save(active?: boolean) {
    setError(null);
    start(async () => {
      const r = await updateExerciseTypeAction(t.id, { name, default_amount: Math.round(Number(amount)), unit, active });
      if (!r.ok) setError(r.error);
      else {
        toast("Saved.");
        router.refresh();
      }
    });
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-2.5">
      <div className="grid grid-cols-[1fr_5rem_6rem] gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Exercise name" className="col-span-3 sm:col-span-1" />
        <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} aria-label="Default amount" />
        <Select value={unit} onChange={(e) => setUnit(e.target.value as "reps" | "seconds")} aria-label="Unit">
          <option value="reps">reps</option>
          <option value="seconds">seconds</option>
        </Select>
        <div className="col-span-3 flex gap-2 sm:col-span-1">
          <Button size="sm" variant="primary" disabled={pending || !dirty} onClick={() => save()}>Save</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(!t.active)}>{t.active ? "Hide" : "Show"}</Button>
        </div>
      </div>
      {!t.active ? <p className="mt-1 text-xs text-subtle">Hidden from pings.</p> : null}
      <ErrorNote message={error} />
    </li>
  );
}

/** Exercise types: name, default amount, unit (reps or seconds). Used on Health and in Settings. */
export function ExerciseTypes({ types }: { types: ExerciseTypeData[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("20");
  const [unit, setUnit] = useState<"reps" | "seconds">("reps");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {types.map((t) => (
          <Row key={`${t.id}-${t.name}-${t.defaultAmount}-${t.unit}-${t.active}`} t={t} />
        ))}
      </ul>
      <form
        className="grid grid-cols-[1fr_5rem_6rem] gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]"
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
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New exercise, e.g. Lunges" aria-label="New exercise name" className="col-span-3 sm:col-span-1" />
        <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} aria-label="Default amount" />
        <Select value={unit} onChange={(e) => setUnit(e.target.value as "reps" | "seconds")} aria-label="Unit">
          <option value="reps">reps</option>
          <option value="seconds">seconds</option>
        </Select>
        <Button type="submit" variant="outline" disabled={pending || !name.trim()} className="col-span-3 sm:col-span-1">Add</Button>
      </form>
      <ErrorNote message={error} />
    </div>
  );
}
