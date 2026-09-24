"use client";

import { Moon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { setSleepAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { fmtDuration, type DateStr } from "@/lib/time";
import { useToast } from "../toast";
import { Card } from "../ui";

const PRESETS = [300, 360, 390, 420, 450, 480, 540];
const FACES = ["😫", "😕", "😐", "🙂", "😄"];
const FACE_LABEL = ["Awful", "Poor", "Okay", "Good", "Great"];

const hoursLabel = (m: number) => `${Math.floor(m / 60)}${m % 60 ? "½" : ""}h`;

/** Last night's sleep: one tap for the common durations, a custom value, and how well you slept. */
export function SleepCard({ date, minutes, quality }: { date: DateStr; minutes: number | null; quality: number | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [opt, setOpt] = useOptimistic({ minutes, quality });
  const [custom, setCustom] = useState(false);

  function save(next: { minutes: number | null; quality?: number | null }) {
    start(async () => {
      setOpt({ minutes: next.minutes, quality: next.quality === undefined ? opt.quality : next.quality });
      const r = await setSleepAction(date, next.minutes, next.quality);
      if (!r.ok) toast(r.error, "error");
      else router.refresh();
    });
  }

  const logged = opt.minutes !== null;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-muted text-accent">
          <Moon className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Sleep</h2>
        {logged ? (
          <span className="tabular ml-auto text-sm font-semibold">
            {fmtDuration(opt.minutes!)}
            {opt.quality ? <span className="ml-1.5" title={FACE_LABEL[opt.quality - 1]}>{FACES[opt.quality - 1]}</span> : null}
          </span>
        ) : (
          <span className="ml-auto text-xs text-subtle">How long did you sleep?</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Hours slept">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={pending}
            aria-pressed={opt.minutes === m}
            onClick={() => save({ minutes: m })}
            className={cn(
              "tabular h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
              opt.minutes === m ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-muted",
            )}
          >
            {hoursLabel(m)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom((v) => !v)}
          className={cn(
            "h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            logged && !PRESETS.includes(opt.minutes!) ? "border-accent bg-accent text-accent-fg" : "border-border text-subtle hover:bg-muted",
          )}
        >
          Other
        </button>
      </div>

      {custom ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const h = Number(new FormData(e.currentTarget).get("h"));
            if (!Number.isFinite(h) || h <= 0 || h > 24) return toast("Enter hours between 0 and 24, e.g. 6.75", "error");
            save({ minutes: Math.round(h * 60) });
            setCustom(false);
          }}
        >
          <input
            name="h"
            type="number"
            step="0.25"
            min="0"
            max="24"
            autoFocus
            placeholder="Hours, e.g. 6.75"
            aria-label="Hours slept"
            className="h-8 w-36 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent/60"
          />
          <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg">Save</button>
        </form>
      ) : null}

      {logged ? (
        <div className="mt-3 flex items-center gap-1" role="group" aria-label="Sleep quality">
          <span className="mr-1 text-xs text-subtle">Quality</span>
          {FACES.map((f, i) => (
            <button
              key={f}
              type="button"
              disabled={pending}
              title={FACE_LABEL[i]}
              aria-label={`Sleep quality: ${FACE_LABEL[i]}`}
              aria-pressed={opt.quality === i + 1}
              onClick={() => save({ minutes: opt.minutes, quality: i + 1 })}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg text-base transition-all",
                opt.quality === i + 1 ? "scale-110 bg-accent-muted ring-1 ring-accent/40" : "opacity-60 hover:bg-muted hover:opacity-100",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
