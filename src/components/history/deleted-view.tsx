"use client";
// Deleted: everything ever deleted on the platform, kept for good, with Restore.
import { ChevronDown, RotateCcw, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletedDetailsAction, restoreDeletedAction } from "@/app/undo-actions";
import { InfoTip } from "@/components/info-tip";
import { cn } from "@/lib/cn";
import type { DeletedGroup } from "@/lib/bin";
import { fmtZoned } from "@/lib/display-tz";
import { useToast } from "../toast";
import { Button, Input } from "../ui";

type Rows = Extract<Awaited<ReturnType<typeof deletedDetailsAction>>, { ok: true }>["rows"];

function dayLabel(iso: string): string {
  const key = (x: string | number | Date) => fmtZoned(x, { year: "numeric", month: "2-digit", day: "2-digit" });
  const k = key(iso);
  if (k === key(Date.now())) return "Today";
  if (k === key(Date.now() - 86_400_000)) return "Yesterday";
  return fmtZoned(iso, { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`}`;

export function headline(g: Pick<DeletedGroup, "noun" | "names" | "count">): string {
  const names = g.names.map((n) => `“${n.length > 60 ? `${n.slice(0, 60)}…` : n}”`);
  if (g.count === 1) return `Deleted ${g.noun}${names[0] ? ` ${names[0]}` : ""}`;
  const shown = names.slice(0, 3).join(", ");
  return `Deleted ${plural(g.count, g.noun)}${shown ? `: ${shown}${g.count > 3 ? ` and ${g.count - 3} more` : ""}` : ""}`;
}

function Row({ g }: { g: DeletedGroup }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Rows | null>(null);
  const toggle = () => {
    setOpen((o) => !o);
    if (!rows) start(async () => { const r = await deletedDetailsAction(g.grp); if (r.ok) setRows(r.rows); });
  };
  const restore = () => start(async () => {
    const r = await restoreDeletedAction(g.grp);
    if (!r.ok) return toast(r.error, "error");
    toast(`${r.label}${r.skipped ? ` (${r.skipped} already in place)` : ""}`);
    router.refresh();
  });
  return (
    <li className={cn("rounded-2xl border border-border bg-surface", g.restored && "opacity-60")} data-deleted={g.grp}>
      <div className="flex items-start gap-3 p-3">
        <button type="button" onClick={toggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <p className={cn("break-words text-[15px] font-medium leading-snug", g.restored && "line-through")}>{headline(g)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
            <span className="tabular">{fmtZoned(g.deleted_at, { hour: "numeric", minute: "2-digit" })}</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5">{g.source}</span>
            {g.linked ? <span>with {plural(g.linked, "linked item")}</span> : null}
            {g.restored ? <span className="font-medium text-p-mint-fg">restored</span> : g.partly ? <span className="font-medium text-p-butter-fg">partly restored</span> : null}
            <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          </p>
        </button>
        {!g.restored ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={restore} className="shrink-0 whitespace-nowrap" aria-label={`Restore ${headline(g)}`}>
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </Button>
        ) : null}
      </div>
      {open ? (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto border-t border-border px-3 py-2 text-xs">
          {!rows ? <li className="text-subtle">Loading…</li> : rows.map((r, i) => (
            <li key={i} className={cn("break-words", r.restored && "text-subtle line-through")}>
              <span className="font-medium">{r.noun}</span>{r.nm ? <> “{r.nm.length > 90 ? `${r.nm.slice(0, 90)}…` : r.nm}”</> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function DeletedView({ groups, auto, search }: { groups: DeletedGroup[]; auto: boolean; search: string }) {
  const router = useRouter();
  const [text, setText] = useState(search);
  const url = (o: { auto?: boolean; q?: string }) => {
    const p = new URLSearchParams();
    if (o.auto ?? auto) p.set("auto", "1");
    const s = (o.q ?? text).trim();
    if (s) p.set("q", s);
    const qs = p.toString();
    return `/deleted${qs ? `?${qs}` : ""}`;
  };
  const days: { label: string; items: DeletedGroup[] }[] = [];
  for (const g of groups) {
    const label = dayLabel(g.deleted_at);
    const d = days.at(-1);
    if (d && d.label === label) d.items.push(g);
    else days.push({ label, items: [g] });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-p-lilac-fg">Deleted</p>
        <h1 className="font-display text-2xl leading-tight sm:text-3xl">Everything you deleted</h1>
        <p className="mt-1 flex items-center gap-1 text-sm text-subtle">
          Nothing is ever thrown away. Restore puts it back with everything that went with it.
          <InfoTip label="About deleted items">{"- Anything deleted anywhere (the app, Telegram, Claude, the chat) is kept here for good, with its linked items: a lead keeps its timeline, notes, payments and documents.\n- Restore brings it back exactly as it was, with the same links.\n- If it belonged to something that is also deleted, restore that first.\n- A restore is also in History, so it can be undone."}</InfoTip>
        </p>
        <p className="mt-1 text-xs"><Link href="/history" className="text-accent hover:underline">History of changes</Link></p>
      </header>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); router.push(url({})); }}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find a deleted lead, task, note…" aria-label="Search deleted items" className="pl-9" />
        </div>
        <Button type="submit" variant="outline" size="sm">Search</Button>
        <label className="flex w-full items-center gap-2 text-xs text-subtle sm:w-auto">
          <input type="checkbox" checked={auto} onChange={(e) => router.push(url({ auto: e.target.checked }))} />
          Include automatic clean-ups
        </label>
      </form>
      {days.length === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-subtle">
          <Trash2 className="h-5 w-5" aria-hidden />{search ? "Nothing deleted matches that." : "Nothing deleted yet."}
        </p>
      ) : null}
      {days.map((d) => (
        <section key={d.label} aria-label={d.label} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{d.label}</h2>
          <ul className="space-y-2">{d.items.map((g) => <Row key={g.grp} g={g} />)}</ul>
        </section>
      ))}
    </div>
  );
}
