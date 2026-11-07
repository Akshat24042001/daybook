"use client";

import { ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addBlockAction, deleteOfferAction, removeBlockAction, saveOfferAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { BlockKind, BlockRow } from "@/lib/sales/blocklist";
import type { Offer, Package } from "@/lib/sales/offers";

const money = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString("en-US")}`;
const total = (p: Package) => p.items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
const emptyPkg = (currency = "USD"): Package => ({ name: "Standard", currency, items: [{ name: "", description: "", qty: 1, unit_price: 0 }], scope: "", timeline: "" });

function OfferEditor({ offer, onDone }: { offer: Partial<Offer>; onDone: () => void }) {
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const [name, setName] = useState(offer.name ?? "");
  const [summary, setSummary] = useState(offer.summary ?? "");
  const [keywords, setKeywords] = useState((offer.keywords ?? []).join(", "));
  const [active, setActive] = useState(offer.active ?? true);
  const [pkgs, setPkgs] = useState<Package[]>(offer.packages?.length ? offer.packages : []);
  const setPkg = (i: number, p: Partial<Package>) => setPkgs((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setItem = (i: number, k: number, it: Partial<Package["items"][number]>) => setPkg(i, { items: pkgs[i].items.map((x, j) => (j === k ? { ...x, ...it } : x)) });

  return (
    <div className="space-y-4 rounded-xl border border-accent/40 bg-surface p-4 shadow-[var(--shadow-md)]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Offer name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="AI agents for operations" autoFocus /></Field>
        <Field label="Also known as" hint="Comma separated. Matches the services on your deals (for upsells and quotes)."><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="AI agents, automation, chatbots" /></Field>
        <div className="sm:col-span-2"><Field label="One line on what it does for them" hint="This is what drafts and the radar use to describe it. Outcome first."><Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Agents that answer, book and follow up on every enquiry, 24/7" /></Field></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (paused offers are not pitched or suggested)</label>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium">Packages <span className="font-normal text-subtle">· a quote can start from any of these</span></p>
          <Button size="sm" variant="outline" onClick={() => setPkgs((a) => [...a, emptyPkg(a[0]?.currency)])}><Plus className="h-3.5 w-3.5" /> Package</Button>
        </div>
        {!pkgs.length ? <p className="text-[13px] text-subtle">No packages yet. Add one to quote this offer in one tap.</p> : null}
        <div className="space-y-3">
          {pkgs.map((p, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_90px_1fr_auto]">
                <Input value={p.name} onChange={(e) => setPkg(i, { name: e.target.value })} placeholder="Package name" aria-label="Package name" />
                <Input value={p.currency} onChange={(e) => setPkg(i, { currency: e.target.value.toUpperCase().slice(0, 3) })} aria-label="Currency" />
                <Input value={p.timeline} onChange={(e) => setPkg(i, { timeline: e.target.value })} placeholder="Timeline, e.g. 3 weeks" aria-label="Timeline" />
                <Button size="icon" variant="ghost" aria-label="Remove package" onClick={() => setPkgs((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="mt-2 space-y-1.5">
                {p.items.map((it, k) => (
                  <div key={k} className="grid grid-cols-[64px_1fr_auto] gap-1.5 border-b border-border pb-1.5 last:border-0 sm:grid-cols-[1fr_1.2fr_60px_110px_auto] sm:border-0 sm:pb-0">
                    <Input value={it.name} onChange={(e) => setItem(i, k, { name: e.target.value })} placeholder="Line item" aria-label="Item" className="col-span-3 sm:col-span-1" />
                    <Input value={it.description} onChange={(e) => setItem(i, k, { description: e.target.value })} placeholder="Description" aria-label="Description" className="hidden sm:block" />
                    <Input value={String(it.qty)} onChange={(e) => setItem(i, k, { qty: Number(e.target.value) || 0 })} inputMode="decimal" aria-label="Quantity" />
                    <Input value={String(it.unit_price)} onChange={(e) => setItem(i, k, { unit_price: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} inputMode="decimal" aria-label="Unit price" />
                    <Button size="icon" variant="ghost" aria-label="Remove item" onClick={() => setPkg(i, { items: p.items.filter((_, j) => j !== k) })}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button size="sm" variant="ghost" onClick={() => setPkg(i, { items: [...p.items, { name: "", description: "", qty: 1, unit_price: 0 }] })}><Plus className="h-3.5 w-3.5" /> Line</Button>
                  <span className="tabular text-sm font-medium">{money(total(p), p.currency)}</span>
                </div>
              </div>
              <Textarea value={p.scope} onChange={(e) => setPkg(i, { scope: e.target.value })} placeholder="Scope: what is included and what is not" className="mt-2 min-h-[70px]" aria-label="Scope" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => start(async () => {
          const r = await saveOfferAction({ id: offer.id, name, summary, keywords: keywords.split(","), packages: pkgs, active });
          if (!r.ok) return toast(r.error, "error");
          toast("Offer saved");
          onDone();
          router.refresh();
        })}>Save offer</Button>
      </div>
    </div>
  );
}

export function OffersSection({ offers }: { offers: Offer[] }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div className="space-y-2">
      {offers.map((o) => editing === o.id ? <OfferEditor key={o.id} offer={o} onDone={() => setEditing(null)} /> : (
        <div key={o.id} className={cn("rounded-lg border border-border bg-surface", !o.active && "opacity-60")}>
          <div className="flex items-start gap-3 px-4 py-3">
            <button type="button" className={cn("min-w-0 flex-1 text-left", !o.packages.length && "cursor-default")} disabled={!o.packages.length}
              onClick={() => setOpen(open === o.id ? null : o.id)} aria-expanded={o.packages.length ? open === o.id : undefined}>
              <p className="flex items-center gap-2 text-sm font-medium">
                {o.name}
                {!o.active ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-subtle">Paused</span> : null}
                {o.packages.length ? <ChevronDown className={cn("h-4 w-4 text-subtle transition-transform", open === o.id && "rotate-180")} /> : null}
              </p>
              <p className="mt-0.5 text-[13px] text-subtle">{o.summary || "No one-line description yet: drafts describe it by name only."}</p>
              <p className="mt-1 text-xs text-subtle">{o.packages.length ? `${o.packages.length} package${o.packages.length === 1 ? "" : "s"}: ${o.packages.map((p) => `${p.name} ${money(total(p), p.currency)}`).join(" · ")}` : "No packages"}</p>
            </button>
            <Button size="icon" variant="ghost" aria-label={`Edit ${o.name}`} onClick={() => setEditing(o.id)}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Delete ${o.name}`} disabled={busy} onClick={() => confirm(`Delete "${o.name}" and its packages?`) && start(async () => {
              const r = await deleteOfferAction(o.id);
              if (!r.ok) return toast(r.error, "error");
              router.refresh();
            })}><Trash2 className="h-4 w-4" /></Button>
          </div>
          {open === o.id && o.packages.length ? (
            <div className="border-t border-border px-4 py-3">
              {o.packages.map((p, i) => (
                <div key={i} className="py-1.5 text-[13px]">
                  <p className="flex justify-between font-medium"><span>{p.name}{p.timeline ? <span className="font-normal text-subtle"> · {p.timeline}</span> : null}</span><span className="tabular">{money(total(p), p.currency)}</span></p>
                  <ul className="mt-0.5 text-subtle">{p.items.map((it, k) => <li key={k} className="flex justify-between"><span>{it.qty} × {it.name}</span><span className="tabular">{money(it.qty * it.unit_price, p.currency)}</span></li>)}</ul>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {editing === "new" ? <OfferEditor offer={{}} onDone={() => setEditing(null)} /> : (
        <Button variant="outline" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add an offer</Button>
      )}
    </div>
  );
}

const KIND_LABEL: Record<BlockKind, string> = { domain: "Website domain", email: "Email", phone: "Phone", company: "Company name", person: "Person (full name)" };

export function BlocklistSection({ rows }: { rows: BlockRow[] }) {
  const [kind, setKind] = useState<BlockKind>("domain");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div>
      <form className="grid gap-2 sm:grid-cols-[170px_1fr_1fr_auto]" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addBlockAction(kind, value, reason);
          if (!r.ok) return toast(r.error, "error");
          setValue(""); setReason("");
          toast("Added. Matching radar leads were dropped.");
          router.refresh();
        });
      }}>
        <Select value={kind} onChange={(e) => setKind(e.target.value as BlockKind)} aria-label="Kind">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "domain" ? "acme.com" : kind === "email" ? "name@acme.com" : kind === "phone" ? "+971 50 123 4567" : kind === "company" ? "Acme Freight" : "Priya Sharma"} aria-label="Value" />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (optional)" aria-label="Reason" />
        <Button type="submit" variant="primary" disabled={busy || !value.trim()}>Add</Button>
      </form>
      {rows.length ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {rows.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="w-32 shrink-0 text-subtle">{KIND_LABEL[b.kind]}</span>
              <span className="min-w-0 flex-1 truncate font-medium" title={b.raw && b.raw !== b.value ? `Matches: ${b.value}` : undefined}>{b.raw || b.value}</span>
              <span className="hidden min-w-0 flex-1 truncate text-subtle sm:block">{b.reason}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => {
                const r = await removeBlockAction(b.id);
                if (!r.ok) return toast(r.error, "error");
                router.refresh();
              })}>Remove</Button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-[13px] text-subtle">Nobody on the list.</p>}
    </div>
  );
}
