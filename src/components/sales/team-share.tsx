"use client";

import { Eye, EyeOff, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setDealShareAction, setVisibilityAction } from "@/app/sales-actions";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { DealShare, ItemKind } from "@/lib/team/sharing";

export interface Audience { id: number; name: string }

/**
 * Who of your salespeople sees one update. Yours start hidden ("Only you"); tick names to show it to them. Only people
 * the lead is shared with can be picked. A salesperson's own update always shows to them.
 */
export function VisibleTo({ kind, id, sharedWith, audience, authorUser, authorName }: {
  kind: ItemKind; id: number; sharedWith: number[]; audience: Audience[]; authorUser?: number | null; authorName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<number[]>(sharedWith);
  const [busy, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  useEffect(() => setSel(sharedWith), [sharedWith]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const others = audience.filter((a) => a.id !== authorUser);
  if (!others.length && !authorName) return null;
  const names = others.filter((a) => sel.includes(a.id)).map((a) => a.name);
  const label = authorName ? `by ${authorName}${names.length ? ` · also ${names.join(", ")}` : ""}` : names.length ? `Visible to ${names.join(", ")}` : "Only you";
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={!others.length}
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]", names.length || authorName ? "bg-accent-muted text-accent" : "text-subtle hover:bg-muted")}
        aria-label={`Who sees this: ${label}`}
      >
        {names.length || authorName ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} {label}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-border bg-surface p-2 text-sm shadow-[var(--shadow-lg)]" role="dialog" aria-label="Visible to">
          <p className="mb-1 px-1 text-xs text-subtle">Show this to</p>
          {others.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
              <input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} /> {a.name}
            </label>
          ))}
          <button type="button" disabled={busy} className="mt-1 w-full rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg" onClick={() => start(async () => {
            const r = await setVisibilityAction(kind, id, sel);
            if (!r.ok) return toast(r.error, "error");
            setOpen(false);
            router.refresh();
          })}>Save</button>
        </div>
      ) : null}
    </div>
  );
}

/** The lead's sharing: which salespeople have it, and whether they see its value and research. */
export function TeamSharing({ dealId, shares }: { dealId: number; shares: DealShare[] }) {
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  // ticks show at once; the server's answer replaces them on refresh
  const [over, setOver] = useState<Record<number, Partial<DealShare>>>({});
  useEffect(() => setOver({}), [shares]);
  if (!shares.length) return null;
  const set = (s: DealShare, o: { shared: boolean; show_value?: boolean; show_research?: boolean }, ok: string) => {
    setOver((x) => ({ ...x, [s.user_id]: { ...x[s.user_id], ...o } })); // outside the transition, so it shows now
    start(async () => {
      const r = await setDealShareAction(dealId, s.user_id, o);
      if (!r.ok) {
        setOver((x) => { const y = { ...x }; delete y[s.user_id]; return y; });
        return toast(r.error, "error");
      }
      toast(ok);
      router.refresh();
    });
  };
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Sales team">
      <h2 className="mb-1 flex items-center gap-1.5 text-[15px] font-semibold"><Users className="h-4 w-4 text-subtle" /> Sales team</h2>
      <p className="mb-2 text-xs text-subtle">They see this lead's details and their own updates. Your updates stay hidden unless you show them.</p>
      <ul className="space-y-2 text-sm">
        {shares.map((s0) => ({ ...s0, ...over[s0.user_id] })).map((s) => (
          <li key={s.user_id} className={cn("rounded-lg border border-border px-2.5 py-2", !s.active && "opacity-60")}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.shared} disabled={s.added_it} onChange={(e) => set(s, { shared: e.target.checked }, e.target.checked ? `Shared with ${s.display_name}` : `${s.display_name} no longer sees it`)} aria-label={`Share with ${s.display_name}`} />
              <span className="font-medium">{s.display_name}</span>
              {s.added_it ? <span className="text-xs text-subtle">added it</span> : null}
              {!s.active ? <span className="text-xs text-subtle">switched off</span> : null}
            </label>
            {s.shared ? (
              <div className="mt-1.5 flex flex-wrap gap-3 pl-6 text-xs">
                <label className="flex items-center gap-1"><input type="checkbox" checked={s.show_value || s.added_it} disabled={busy || s.added_it} onChange={(e) => set(s, { shared: true, show_value: e.target.checked }, "Saved")} aria-label={`${s.display_name} sees the value`} /> Sees the value</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={s.show_research || s.added_it} disabled={busy || s.added_it} onChange={(e) => set(s, { shared: true, show_research: e.target.checked }, "Saved")} aria-label={`${s.display_name} sees the research`} /> Sees the research</label>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
