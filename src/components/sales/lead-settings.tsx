"use client";
// The lead's settings: a gear at the top of a deal or radar lead, for the things you rarely need (edit, do not contact,
// send back, delete). Out of the way, but always in the same place.
import { Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface SettingsItem { label: string; onSelect: () => void; danger?: boolean; hint?: string; hidden?: boolean }

export function LeadSettings({ items, label = "Lead settings" }: { items: SettingsItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const shown = items.filter((i) => !i.hidden);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-subtle hover:border-accent hover:text-accent", open && "border-accent text-accent")}>
        <Settings2 className="h-4 w-4" />
      </button>
      {open ? (
        <div role="menu" aria-label={label} className="dropdown-in absolute right-0 top-9 z-40 w-60 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-[var(--shadow-lg)]">
          {shown.map((i, n) => (
            <button key={i.label} type="button" role="menuitem" onClick={() => { setOpen(false); i.onSelect(); }}
              className={cn("block w-full px-3 py-2 text-left text-sm hover:bg-muted", i.danger ? "text-bad" : "text-fg", i.danger && n > 0 && "mt-1 border-t border-border pt-2.5")}>
              {i.label}
              {i.hint ? <span className="block text-[11px] text-subtle">{i.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
