"use client";

import { Check, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteProofAction, draftProofsAction, renameObjectionAction, saveObjectionAnswerAction, saveProofAction, suggestObjectionAnswerAction, syncObjectionsAction,
} from "@/app/sales-actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { ObjectionRow } from "@/lib/sales/objections";
import type { Proof } from "@/lib/sales/proofs";

// ---------------------------------------------------------------- objections

function ObjectionItem({ o }: { o: ObjectionRow }) {
  const [answer, setAnswer] = useState(o.answer ?? "");
  const [label, setLabel] = useState(o.label);
  const [renaming, setRenaming] = useState(false);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const dirty = answer.trim() !== (o.answer ?? "").trim();
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => {
              const r = await renameObjectionAction(o.id, label);
              if (!r.ok) return toast(r.error, "error");
              setRenaming(false);
              router.refresh();
            }); }}>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" aria-label="Objection name" autoFocus />
              <Button type="submit" size="sm" variant="primary" disabled={busy}>Save</Button>
            </form>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-semibold">{o.label}
              <button type="button" className="rounded p-1 text-subtle hover:bg-muted hover:text-fg" aria-label="Rename (renaming onto another objection merges them)" title="Rename. Renaming onto an existing one merges them." onClick={() => setRenaming(true)}><Pencil className="h-3.5 w-3.5" /></button>
            </p>
          )}
          <p className="mt-0.5 text-xs text-subtle">Heard as: {o.examples.map((e) => `"${e}"`).join(", ")}</p>
        </div>
        <div className="text-right text-xs">
          <p className="tabular font-medium">{o.deals} deal{o.deals === 1 ? "" : "s"}</p>
          <p className="tabular text-subtle">{o.won} won · {o.lost} lost · {o.open} open{o.win_rate !== null ? ` · ${o.win_rate}% won` : ""}</p>
        </div>
      </div>
      <div className="mt-3">
        <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your best answer to this, in two to four sentences. Drafts and call briefs use it for deals that raise it." className="min-h-[70px]" aria-label={`Answer to ${o.label}`} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {o.answer_source === "ai" && !dirty ? <span className="rounded-md bg-p-butter px-1.5 py-0.5 text-xs font-medium text-p-butter-fg">Suggested: save it to make it yours</span> : null}
          {o.answer_source === "me" && !dirty ? <span className="inline-flex items-center gap-1 text-xs text-good"><Check className="h-3.5 w-3.5" /> Your answer</span> : null}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => {
            const r = await suggestObjectionAnswerAction(o.id);
            if (!r.ok) return toast(r.error, "error");
            setAnswer(r.answer);
            toast(o.won ? "Suggested from the deals you won" : "Suggested (no won deals with this yet)");
            router.refresh();
          })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Suggest</Button>
          <Button size="sm" variant="primary" disabled={busy || (!dirty && o.answer_source === "me")} onClick={() => start(async () => {
            const r = await saveObjectionAnswerAction(o.id, answer);
            if (!r.ok) return toast(r.error, "error");
            toast("Saved");
            router.refresh();
          })}>Save</Button>
        </div>
      </div>
    </li>
  );
}

