"use client";

import { Copy, ExternalLink, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteDocAction, markDocSentAction, newRevisionAction, saveBriefAction, saveRevisionAction } from "@/app/sales-actions";
import { Button, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { DocRow, PaymentStep, QuoteItem, RevisionRow } from "@/lib/sales/docs";
import { ago, CURRENCIES, fmtDate, money } from "./util";

export interface ViewRow { id: number; rev: number | null; viewed_at: string; country: string | null; city: string | null; device: string | null; seconds: number; visitor: string | null }

export function DocEditor({ doc, revs, views, url, dealTitle }: { doc: DocRow; revs: RevisionRow[]; views: ViewRow[]; url: string; dealTitle: string | null }) {
  const cur = revs.find((r) => r.rev === doc.current_rev) ?? null;
  const locked = !!cur?.sent_at;
  const [title, setTitle] = useState(doc.title);
  const [r, setR] = useState<Partial<RevisionRow>>(cur ?? {});
  const [body, setBody] = useState(doc.body ?? "");
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const items = (r.items ?? []) as QuoteItem[];
  const plan = (r.payment_plan ?? []) as PaymentStep[];
  const setItem = (i: number, patch: Partial<QuoteItem>) => setR({ ...r, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const setStep = (i: number, patch: Partial<PaymentStep>) => setR({ ...r, payment_plan: plan.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const sub = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
  const total = Math.max(0, sub - (Number(r.discount) || 0)) * (1 + (Number(r.tax_pct) || 0) / 100);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg?: string) => start(async () => {
    const res = await fn();
    if (!res.ok) return toast((res as { error: string }).error, "error");
    if (msg) toast(msg);
    router.refresh();
  });
  const totalSeconds = views.reduce((s, v) => s + v.seconds, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{doc.kind}{doc.kind === "quote" ? ` · v${doc.current_rev}` : ""}</p>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">{doc.title}</h1>
          {dealTitle && doc.deal_id ? <Link href={`/sales/deal/${doc.deal_id}`} className="text-sm text-accent hover:underline">{dealTitle}</Link> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{doc.status}</Chip>
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(url).then(() => toast("Link copied"), () => toast("Your browser blocked copying. Select the text and copy it by hand.", "error"))}><Copy className="h-3.5 w-3.5" /> Copy link</Button>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-xl px-3 text-xs text-accent hover:bg-muted">Preview <ExternalLink className="h-3 w-3" /></a>
          {!doc.sent_at || (doc.kind === "quote" && !locked) ? (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act(async () => {
              if (doc.kind === "quote" && !locked) {
                const s = await saveRevisionAction(doc.id, r, title);
                if (!s.ok) return s;
              }
              return markDocSentAction(doc.id);
            }, "Marked as sent. Copy the link and send it.")}><Send className="h-3.5 w-3.5" /> Mark as sent</Button>
          ) : null}
        </div>
      </div>
      <p className="rounded-xl bg-accent-muted px-3 py-2 text-xs text-accent">Send this link instead of a PDF: <b>{url}</b>. No password for them. You get a Telegram ping on every fresh open{doc.kind === "quote" ? ", and they can accept it right on the page" : ""}.</p>

      {doc.kind === "quote" && cur ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            {locked ? (
              <div className="rounded-xl border border-warn/40 bg-warn-muted p-3 text-sm text-warn">
                v{cur.rev} was sent {ago(cur.sent_at)} and is locked so the client's history stays honest. Make a new revision to change it.
                <div className="mt-2 flex gap-2">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changes (e.g. reduced scope, 10% off)" className="h-9 text-sm" />
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => newRevisionAction(doc.id, note), "New revision ready to edit")}><Plus className="h-3.5 w-3.5" /> New revision</Button>
                </div>
              </div>
            ) : null}
            <fieldset disabled={locked} className="space-y-3 disabled:opacity-70">
              <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Opening line"><Textarea value={r.intro ?? ""} onChange={(e) => setR({ ...r, intro: e.target.value })} className="min-h-[60px]" /></Field>
              <Field label="Scope (markdown: - bullets, **bold**)"><Textarea value={r.scope ?? ""} onChange={(e) => setR({ ...r, scope: e.target.value })} className="min-h-[120px]" /></Field>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Line items</p>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={i} className="grid grid-cols-[1fr_64px_110px_32px] gap-1.5">
                      <div className="space-y-1">
                        <Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Item" className="h-9 text-sm" />
                        <Input value={it.description ?? ""} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="What is included" className="h-8 text-xs" />
                      </div>
                      <Input value={String(it.qty)} onChange={(e) => setItem(i, { qty: Number(e.target.value) || 0 })} inputMode="decimal" className="h-9 text-sm" aria-label="Quantity" />
                      <Input value={String(it.unit_price)} onChange={(e) => setItem(i, { unit_price: Number(e.target.value) || 0 })} inputMode="decimal" className="h-9 text-sm" aria-label="Price" />
                      <button type="button" aria-label="Remove item" onClick={() => setR({ ...r, items: items.filter((_, j) => j !== i) })} className="h-9 text-subtle hover:text-bad"><Trash2 className="mx-auto h-4 w-4" /></button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setR({ ...r, items: [...items, { name: "", description: "", qty: 1, unit_price: 0 }] })}><Plus className="h-3.5 w-3.5" /> Item</Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Currency"><Select value={r.currency ?? "INR"} onChange={(e) => setR({ ...r, currency: e.target.value })}>{[...new Set([...CURRENCIES, r.currency ?? "INR"])].map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label="Discount"><Input value={String(r.discount ?? 0)} onChange={(e) => setR({ ...r, discount: Number(e.target.value) || 0 })} inputMode="decimal" /></Field>
                <Field label="Tax %"><Input value={String(r.tax_pct ?? 0)} onChange={(e) => setR({ ...r, tax_pct: Number(e.target.value) || 0 })} inputMode="decimal" /></Field>
              </div>
              <p className="text-right font-display text-xl tabular">Total {money(total, r.currency ?? "INR")}</p>
              <Field label="Timeline"><Textarea value={r.timeline ?? ""} onChange={(e) => setR({ ...r, timeline: e.target.value })} className="min-h-[60px]" /></Field>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Payment plan (must add to 100%)</p>
                {plan.map((p, i) => (
                  <div key={i} className="mb-1.5 grid grid-cols-[1fr_70px_1fr_32px] gap-1.5">
                    <Input value={p.label} onChange={(e) => setStep(i, { label: e.target.value })} className="h-9 text-sm" />
                    <Input value={String(p.percent)} onChange={(e) => setStep(i, { percent: Number(e.target.value) || 0 })} inputMode="decimal" className="h-9 text-sm" aria-label="Percent" />
                    <Input value={p.when} onChange={(e) => setStep(i, { when: e.target.value })} placeholder="on acceptance / on delivery / 30 days" className="h-9 text-sm" />
                    <button type="button" aria-label="Remove step" onClick={() => setR({ ...r, payment_plan: plan.filter((_, j) => j !== i) })} className="text-subtle hover:text-bad"><Trash2 className="mx-auto h-4 w-4" /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setR({ ...r, payment_plan: [...plan, { label: "Milestone", percent: 0, when: "on delivery" }] })}><Plus className="h-3.5 w-3.5" /> Step</Button>
              </div>
              <Field label="Terms"><Textarea value={r.terms ?? ""} onChange={(e) => setR({ ...r, terms: e.target.value })} className="min-h-[80px]" /></Field>
              <Field label="Valid for (days)"><Input value={String(r.validity_days ?? 14)} onChange={(e) => setR({ ...r, validity_days: Number(e.target.value) || 14 })} inputMode="numeric" /></Field>
              {cur.rev > 1 ? <Field label="What changed in this revision (shown to the client)"><Input value={r.change_note ?? ""} onChange={(e) => setR({ ...r, change_note: e.target.value })} /></Field> : null}
              <div className="flex justify-end"><Button variant="outline" disabled={busy || locked} onClick={() => act(() => saveRevisionAction(doc.id, r, title), "Saved")}>Save draft</Button></div>
            </fieldset>
          </div>
          <div className="space-y-4">
            <Views views={views} totalSeconds={totalSeconds} />
            <section className="rounded-2xl border border-border bg-surface p-4">
              <h3 className="mb-2 font-display text-base">Revisions</h3>
              <ul className="space-y-1.5 text-sm">
                {revs.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2">
                    <a href={`${url}?rev=${v.rev}`} target="_blank" rel="noreferrer" className="hover:text-accent">v{v.rev} · {money(v.total, v.currency)}{v.change_note ? <span className="text-xs text-subtle"> · {v.change_note}</span> : null}</a>
                    <span className="text-xs text-subtle">{v.sent_at ? `sent ${ago(v.sent_at)}` : "draft"}</span>
                  </li>
                ))}
              </ul>
              {doc.accepted_at ? <p className="mt-2 rounded-lg bg-good-muted px-2 py-1 text-xs text-good">Accepted by {doc.accepted_by} {ago(doc.accepted_at)}</p> : null}
              {doc.client_note ? <p className="mt-2 rounded-lg bg-warn-muted px-2 py-1 text-xs text-warn">Change request: {doc.client_note}</p> : null}
            </section>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            {doc.kind === "brief" || doc.kind === "file" ? (
              <Field label={doc.kind === "brief" ? "Brief (markdown)" : "Note shown above the download"}><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[320px] font-mono text-xs" /></Field>
            ) : <p className="text-sm">Forwards to <a href={doc.target_url ?? "#"} target="_blank" rel="noreferrer" className="text-accent">{doc.target_url}</a></p>}
            {doc.kind === "file" ? <p className="text-xs text-subtle">File: {doc.file_name}</p> : null}
            <div className="flex justify-between">
              <Button variant="danger" size="sm" onClick={() => confirm("Delete this document? The link stops working.") && act(async () => {
                const res = await deleteDocAction(doc.id);
                if (res.ok) router.push("/sales/docs");
                return res;
              })}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
              <Button variant="outline" disabled={busy} onClick={() => act(() => saveBriefAction(doc.id, title, body), "Saved")}>Save</Button>
            </div>
          </div>
          <Views views={views} totalSeconds={totalSeconds} />
        </div>
      )}
    </div>
  );
}

function Views({ views, totalSeconds }: { views: ViewRow[]; totalSeconds: number }) {
  const visitors = new Set(views.map((v) => v.visitor)).size;
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="font-display text-base">Opens</h3>
      <p className="mb-2 text-xs text-subtle">{views.length} opens · {visitors} device{visitors === 1 ? "" : "s"} · {Math.round(totalSeconds / 60)} min reading</p>
      {views.length ? (
        <ul className="space-y-1 text-xs">
          {views.map((v) => (
            <li key={v.id} className="flex justify-between gap-2"><span>{fmtDate(v.viewed_at)}{v.rev ? ` · v${v.rev}` : ""}</span><span className="text-subtle">{[v.city, v.country].filter(Boolean).join(", ")} · {v.device} · {v.seconds}s</span></li>
          ))}
        </ul>
      ) : <p className="text-sm text-subtle">Not opened yet. Your own visits never count.</p>}
    </section>
  );
}
