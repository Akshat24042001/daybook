"use client";

import { Instagram, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { setInstagramAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { fmtDuration, type DateStr } from "@/lib/time";
import { useToast } from "../toast";
import { Card } from "../ui";

/** Daily Instagram limit, in minutes. */
export const INSTAGRAM_LIMIT_MIN = 60;
/** totals you can set in one tap */
const PRESETS = [0, 30, 60, 90, 120, 180];
/** amounts you add on top as the day goes on */
const STEPS = [5, 15, 30, 60];
const MAX = 1440;

const short = (m: number) => (m === 0 ? "None" : m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h${m % 60}` : `${m}m`);

/**
 * Today's Instagram time against a one-hour limit. Built to be updated through the day: add 15 or 30 minutes each
 * time you check your screen time, or set the total. Going over the limit is shown, never blocked.
 */
export function InstagramCard({ date, minutes }: { date: DateStr; minutes: number | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [opt, setOpt] = useOptimistic(minutes);
  const [custom, setCustom] = useState(false);

  function save(next: number | null) {
    if (next !== null) next = Math.max(0, Math.min(MAX, Math.round(next)));
    start(async () => {
      setOpt(next);
      const r = await setInstagramAction(date, next);
      if (!r.ok) toast(r.error, "error");
      else router.refresh();
    });
  }

  const logged = opt !== null;
  const value = opt ?? 0;
  const over = logged && value > INSTAGRAM_LIMIT_MIN;
  // the bar stretches past the limit so 3 hours looks like 3 hours, with a marker where the limit is
  const scale = Math.max(INSTAGRAM_LIMIT_MIN * 1.5, value);
  const pct = (value / scale) * 100;
  const limitPct = (INSTAGRAM_LIMIT_MIN / scale) * 100;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-muted text-accent">
          <Instagram className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Instagram</h2>
        {logged ? (
          <span className={cn("tabular ml-auto flex items-center gap-2 text-sm font-semibold", over && "text-bad")}>
            {fmtDuration(value)} <span className="text-xs font-normal text-subtle">/ 1h limit</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => save(null)}
              className="rounded-md px-1.5 py-0.5 text-xs font-medium text-subtle hover:bg-muted hover:text-fg"
              title="Remove today's Instagram time"
            >
              Clear
            </button>
          </span>
        ) : (
          <span className="ml-auto text-xs text-subtle">Stay under 1h a day</span>
        )}
      </div>

      {logged ? (
        <div className="relative mt-3 h-2 rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={scale} aria-valuenow={value} aria-label="Instagram time against the 1 hour limit">
          <div className={cn("h-full rounded-full transition-all", over ? "bg-bad" : "bg-accent")} style={{ width: `${pct}%` }} />
          <span className="absolute -top-1 h-4 w-0.5 rounded bg-fg/60" style={{ left: `${limitPct}%` }} title="1 hour limit" aria-hidden />
        </div>
      ) : null}
      {over ? <p className="mt-2 text-xs font-medium text-bad">Over the 1 hour limit by {fmtDuration(value - INSTAGRAM_LIMIT_MIN)}.</p> : null}

      {/* add as the day goes on */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Add Instagram time">
        <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Add</span>
        {STEPS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={pending || value >= MAX}
            onClick={() => save(value + m)}
            className="tabular inline-flex h-8 items-center gap-0.5 rounded-lg border border-border px-2.5 text-xs font-semibold transition-colors hover:border-accent/50 hover:bg-accent-muted hover:text-accent"
            title={`Add ${short(m)} to today's total`}
          >
            <Plus className="h-3 w-3" />{short(m)}
          </button>
        ))}
        {logged && value > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(value - 15)}
            className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-subtle hover:bg-muted hover:text-fg"
            title="Take 15 minutes off (a mistake)"
          >
            <Minus className="h-3 w-3" />15m
          </button>
        ) : null}
      </div>

      {/* or set the total */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Total minutes on Instagram">
        <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Total</span>
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={pending}
            aria-pressed={opt === m}
            onClick={() => save(m)}
            className={cn(
              "tabular h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
              opt === m ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-muted",
              m > INSTAGRAM_LIMIT_MIN && opt !== m && "text-bad/80",
            )}
          >
            {short(m)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom((v) => !v)}
          className={cn(
            "h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            logged && !PRESETS.includes(value) ? "border-accent bg-accent text-accent-fg" : "border-border text-subtle hover:bg-muted",
          )}
        >
          Exact
        </button>
      </div>

      {custom ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const h = Number(f.get("h") || 0);
            const mi = Number(f.get("m") || 0);
            const total = Math.round(h * 60 + mi);
            if (!Number.isFinite(total) || h < 0 || mi < 0 || total > MAX) return toast("Enter hours and minutes, e.g. 2 h 20 m (up to 24 h).", "error");
            save(total);
            setCustom(false);
          }}
        >
          <input name="h" type="number" step="1" min="0" max="24" autoFocus defaultValue={logged ? Math.floor(value / 60) : ""} placeholder="0" aria-label="Hours on Instagram" className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent/60" />
          <span className="text-xs text-subtle">h</span>
          <input name="m" type="number" step="1" min="0" max="59" defaultValue={logged ? value % 60 : ""} placeholder="0" aria-label="Minutes on Instagram" className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent/60" />
          <span className="text-xs text-subtle">m</span>
          <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg">Save</button>
        </form>
      ) : null}
    </Card>
  );
}
