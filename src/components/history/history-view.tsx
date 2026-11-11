"use client";
import { InfoTip } from "@/components/info-tip";

import { ChevronDown, Redo2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeDetailsAction, undoChangeAction } from "@/app/undo-actions";
import { cn } from "@/lib/cn";
import type { ActionItem } from "@/lib/undo";
import { useToast } from "../toast";
import { Button } from "../ui";

type Rows = Extract<Awaited<ReturnType<typeof changeDetailsAction>>, { ok: true }>["rows"];

const SOURCE: Record<string, string> = { web: "App", telegram: "Telegram", claude: "Claude", undo: "Undo" };
const OP = { I: "Added", U: "Changed", D: "Removed" } as const;

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}
const show = (v: unknown) => (v === null || v === undefined ? "nothing" : typeof v === "string" ? (v.length > 60 ? `${v.slice(0, 60)}…` : v) : String(v));

function Row({ a }: { a: ActionItem }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Rows | null>(null);
  const isUndo = a.undo_of !== null;
  const undone = a.undone_at !== null;
  const toggle = () => {
    setOpen((o) => !o);
    if (!rows) start(async () => { const r = await changeDetailsAction(a.id); if (r.ok) setRows(r.rows); });
  };
  const run = () => start(async () => {
    const r = await undoChangeAction(a.id);
    if (!r.ok) toast(r.error, "error");
    router.refresh();
  });
  return (
    <li className={cn("rounded-2xl border border-border bg-surface", undone && "opacity-60")}>
      <div className="flex items-start gap-3 p-3">
        <button type="button" onClick={toggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <p className={cn("text-[15px] font-medium leading-snug", undone && "line-through")}>{a.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
            <span className="tabular">{when(a.created_at)}</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5">{SOURCE[a.source] ?? a.source}</span>
            <span>{a.changes} {a.changes === 1 ? "change" : "changes"}</span>
            {undone ? <span className="font-medium text-p-lilac-fg">undone</span> : null}
            <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          </p>
        </button>
        {!undone ? (
          <Button size="sm" variant={isUndo ? "outline" : "primary"} disabled={busy || !!a.blocked_by} onClick={run} className="shrink-0">
            {isUndo ? <Redo2 className="h-3.5 w-3.5" /> : <Undo2 className="h-3.5 w-3.5" />} {isUndo ? "Redo" : "Undo"}
          </Button>
        ) : null}
      </div>
      {a.blocked_by && !undone ? <p className="border-t border-border bg-p-butter px-3 py-1.5 text-xs text-p-butter-fg">Undo “{a.blocked_by}” first: it changed the same thing afterwards.</p> : null}
      {open ? (
        <ul className="space-y-1 border-t border-border px-3 py-2 text-xs">
          {!rows ? <li className="text-subtle">Loading…</li> : rows.map((r, i) => (
            <li key={i}>
              <span className="font-medium">{OP[r.op as keyof typeof OP]} {r.noun}</span>{r.nm ? <> “{r.nm}”</> : null}
              {r.op === "U" && r.chg ? (
                <ul className="mt-0.5 text-subtle">
                  {Object.entries(r.chg).filter(([k]) => k !== "sort").slice(0, 6).map(([k, [from, to]]) => (
                    <li key={k}>{k.replace(/_/g, " ")}: {show(from)} → {show(to)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function HistoryView({ actions }: { actions: ActionItem[] }) {
  const groups: { label: string; items: ActionItem[] }[] = [];
  for (const a of actions) {
    const label = dayLabel(a.created_at);
    const g = groups.at(-1);
    if (g && g.label === label) g.items.push(a);
    else groups.push({ label, items: [a] });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-p-lilac-fg">History</p>
        <h1 className="font-display text-2xl sm:text-3xl leading-tight">Everything you changed</h1>
        <p className="mt-1 flex items-center gap-1 text-sm text-subtle">
          Kept for 30 days. Undo puts anything back.
          <InfoTip label="About history">{"- Every change from the app, Telegram and Claude is kept for 30 days.\n- Undo puts it back; Redo changes your mind again.\n- On a computer, Ctrl+Z (⌘Z on a Mac) undoes the last one.\n- If a newer change touched the same thing, undo that first."}</InfoTip>
        </p>
      </header>
      {groups.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-subtle">Nothing yet. Changes you make will appear here.</p> : null}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{g.label}</h2>
          <ul className="space-y-2">{g.items.map((a) => <Row key={a.id} a={a} />)}</ul>
        </section>
      ))}
    </div>
  );
}
