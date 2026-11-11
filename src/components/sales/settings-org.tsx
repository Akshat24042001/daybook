"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveConfigAction, saveMemberAction, savePipelineAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { Pipeline, TeamMember } from "@/lib/sales/org";
import { DEFAULT_PLAYBOOK, playFor, type StagePlay } from "@/lib/sales/playbook-stages";
import type { Stage } from "@/lib/sales/stages";

// ---------------------------------------------------------------- pipelines

function PipelineForm({ p, stages, onDone }: { p: Partial<Pipeline>; stages: Stage[]; onDone: () => void }) {
  const [name, setName] = useState(p.name ?? "");
  const [ids, setIds] = useState<number[]>(p.stage_ids ?? []);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 p-3">
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Retainers" aria-label="Pipeline name" autoFocus /></Field>
      <div>
        <p className="mb-1 text-[13px] font-medium">Stages it shows <span className="font-normal text-subtle">· none ticked shows all</span></p>
        <div className="flex flex-wrap gap-1.5">
          {stages.map((s) => (
            <label key={s.id} className={cn("cursor-pointer rounded-md border px-2 py-1 text-xs", ids.includes(s.id) ? "border-accent bg-accent/10 text-accent" : "border-border")}>
              <input type="checkbox" className="sr-only" checked={ids.includes(s.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />{s.name}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-between gap-2">
        {p.id ? (
          <Button variant="ghost" size="sm" className={p.active ? "text-bad" : ""} disabled={busy} onClick={() => start(async () => {
            const r = await savePipelineAction({ id: p.id, name, stage_ids: ids, active: !p.active });
            if (!r.ok) return toast(r.error, "error");
            toast(p.active ? "Turned off: its deals moved to your first pipeline" : "Turned on");
            onDone();
            router.refresh();
          })}>{p.active ? "Turn off" : "Turn on"}</Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => start(async () => {
            const r = await savePipelineAction({ id: p.id, name, stage_ids: ids });
            if (!r.ok) return toast(r.error, "error");
            toast("Saved");
            onDone();
            router.refresh();
          })}>Save</Button>
        </div>
      </div>
    </div>
  );
}

export function PipelinesCard({ pipelines, stages }: { pipelines: Pipeline[]; stages: Stage[] }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {pipelines.map((p) => editing === p.id ? <li key={p.id}><PipelineForm p={p} stages={stages} onDone={() => setEditing(null)} /></li> : (
          <li key={p.id} className={cn("flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm", !p.active && "opacity-50")}>
            <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span>
              <span className="ml-2 text-xs text-subtle">{p.deals ?? 0} deals · {p.stage_ids.length ? stages.filter((s) => p.stage_ids.includes(s.id)).map((s) => s.name).join(", ") : "all stages"}{p.active ? "" : " · off"}</span>
            </span>
            <Button size="icon" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p.id)}><Pencil className="h-4 w-4" /></Button>
          </li>
        ))}
      </ul>
      {editing === "new" ? <PipelineForm p={{ active: true }} stages={stages} onDone={() => setEditing(null)} /> : <Button variant="outline" size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add a pipeline</Button>}
    </div>
  );
}

// ---------------------------------------------------------------- team

function MemberForm({ m, onDone }: { m: Partial<TeamMember>; onDone: () => void }) {
  const [f, setF] = useState({ name: m.name ?? "", email: m.email ?? "", phone: m.phone ?? "", role: m.role ?? "" });
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = (active?: boolean) => start(async () => {
    const r = await saveMemberAction({ id: m.id, ...f, active });
    if (!r.ok) return toast(r.error, "error");
    toast("Saved");
    onDone();
    router.refresh();
  });
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={set("name")} aria-label="Member name" autoFocus /></Field>
        <Field label="Role"><Input value={f.role} onChange={set("role")} placeholder="Sales, delivery, partner" /></Field>
        <Field label="Email"><Input value={f.email} onChange={set("email")} inputMode="email" /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
      </div>
      <div className="flex justify-between gap-2">
        {m.id ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => save(!m.active)}>{m.active ? "Mark as left" : "Bring back"}</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={onDone}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => save()}>Save</Button></div>
      </div>
    </div>
  );
}

