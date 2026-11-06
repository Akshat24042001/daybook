"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { moveStageAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { DealCard } from "@/lib/sales/deals";
import type { Stage, Transition } from "@/lib/sales/stages";
import { ago, ChannelIcon, Heat, money } from "./util";

export interface PendingMove {
  deal: { id: number; title: string; stage_id: number };
  to: Stage;
  requires: string;
}

/** The guard dialog for a stage move that needs a reason, a date or a quote. */
export function StageMoveSheet({ pending, onDone }: { pending: PendingMove | null; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  if (!pending) return null;
  const req = pending.requires;
  const submit = (force = false) =>
    start(async () => {
      const r = await moveStageAction(pending.deal.id, pending.to.id, { reason, date, note, force });
      if (!r.ok) return toast(r.error, "error");
      toast(`Moved to ${pending.to.name}`);
      setReason("");
      setDate("");
      setNote("");
      onDone();
      router.refresh();
    });
  return (
    <Sheet open onOpenChange={(o) => !o && onDone()} title={`Move to ${pending.to.name}`} description={pending.deal.title}>
      <div className="space-y-3">
        {req === "reason" || pending.to.category === "lost" ? (
          <Field label="Reason (required)">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Pick one…</option>
              {["Price too high", "Chose a competitor", "No budget", "Timing: not now", "No response", "Went in-house", "Not a fit", "Scope too small", "Backed out after yes", "Other"].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
        ) : null}
        {req === "date" || ["parked"].includes(pending.to.category) ? (
          <Field label="Revisit on (required)">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        ) : null}
        <Field label={req === "quote" ? "No quote sent from Daybook: say how you sent it" : "Note (optional)"} hint={req === "quote" ? "e.g. PDF sent on email on 6 Nov" : undefined}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => submit(false)}>Move</Button>
        </div>
      </div>
    </Sheet>
  );
}

export function PipelineBoard({ stages, deals, transitions }: { stages: Stage[]; deals: DealCard[]; transitions: Transition[] }) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"open" | "won" | "parked" | "lost" | "all">("open");
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const cols = stages.filter((s) => show === "all" || s.category === show);
  const filtered = useMemo(() => {
    const qy = query.trim().toLowerCase();
    return qy ? deals.filter((d) => [d.title, d.person_name, d.company_name, d.source, d.country].some((x) => x?.toLowerCase().includes(qy))) : deals;
  }, [deals, query]);

  const move = (d: DealCard, toId: number) => {
    const t = transitions.find((x) => x.from_stage === d.stage_id && x.to_stage === toId);
    const to = stages.find((s) => s.id === toId)!;
    if (!t) return toast(`${d.stage_name} cannot go to ${to.name}. Change the flow in Sales settings.`, "error");
    if (t.requires !== "none" || to.category === "lost" || to.category === "parked") return setPending({ deal: d, to, requires: t.requires });
    start(async () => {
      const r = await moveStageAction(d.id, toId);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search deals, people, companies" className="h-9 max-w-xs text-sm" />
        {(["open", "won", "parked", "lost", "all"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setShow(k)} className={cn("rounded-full border px-3 py-1 text-xs capitalize", show === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>
            {k}
          </button>
        ))}
        {busy ? <span className="text-xs text-subtle">Saving…</span> : null}
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {cols.map((s) => {
          const list = filtered.filter((d) => d.stage_id === s.id);
          const total = list.reduce((sum, d) => sum + Number(d.value_usd ?? 0), 0);
          return (
            <section key={s.id} className="w-72 shrink-0">
              <header className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                  <span className="font-normal text-subtle">{list.length}</span>
                </h2>
                <span className="text-xs tabular text-subtle">{total ? money(total) : ""}</span>
              </header>
              <ul className="space-y-2">
                {list.map((d) => {
                  const targets = transitions.filter((t) => t.from_stage === d.stage_id).map((t) => stages.find((x) => x.id === t.to_stage)).filter((x): x is Stage => !!x && x.active);
                  const days = Math.floor((Date.now() - new Date(d.stage_changed_at).getTime()) / 86_400_000);
                  const stuck = s.sla_days && days > s.sla_days;
                  return (
                    <li key={d.id} className="rounded-xl border border-border bg-surface p-2.5 shadow-[var(--shadow-sm)]">
                      <Link href={`/sales/deal/${d.id}`} className="block">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold leading-snug hover:text-accent">{d.title}</p>
                          <Heat value={d.heat} />
                        </div>
                        {d.person_name ? <p className="truncate text-xs text-subtle">{d.person_name}{d.company_name && d.company_name !== d.title ? ` · ${d.company_name}` : ""}</p> : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle">
                          {d.value_amount ? <span className="font-medium text-fg">{money(d.value_amount, d.currency)}</span> : null}
                          {d.last_channel ? <span className="inline-flex items-center gap-1"><ChannelIcon channel={d.last_channel} className="h-3 w-3" />{ago(d.last_touch_at)}</span> : <span>no touch yet</span>}
                          <span className={cn(stuck && "font-semibold text-bad")}>{days}d here</span>
                          {d.open_moves ? <span className="text-accent">{d.open_moves} move{d.open_moves > 1 ? "s" : ""}</span> : null}
                          {d.referrer_name ? <span>via {d.referrer_name}</span> : null}
                        </div>
                        {d.next_action ? <p className="mt-1 line-clamp-2 text-[11px]">➡ {d.next_action}</p> : null}
                      </Link>
                      {targets.length ? (
                        <Select value="" onChange={(e) => e.target.value && move(d, Number(e.target.value))} aria-label="Move to stage" className="mt-2 h-7 text-[11px]">
                          <option value="">Move to…</option>
                          {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                      ) : null}
                    </li>
                  );
                })}
                {!list.length ? <li className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-subtle">Empty</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
      <StageMoveSheet pending={pending} onDone={() => setPending(null)} />
    </div>
  );
}
