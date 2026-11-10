"use client";

import { Check, ListChecks, Minus, Phone, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPackageItemsAction, applyItemTotalsAction, deleteItemAction, saveItemAction, toggleChecklistAction, updateDealAction } from "@/app/sales-actions";
import { Button, Chip, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { DealCard } from "@/lib/sales/deals";
import type { Fit } from "@/lib/sales/fit-calc";
import { BILLINGS, itemTotals, lineAmounts, type DealItem } from "@/lib/sales/items-calc";
import type { StagePlay } from "@/lib/sales/playbook-stages";
import { money } from "./format";

function Card({ title, action, children, label }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; label: string }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label={label}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-base">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const GRADE_TONE: Record<string, string> = { A: "bg-p-mint text-p-mint-fg", B: "bg-p-sky text-p-sky-fg", C: "bg-p-butter text-p-butter-fg", D: "bg-muted text-subtle" };

// ---------------------------------------------------------------- fit and service hints

export function FitCard({ fit, deal }: { fit: Fit; deal: DealCard }) {
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <Card label="Fit" title={<span className="flex items-center gap-2">Fit <span className={cn("rounded-md px-2 py-0.5 text-sm font-semibold", GRADE_TONE[fit.grade])}>{fit.grade} · {fit.score}/100</span></span>}>
      <p className="text-xs text-subtle">How well they fit Aivaura's work: your target industries and countries, your results there, what they need against what you sell, size, money, who you are talking to, and how they came.</p>
      <ul className="mt-2 space-y-1 text-[13px]">
        {fit.plus.map((p) => <li key={p} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />{p}</li>)}
        {fit.minus.map((p) => <li key={p} className="flex gap-1.5 text-subtle"><Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" />{p}</li>)}
      </ul>
      {fit.hints.length ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 flex items-center gap-1 text-[13px] font-medium"><Sparkles className="h-3.5 w-3.5 text-accent" /> What they would likely buy</p>
          <ul className="space-y-2">
            {fit.hints.map((h) => {
              const on = (deal.services ?? []).some((s) => s.toLowerCase() === h.offer.toLowerCase());
              return (
                <li key={h.offer} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{h.offer}{h.already ? <Chip className="ml-1.5">already a client for this</Chip> : null}</p>
                    {!on ? (
                      <Button size="sm" variant="ghost" className="h-7 shrink-0" disabled={busy} onClick={() => start(async () => {
                        const r = await updateDealAction(deal.id, { services: [...(deal.services ?? []), h.offer] });
                        if (!r.ok) return toast(r.error, "error");
                        toast("Added to the deal's services");
                        router.refresh();
                      })}><Plus className="h-3.5 w-3.5" /> Add</Button>
                    ) : <span className="shrink-0 text-xs text-good">on the deal</span>}
                  </div>
                  <ul className="mt-1 list-disc pl-4 text-xs text-subtle">{h.why.map((w) => <li key={w}>{w}</li>)}</ul>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-subtle">Hints only come from what is on the record (their words, research, their industry) and point at your own offers.</p>
        </div>
      ) : <p className="mt-3 text-xs text-subtle">No service hints yet: add their industry, the requirement, or research the company.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- line items

export interface PackageOpt { offerId: number; index: number; label: string }

export function LineItems({ deal, items, defaultTax, packages }: { deal: DealCard; items: DealItem[]; defaultTax: number; packages: PackageOpt[] }) {
  const blank = { name: "", description: "", qty: "1", unit_price: "", discount_pct: "0", tax_pct: String(defaultTax), billing: "one_time" };
  const [f, setF] = useState<typeof blank & { id?: number }>(blank);
  const [open, setOpen] = useState(false);
  const [pkg, setPkg] = useState("");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const t = itemTotals(items);
  const cur = deal.currency;
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));
  const edit = (i?: DealItem) => {
    setF(i ? { id: i.id, name: i.name, description: i.description ?? "", qty: String(i.qty), unit_price: String(i.unit_price), discount_pct: String(i.discount_pct), tax_pct: String(i.tax_pct), billing: i.billing } : blank);
    setOpen(true);
  };
  const differs = (t.one_time.total > 0 && Math.round(t.one_time.total) !== Math.round(Number(deal.value_amount ?? 0))) || (t.monthly.total > 0 && Math.round(t.monthly.total) !== Math.round(Number(deal.recurring_amount ?? 0)));
  return (
    <Card label="Items" title={`Items${items.length ? ` · ${items.length}` : ""}`} action={<Button size="sm" variant="ghost" onClick={() => edit()}><Plus className="h-3.5 w-3.5" /> Item</Button>}>
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[13px]">
            <thead className="text-left text-xs text-subtle"><tr><th className="py-1 font-medium">Item</th><th className="py-1 text-right font-medium">Qty × price</th><th className="py-1 text-right font-medium">Disc.</th><th className="py-1 text-right font-medium">GST</th><th className="py-1 text-right font-medium">Total</th><th /></tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => {
                const a = lineAmounts(i);
                return (
                  <tr key={i.id} className="align-top">
                    <td className="py-1.5 pr-2"><button type="button" className="text-left hover:text-accent" onClick={() => edit(i)}>{i.name}</button>{i.billing !== "one_time" ? <Chip className="ml-1">{BILLINGS.find(([b]) => b === i.billing)?.[1]}</Chip> : null}{i.description ? <p className="text-xs text-subtle">{i.description}</p> : null}</td>
                    <td className="tabular py-1.5 text-right">{i.qty} × {money(i.unit_price, cur)}</td>
                    <td className="tabular py-1.5 text-right">{i.discount_pct ? `${i.discount_pct}%` : ""}</td>
                    <td className="tabular py-1.5 text-right">{i.tax_pct ? `${i.tax_pct}%` : ""}</td>
                    <td className="tabular py-1.5 text-right font-medium">{money(a.total, cur)}</td>
                    <td className="py-1.5 pl-1"><button type="button" aria-label={`Remove ${i.name}`} className="text-subtle/60 hover:text-bad" onClick={() => start(async () => {
                      const r = await deleteItemAction(deal.id, i.id);
                      if (!r.ok) return toast(r.error, "error");
                      router.refresh();
                    })}><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <dl className="mt-2 space-y-0.5 text-[13px]">
            {t.one_time.total > 0 ? <div className="flex justify-between"><dt className="text-subtle">One-time: {money(t.one_time.subtotal, cur)}{t.one_time.discount ? ` − ${money(t.one_time.discount, cur)} discount` : ""}{t.one_time.tax ? ` + ${money(t.one_time.tax, cur)} GST` : ""}</dt><dd className="tabular font-semibold">{money(t.one_time.total, cur)}</dd></div> : null}
            {t.monthly.total > 0 ? <div className="flex justify-between"><dt className="text-subtle">Recurring, per month (incl. GST)</dt><dd className="tabular font-semibold">{money(t.monthly.total, cur)}/mo</dd></div> : null}
          </dl>
          {differs ? (
            <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => start(async () => {
              const r = await applyItemTotalsAction(deal.id);
              if (!r.ok) return toast(r.error, "error");
              toast("Deal value updated from the items");
              router.refresh();
            })}>Use these totals as the deal value</Button>
          ) : null}
        </div>
      ) : <p className="text-[13px] text-subtle">What the deal is made of: each item with quantity, price, discount and GST, one-time or recurring. The totals can set the deal value.</p>}
      {packages.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Add a package" className="h-8 w-64 text-xs">
            <option value="">Add the lines of a package…</option>
            {packages.map((p) => <option key={`${p.offerId}:${p.index}`} value={`${p.offerId}:${p.index}`}>{p.label}</option>)}
          </Select>
          <Button size="sm" variant="ghost" disabled={!pkg || busy} onClick={() => start(async () => {
            const [o, i] = pkg.split(":").map(Number);
            const r = await addPackageItemsAction(deal.id, o, i);
            if (!r.ok) return toast(r.error, "error");
            toast(`Added ${r.n} line${r.n === 1 ? "" : "s"}`);
            setPkg("");
            router.refresh();
          })}>Add</Button>
        </div>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen} title={f.id ? "Edit item" : "Add an item"}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Item"><Input value={f.name} onChange={set("name")} placeholder="WhatsApp booking bot" aria-label="Item name" autoFocus /></Field></div>
          <div className="sm:col-span-2"><Field label="Description (optional)"><Textarea value={f.description} onChange={set("description")} className="min-h-[50px]" /></Field></div>
          <Field label="Quantity"><Input value={f.qty} onChange={set("qty")} inputMode="decimal" aria-label="Quantity" /></Field>
          <Field label={`Price per unit (${cur})`}><Input value={f.unit_price} onChange={set("unit_price")} inputMode="decimal" aria-label="Price per unit" /></Field>
          <Field label="Discount %"><Input value={f.discount_pct} onChange={set("discount_pct")} inputMode="decimal" aria-label="Discount %" /></Field>
          <Field label="GST / tax %" hint="18% is the usual GST on IT services"><Input value={f.tax_pct} onChange={set("tax_pct")} inputMode="decimal" aria-label="GST %" /></Field>
          <Field label="Billed"><Select value={f.billing} onChange={set("billing")} aria-label="Billed">{BILLINGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => start(async () => {
            const r = await saveItemAction(deal.id, { ...f });
            if (!r.ok) return toast(r.error, "error");
            setOpen(false);
            router.refresh();
          })}>Save</Button>
        </div>
      </Sheet>
    </Card>
  );
}

// ---------------------------------------------------------------- stage playbook and call script

export function PlaybookCard({ deal, stageKey, play, ticked, objections, owner }: {
  deal: DealCard; stageKey: string; play: StagePlay; ticked: string[]; objections: { label: string; answer: string }[]; owner: { name: string; company: string };
}) {
  const [busy, start] = useTransition();
  const [script, setScript] = useState(false);
  // ticks show at once; a failed save puts them back
  const [mine, setMine] = useState<string[]>(ticked);
  const { toast } = useToast();
  const router = useRouter();
  if (!play.questions.length && !play.checklist.length) return null;
  const done = play.checklist.filter((c) => mine.includes(c)).length;
  const first = (deal.person_name ?? "").split(" ")[0] || "there";
  const about = (deal.pain || deal.requirements || deal.title || "").split("\n")[0].slice(0, 140);
  return (
    <Card label="Stage playbook" title={<span className="flex items-center gap-1.5"><ListChecks className="h-4 w-4 text-accent" /> Playbook: {deal.stage_name}</span>}
      action={<Button size="sm" variant="ghost" onClick={() => setScript(true)}><Phone className="h-3.5 w-3.5" /> Call script</Button>}>
      {play.checklist.length ? (
        <>
          <p className="mb-1 text-xs text-subtle">{done} of {play.checklist.length} done</p>
          <ul className="space-y-1">
            {play.checklist.map((c) => {
              const on = mine.includes(c);
              return (
                <li key={c}>
                  <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                    <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => {
                      const want = e.target.checked;
                      setMine((m) => (want ? [...m, c] : m.filter((x) => x !== c)));
                      start(async () => {
                        const r = await toggleChecklistAction(deal.id, stageKey, c, want);
                        if (!r.ok) {
                          setMine((m) => (want ? m.filter((x) => x !== c) : [...m, c]));
                          return toast(r.error, "error");
                        }
                        router.refresh();
                      });
                    }} />
                    <span className={cn(on && "text-subtle line-through")}>{c}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {play.questions.length ? (
        <div className="mt-3">
          <p className="mb-1 text-[13px] font-medium">Questions to ask</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-[13px]">{play.questions.map((q) => <li key={q}>{q}</li>)}</ol>
        </div>
      ) : null}
      <Sheet open={script} onOpenChange={setScript} title={`Call script: ${deal.title}`} description="A guide, not a script to read. Listen more than you talk." wide>
        <div className="space-y-4 text-sm">
          <section>
            <p className="font-medium">1. Open and agree the purpose</p>
            <p className="mt-1 rounded-lg bg-muted p-2.5">Hi {first}, this is {owner.name.split(" ")[0]} from {owner.company}. Thanks for making the time. {about ? <>I would like to understand {about.toLowerCase().startsWith("the ") ? about : `more about ${about}`}, </> : "I would like to understand where things stand, "}and if it looks like a fit, agree what happens next. If it is not a fit, I will say so. Does that work?</p>
          </section>
          <section>
            <p className="font-medium">2. Ask, then listen</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">{(play.questions.length ? play.questions : ["What made you look into this now?", "How are you handling it today?"]).map((q) => <li key={q}>{q}</li>)}</ol>
          </section>
          {objections.length ? (
            <section>
              <p className="font-medium">3. If they say…</p>
              <ul className="mt-1 space-y-2">{objections.map((o) => <li key={o.label}><p className="text-xs font-medium text-subtle">"{o.label}"</p><p>{o.answer}</p></li>)}</ul>
              <p className="mt-1 text-xs text-subtle">Your answers from Playbook &gt; Objections.</p>
            </section>
          ) : null}
          <section>
            <p className="font-medium">{objections.length ? "4" : "3"}. Close with a next step</p>
            <p className="mt-1 rounded-lg bg-muted p-2.5">Here is what I suggest as the next step: [the step, e.g. a proposal by Thursday, a demo with your partner]. Can we put {deal.stage_role === "proposal" || deal.stage_role === "negotiation" ? "the decision" : "the next call"} in the calendar now?</p>
          </section>
          <p className="text-xs text-subtle">After the call, use Log an activity to record what was discussed and the next step.</p>
        </div>
      </Sheet>
    </Card>
  );
}