export function TeamCard({ team }: { team: TeamMember[] }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {team.map((m) => editing === m.id ? <li key={m.id}><MemberForm m={m} onDone={() => setEditing(null)} /></li> : (
          <li key={m.id} className={cn("flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm", !m.active && "opacity-50")}>
            <span className="min-w-0 flex-1"><span className="font-medium">{m.name}</span><span className="ml-2 text-xs text-subtle">{[m.role, m.email, m.phone, `${m.deals ?? 0} deals`].filter(Boolean).join(" · ")}{m.active ? "" : " · left"}</span></span>
            <Button size="icon" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m.id)}><Pencil className="h-4 w-4" /></Button>
          </li>
        ))}
      </ul>
      {!team.length ? <p className="text-[13px] text-subtle">Just you for now.</p> : null}
      {editing === "new" ? <MemberForm m={{ active: true }} onDone={() => setEditing(null)} /> : <Button variant="outline" size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add a person</Button>}
      <p className="text-xs text-subtle">Members do not get their own login.</p>
    </div>
  );
}

// ---------------------------------------------------------------- stage playbooks

export function PlaybookEditor({ stages, mine }: { stages: Stage[]; mine: Record<string, StagePlay> }) {
  const keyOf = (s: Stage) => s.role ?? s.key ?? String(s.id);
  const [stage, setStage] = useState<string>(keyOf(stages.find((s) => s.role === "discovery") ?? stages[0]));
  const cur = stages.find((s) => keyOf(s) === stage)!;
  const play = playFor({ role: cur?.role ?? null, key: cur?.key }, mine);
  const [q, setQ] = useState(play.questions.join("\n"));
  const [c, setC] = useState(play.checklist.join("\n"));
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const pick = (k: string) => {
    const s = stages.find((x) => keyOf(x) === k)!;
    const p = playFor({ role: s.role ?? null, key: s.key }, mine);
    setStage(k);
    setQ(p.questions.join("\n"));
    setC(p.checklist.join("\n"));
  };
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 40);
  return (
    <div className="space-y-3">
      <Field label="Stage"><Select value={stage} onChange={(e) => pick(e.target.value)} aria-label="Playbook stage">{stages.map((s) => <option key={s.id} value={keyOf(s)}>{s.name}</option>)}</Select></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Questions to ask" hint="One per line. Shown on the deal and in its call script."><Textarea value={q} onChange={(e) => setQ(e.target.value)} className="min-h-[180px] text-xs" aria-label="Questions" /></Field>
        <Field label="Checklist" hint="One per line. Ticked per deal."><Textarea value={c} onChange={(e) => setC(e.target.value)} className="min-h-[180px] text-xs" aria-label="Checklist" /></Field>
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={!DEFAULT_PLAYBOOK[stage]} onClick={() => { const d = DEFAULT_PLAYBOOK[stage]; if (d) { setQ(d.questions.join("\n")); setC(d.checklist.join("\n")); } }}>Restore the default</Button>
        <Button variant="primary" disabled={busy} onClick={() => start(async () => {
          const r = await saveConfigAction({ playbook: { ...mine, [stage]: { questions: lines(q), checklist: lines(c) } } });
          if (!r.ok) return toast(r.error, "error");
          toast("Saved");
          router.refresh();
        })}>Save</Button>
      </div>
    </div>
  );
}

export function TaxCard({ value }: { value: number }) {
  const [v, setV] = useState(String(value));
  const [busy, start] = useTransition();
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="GST / tax % on new line items" hint="18% is the usual GST on IT services in India"><Input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" className="w-28" aria-label="Default GST %" /></Field>
      <Button variant="primary" disabled={busy} onClick={() => start(async () => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) return toast("A percentage from 0 to 100.", "error");
        const r = await saveConfigAction({ default_tax_pct: n });
        if (!r.ok) return toast(r.error, "error");
        toast("Saved");
      })}>Save</Button>
    </div>
  );
}
