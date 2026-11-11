"use client";

import { Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * A small "i" next to a heading or a short line: tap or click it to read the detail, tap anywhere else (or Esc) to
 * close. Keeps screens short while the full explanation is one tap away. Lines starting with "- " show as bullets.
 */
export function InfoTip({ children, label = "More info", className }: { children: React.ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    // below the icon, or above it when there is no room
    const below = r.bottom + 8;
    const top = below + 200 > window.innerHeight && r.top > 220 ? r.top - 8 : below;
    setPos({ top, left, width });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(false), btn.current?.focus());
    const move = () => place();
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
    };
  }, [open]);

  const body = typeof children === "string" ? <Lines text={children} /> : children;
  const above = pos && btn.current && pos.top < btn.current.getBoundingClientRect().top;

  return (
    <>
      <button
        ref={btn}
        type="button"
        // the button just says "More info" so it never competes with the field or heading it sits next to;
        // the panel it opens carries the specific name
        aria-label="More info"
        title={label === "More info" ? undefined : label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle text-subtle/70 transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", open && "bg-muted text-fg", className)}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={pop}
              id={id}
              role="dialog"
              aria-label={label}
              style={{ top: pos.top, left: pos.left, width: pos.width, transform: above ? "translateY(-100%)" : undefined }}
              className="fixed z-[80] rounded-xl border border-border bg-surface p-3 pr-8 text-[13px] font-normal normal-case leading-relaxed tracking-normal text-fg shadow-[var(--shadow-lg)]"
            >
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute right-1.5 top-1.5 rounded p-1 text-subtle hover:text-fg">
                <X className="h-3.5 w-3.5" />
              </button>
              {body}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Lines({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`u${out.length}`} className="my-1 list-disc space-y-0.5 pl-4">{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    list = [];
  };
  for (const l of lines) {
    if (l.startsWith("- ")) list.push(l.slice(2));
    else {
      flush();
      out.push(<p key={`p${out.length}`} className="mb-1 last:mb-0">{l}</p>);
    }
  }
  flush();
  return <>{out}</>;
}
