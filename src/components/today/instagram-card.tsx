"use client";

import { Instagram } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { setInstagramAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { fmtDuration, type DateStr } from "@/lib/time";
import { useToast } from "../toast";
import { Card } from "../ui";

/** Daily Instagram limit, in minutes. */
export const INSTAGRAM_LIMIT_MIN = 60;
const PRESETS = [0, 15, 30, 45, 60];

/** Today's Instagram time against a one-hour limit: one tap for common values, a custom value, and a warning when over. */
export function InstagramCard({ date, minutes }: { date: DateStr; minutes: number | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [opt, setOpt] = useOptimistic(minutes);
  const [custom, setCustom] = useState(false);

  function save(next: number | null) {
    start(async () => {
      setOpt(next);
      const r = await setInstagramAction(date, next);
      if (!r.ok) toast(r.error, "error");
      else router.refresh();
    });
  }

  const logged = opt !== null;
  const over = logged && opt! > INSTAGRAM_LIMIT_MIN;
  const pct = logged ? Math.min(100, (opt! / INSTAGRAM_LIMIT_MIN) * 100) : 0;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-muted text-accent">
          <Instagram className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Instagram</h2>
        {logged ? (
          <span className={cn("tabular ml-auto flex items-center gap-2 text-sm font-semibold", over && "text-red-600")}>
            {fmtDuration(opt!)} <span className="text-xs font-normal text-subtle">/ 1h</span>
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
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={INSTAGRAM_LIMIT_MIN} aria-valuenow={Math.min(opt!, INSTAGRAM_LIMIT_MIN)}>
          <div className={cn("h-full rounded-full transition-all", over ? "bg-red-500" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {over ? <p className="mt-2 text-xs text-red-600">Over your 1 hour limit by {fmtDuration(opt! - INSTAGRAM_LIMIT_MIN)}.</p> : null}

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Minutes on Instagram">
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
            )}
          >
            {m === 0 ? "None" : m === 60 ? "1h" : `${m}m`}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom((v) => !v)}
          className={cn(
            "h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            logged && !PRESETS.includes(opt!) ? "border-accent bg-accent text-accent-fg" : "border-border text-subtle hover:bg-muted",
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
            const m = Number(new FormData(e.currentTarget).get("m"));
            if (!Number.isFinite(m) || m < 0 || m > 1440) return toast("Enter minutes between 0 and 1440, e.g. 40", "error");
            save(Math.round(m));
            setCustom(false);
          }}
        >
          <input
            name="m"
            type="number"
            step="1"
            min="0"
            max="1440"
            autoFocus
            placeholder="Minutes, e.g. 40"
            aria-label="Minutes on Instagram"
            className="h-8 w-36 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent/60"
          />
          <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg">Save</button>
        </form>
      ) : null}
    </Card>
  );
}
