"use client";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A section that folds away, with a one-line summary so you know what is inside without opening it. Remembers whether
 * you left it open (on this device).
 */
export function Fold({ id, title, summary, children, defaultOpen = false, action, compact = false }: { id: string; title: string; summary?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; action?: React.ReactNode; compact?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try {
      const v = localStorage.getItem(`fold:${id}`);
      if (v) setOpen(v === "1");
    } catch { /* private mode */ }
  }, [id]);
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem(`fold:${id}`, o ? "0" : "1"); } catch { /* ignore */ }
    return !o;
  });
  return (
    <section className={cn("border border-border bg-surface", compact ? "rounded-xl" : "rounded-2xl")} data-fold-section={id}>
      <div className={cn("flex items-center gap-2", compact ? "px-3 py-2" : "px-4 py-3")}>
        <button type="button" data-fold={id} aria-expanded={open} onClick={toggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-subtle transition-transform", !open && "-rotate-90")} />
          <span className={compact ? "text-sm font-semibold" : "font-display text-base"}>{title}</span>
          {summary ? <span className="truncate text-xs text-subtle">{summary}</span> : null}
        </button>
        {open && action ? action : null}
      </div>
      {open ? <div className={compact ? "px-3 pb-3" : "px-4 pb-4"}>{children}</div> : null}
    </section>
  );
}