export function ObjectionsSection({ rows, pending }: { rows: ObjectionRow[]; pending: number }) {
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div>
      {pending ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-[13px]">
          <span>{pending} new objection{pending === 1 ? "" : "s"} from your conversations not grouped yet (this happens daily on its own).</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
            const r = await syncObjectionsAction();
            if (!r.ok) return toast(r.error, "error");
            toast(`Grouped ${r.n}`);
            router.refresh();
          })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Group now</Button>
        </div>
      ) : null}
      {rows.length ? <ul className="space-y-2">{rows.map((o) => <ObjectionItem key={o.id} o={o} />)}</ul> : (
        <p className="text-[13px] text-subtle">No objections recorded yet. They are picked out of every conversation you log (chats, emails, call notes) and appear here.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- proof library

function ProofEditor({ p, onDone }: { p: Partial<Proof>; onDone: () => void }) {
  const [f, setF] = useState({ title: p.title ?? "", client: p.client ?? "", industry: p.industry ?? "", country: p.country ?? "", services: (p.services ?? []).join(", "), problem: p.problem ?? "", solution: p.solution ?? "", result: p.result ?? "", link: p.link ?? "", status: p.status ?? "draft" });
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-surface p-4 shadow-[var(--shadow-md)]">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Title"><Input value={f.title} onChange={set("title")} placeholder="Missed calls down from 30 a day to 2" autoFocus /></Field></div>
        <Field label="Client, as you may name them" hint="Leave a generic description if they would rather not be named, e.g. &quot;a Dubai freight forwarder&quot;."><Input value={f.client} onChange={set("client")} /></Field>
        <Field label="Services" hint="Comma separated. Matches the leads it is shown to."><Input value={f.services} onChange={set("services")} /></Field>
        <Field label="Industry"><Input value={f.industry} onChange={set("industry")} /></Field>
        <Field label="Country"><Input value={f.country} onChange={set("country")} /></Field>
        <div className="sm:col-span-2"><Field label="The problem before"><Textarea value={f.problem} onChange={set("problem")} className="min-h-[60px]" /></Field></div>
        <div className="sm:col-span-2"><Field label="What you built"><Textarea value={f.solution} onChange={set("solution")} className="min-h-[60px]" /></Field></div>
        <div className="sm:col-span-2"><Field label="The result" hint="Only real, measured results. Leave empty rather than guess."><Textarea value={f.result} onChange={set("result")} className="min-h-[50px]" /></Field></div>
        <Field label="Link (optional)" hint="A case study page, a demo video, a Loom."><Input value={f.link} onChange={set("link")} placeholder="https://" /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            <option value="draft">Draft (never used)</option>
            <option value="approved">Approved (drafts may cite it)</option>
            <option value="archived">Archived</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={busy || !f.title.trim()} onClick={() => start(async () => {
          const r = await saveProofAction({ id: p.id, ...f, services: f.services.split(","), status: f.status as Proof["status"] });
          if (!r.ok) return toast(r.error, "error");
          toast(f.status === "approved" ? "Approved: follow-ups can cite it now" : "Saved");
          onDone();
          router.refresh();
        })}>Save</Button>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<Proof["status"], string> = { draft: "bg-p-butter text-p-butter-fg", approved: "bg-p-mint text-p-mint-fg", archived: "bg-muted text-subtle" };

export function ProofSection({ rows, waiting }: { rows: Proof[]; waiting: number }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div className="space-y-2">
      {waiting ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-[13px]">
          <span>{waiting} delivered or paid deal{waiting === 1 ? " has" : "s have"} no case study yet (drafts are written daily on their own).</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
            const r = await draftProofsAction();
            if (!r.ok) return toast(r.error, "error");
            toast(`Drafted ${r.n}`);
            router.refresh();
          })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Draft now</Button>
        </div>
      ) : null}
      {rows.map((p) => editing === p.id ? <ProofEditor key={p.id} p={p} onDone={() => setEditing(null)} /> : (
        <div key={p.id} className={cn("rounded-lg border border-border bg-surface px-4 py-3", p.status === "archived" && "opacity-60")}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{p.title}<span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium capitalize", STATUS_TONE[p.status])}>{p.status}</span></p>
              <p className="mt-0.5 text-xs text-subtle">{[p.client, p.industry, p.country, p.services.join(", ")].filter(Boolean).join(" · ") || "No details yet"}{p.deal_title ? ` · from ${p.deal_title}` : ""}</p>
              <p className="mt-1.5 text-[13px]">
                {p.problem || p.solution ? <>{p.problem}{p.solution ? ` ${p.solution}` : ""}</> : <span className="text-subtle">The problem and what you built are not filled in yet.</span>}
                {p.result ? <b className="font-medium"> {p.result}</b> : <span className="text-warn"> No result recorded yet.</span>}
              </p>
            </div>
            <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(p.id)}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label="Delete" disabled={busy} onClick={() => confirm(`Delete "${p.title}"?`) && start(async () => {
              const r = await deleteProofAction(p.id);
              if (!r.ok) return toast(r.error, "error");
              router.refresh();
            })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      {editing === "new" ? <ProofEditor p={{}} onDone={() => setEditing(null)} /> : (
        <Button variant="outline" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add a case study</Button>
      )}
    </div>
  );
}
