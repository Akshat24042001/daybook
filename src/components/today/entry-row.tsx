"use client";

import { Check, ChevronRight, Minus, RotateCcw, Star, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { fmtDuration } from "@/lib/time";
import type { EntryStatus } from "@/lib/types";
import type { RowData } from "@/lib/view-types";
import { Chip } from "../ui";

export function StatusGlyph({ status, className }: { status: EntryStatus; className?: string }) {
  const base = "flex h-7 w-7 items-center justify-center rounded-full border-2";
  switch (status) {
    case "done":
      return (
        <span className={cn(base, "border-good bg-good text-white", className)}>
          <Check className="h-4 w-4 stroke-[3]" />
        </span>
      );
    case "progressed":
      return (
        <span className={cn(base, "border-good text-good", className)} aria-hidden>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5">
            <path d="M10 2 a8 8 0 0 1 0 16 z" fill="currentColor" />
          </svg>
        </span>
      );
    case "attempted":
      return (
        <span className={cn(base, "border-warn text-warn", className)}>
          <RotateCcw className="h-3.5 w-3.5" />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "border-bad text-bad", className)}>
          <X className="h-4 w-4 stroke-[3]" />
        </span>
      );
    case "dropped":
      return (
        <span className={cn(base, "border-subtle text-subtle", className)}>
          <Minus className="h-4 w-4 stroke-[3]" />
        </span>
      );
    default:
      return <span className={cn(base, "border-subtle/70 bg-surface/60", className)} />;
  }
}

const SWIPE = 84;

export function EntryRow({
  row,
  onOpen,
  onQuickAction,
  onToggleMust,
}: {
  row: RowData;
  onOpen: () => void;
  /** swipe right / tick button: Progressed for Ongoing, Done for everything else */
  onQuickAction: () => void;
  /** star button: make or unmake a must-do for the day */
  onToggleMust?: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; lock: "h" | "v" | null } | null>(null);
  const swiped = useRef(false);
  const closed = row.status === "done" || row.status === "dropped";

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, lock: null };
    swiped.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x;
    const my = t.clientY - s.y;
    if (!s.lock && (Math.abs(mx) > 10 || Math.abs(my) > 10)) s.lock = Math.abs(mx) > Math.abs(my) ? "h" : "v";
    if (s.lock === "h") setDx(Math.max(-140, Math.min(140, mx)));
  };
  const onTouchEnd = () => {
    const moved = dx;
    start.current = null;
    setDx(0);
    if (moved > SWIPE) {
      swiped.current = true;
      if (!closed) onQuickAction();
    } else if (moved < -SWIPE) {
      swiped.current = true;
      onOpen();
    }
  };

  const meta: React.ReactNode[] = [];
  if (row.timeLabel) meta.push(<span key="t" className="tabular font-medium text-fg">{row.timeLabel}</span>);
  if (row.personName) meta.push(<span key="p">{row.personRole === "requested_by" ? "for" : "with"} {row.personName}</span>);
  if (row.estimateMin) meta.push(<span key="e" className="tabular">est {fmtDuration(row.estimateMin)}</span>);
  if (row.source === "auto" && row.carriedFrom) meta.push(<span key="a">auto-carried</span>);

  return (
    <li className="relative overflow-hidden rounded-xl">
      {/* swipe hints */}
      <div className="absolute inset-0 flex items-center justify-between px-4 text-xs font-medium text-white" aria-hidden>
        <span className={cn("rounded-full bg-good px-2 py-1", dx > 8 ? "opacity-100" : "opacity-0")}>
          {row.type === "ongoing" ? "Progressed" : "Done"}
        </span>
        <span className={cn("rounded-full bg-accent px-2 py-1", dx < -8 ? "opacity-100" : "opacity-0")}>Options</span>
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 160ms ease-out" : "none" }}
        className={cn(
          "flex items-center gap-3 border border-border px-3 py-2.5",
          row.mustDo && !closed ? "highlighter border-transparent" : "bg-surface",
          closed && "opacity-70",
        )}
      >
        <button
          type="button"
          onClick={closed ? onOpen : onQuickAction}
          aria-label={closed ? `${row.title}: ${row.status}. Open options` : `Mark ${row.title} ${row.type === "ongoing" ? "progressed" : "done"}`}
          className="shrink-0 rounded-full"
        >
          <StatusGlyph status={row.status} />
        </button>
        <button type="button" onClick={() => (swiped.current ? (swiped.current = false) : onOpen())} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn("text-[15px] font-medium leading-snug", closed && "line-through")}>{row.title}</span>
            {row.projectName ? <Chip color={row.projectColor}>{row.projectName}</Chip> : null}
          </span>
          {meta.length || row.minutes || row.carry >= 2 ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-subtle">
              {meta.map((m, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 ? <span aria-hidden>·</span> : null}
                  {m}
                </span>
              ))}
              {row.minutes ? (
                <span className="tabular rounded-full bg-accent/15 px-1.5 py-0.5 font-medium text-accent">{fmtDuration(row.minutes)} today</span>
              ) : null}
              {row.carry >= 2 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 font-medium",
                    row.carry >= 3 ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn",
                  )}
                  title="Times this task has been carried over"
                >
                  carried {row.carry}×
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
        {onToggleMust && !closed ? (
          <button
            type="button"
            onClick={onToggleMust}
            aria-pressed={row.mustDo}
            aria-label={row.mustDo ? `Remove must-do from ${row.title}` : `Make ${row.title} a must-do`}
            title={row.mustDo ? "Remove must-do" : "Make must-do"}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              row.mustDo ? "text-warn hover:bg-warn-muted" : "text-subtle/60 hover:bg-muted hover:text-warn",
            )}
          >
            <Star className={cn("h-[18px] w-[18px] transition-transform active:scale-90", row.mustDo && "fill-current")} />
          </button>
        ) : null}
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-subtle sm:block" aria-hidden />
      </div>
    </li>
  );
}
