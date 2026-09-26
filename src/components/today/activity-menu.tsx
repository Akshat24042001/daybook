"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ACTIVITY, type ActivityInfo, type ActivityKind } from "@/lib/activity";
import { cn } from "@/lib/cn";

/** The less frequent activities (remote, commute, meal, exercise, personal) behind one "More" button. */
export function ActivityMenu({
  items,
  current,
  disabled,
  onPick,
}: {
  items: ActivityInfo[];
  current: ActivityKind | "off";
  disabled?: boolean;
  onPick: (kind: ActivityKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const active = current !== "off" && items.some((i) => i.kind === current) ? ACTIVITY[current] : null;
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={!!active}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors",
          active ? "bg-accent text-accent-fg shadow-sm" : "text-fg hover:bg-muted",
        )}
      >
        {active ? <span aria-hidden>{active.emoji}</span> : null}
        <span>{active ? active.short : "More"}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          role="menu"
          className="dropdown-in absolute right-0 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-lg)]"
        >
          {items.map((a) => {
            const on = current === a.kind;
            return (
              <button
                key={a.kind}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setOpen(false);
                  if (!on) onPick(a.kind);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  on ? "bg-accent-muted font-semibold text-accent" : "hover:bg-muted",
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden />
                <span className="flex-1">{a.emoji} {a.label}</span>
                {a.work ? <span className="rounded-full bg-good-muted px-1.5 py-0.5 text-[10px] font-semibold text-good">work</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
