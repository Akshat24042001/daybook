"use client";

import { ArrowDownLeft, ArrowUpRight, ChevronDown, CornerUpLeft, FileText, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { closeDealAction, editInteractionAction, logActivityAction, setEventNoteAction, updateDealAction } from "@/app/sales-actions";
import { Button, Chip, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { DealCard, InteractionRow } from "@/lib/sales/deals";
import {
  ACTIVITY_TYPES, closeKind, DEAL_FIELD, dealFieldsWith, DEAL_TYPES, FIELD_GROUPS, OUTCOMES, qualification, SOURCES,
  type FieldDef, type Reasons,
} from "@/lib/sales/fields";
import type { Stage } from "@/lib/sales/stages";
import { CURRENCIES, currencyLabel, currencySymbol, money } from "./format";
import { ChannelIcon, CHANNEL_LABEL } from "./util";

export interface PersonOpt { id: number; full_name: string; title?: string | null }

export interface PendingMove {
  deal: DealCard;
  to: Stage;
  requires: string;
}

// ---------------------------------------------------------------- time helpers

/** "8 Nov 2026, 3:42 pm" in the viewer's time zone. */
export function fmtWhen(d: string | Date | null | undefined, withTime = true): string {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return x.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}

/** "3d 4h", "5h 10m", "12m". */
export function fmtSpan(ms: number): string {
  if (!(ms > 0)) return "under a minute";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d}d${h ? ` ${h}h` : ""}`;
  if (h) return `${h}h${mm ? ` ${mm}m` : ""}`;
  return mm ? `${mm}m` : "under a minute";
}

/** A value for <input type="datetime-local"> in the viewer's own clock. */
export function localInput(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------- the move sheet (closing checklists)


/**
 * Every move that needs details: the Won checklist, why it was lost or disqualified, why it is parked and until when,
 * why it was reopened, or a note. complete = true fills in a won deal's record without moving it.
 */
export function StageMoveSheet({
  pending, onDone, onCancel, reasons, people = [], wonFields = [], complete,
}: {
  pending: PendingMove | null;
  onDone: () => void;
  onCancel?: () => void;
  reasons: Reasons;
  people?: PersonOpt[];
  wonFields?: FieldDef[];
  complete?: boolean;
}) {
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const deal = pending?.deal;
  const init = () => ({
    reason: complete ? deal?.won_reason ?? "" : "", note: "", date: "",
    poc: String(deal?.poc_id ?? deal?.person_id ?? (people[0]?.id ?? "new")), pocName: "", pocPhone: "", pocEmail: "", pocTitle: "",
    amount: deal?.value_amount ? String(deal.value_amount) : "", currency: deal?.currency ?? "INR",
    start_date: deal?.start_date ? String(deal.start_date).slice(0, 10) : "", delivery_date: deal?.delivery_date ? String(deal.delivery_date).slice(0, 10) : "",
    delivery_duration: deal?.delivery_duration ?? "", scope: deal?.scope ?? deal?.requirements ?? "", payment_terms: deal?.payment_terms ?? "", advance_pct: "",
    contract_ref: deal?.contract_ref ?? "", won_detail: deal?.won_detail ?? "", competitors: (deal?.competitors ?? []).join(", "),
    lost_to: "", lost_detail: "", lessons: "",
  });
  const [f, setF] = useState(init);
  const [custom, setCustom] = useState<Record<string, unknown>>(() => ({ ...(deal?.custom ?? {}) }));
  const [lastId, setLastId] = useState<string>("");
  const key = pending ? `${pending.deal.id}:${pending.to.id}:${complete ? 1 : 0}` : "";
  if (key && key !== lastId) {
    setLastId(key);
    setF(init());
    setCustom({ ...(pending!.deal.custom ?? {}) });
  }
  if (!pending || !deal) return null;
  const kind = complete ? "won" : closeKind({ category: deal.stage_category }, pending.to);
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));
  const cancel = () => (onCancel ?? onDone)();
  const pocOptions: PersonOpt[] = [...people];
  if (deal.person_id && deal.person_name && !pocOptions.some((p) => p.id === deal.person_id)) pocOptions.unshift({ id: deal.person_id, full_name: deal.person_name });

  const submit = () =>
    start(async () => {
      const r = await closeDealAction(deal.id, complete ? null : pending.to.id, {
        reason: f.reason || null, note: f.note || null, date: f.date || null,
        poc_id: f.poc !== "new" ? Number(f.poc) : null,
        poc_new: f.poc === "new" ? { name: f.pocName, phone: f.pocPhone, email: f.pocEmail, title: f.pocTitle } : null,
        final_amount: f.amount, currency: f.currency, start_date: f.start_date || null, delivery_date: f.delivery_date || null,
        delivery_duration: f.delivery_duration || null, scope: f.scope, payment_terms: f.payment_terms || null, advance_pct: f.advance_pct || null,
        contract_ref: f.contract_ref || null, won_detail: f.won_detail || null, competitors: f.competitors || null,
        custom: wonFields.length ? Object.fromEntries(wonFields.map((w) => [w.key.replace(/^custom\./, ""), custom[w.key.replace(/^custom\./, "")] ?? null])) : null,
        lost_to: f.lost_to || null, lost_detail: f.lost_detail || null, lessons: f.lessons || null,
      }, !!complete);
      if (!r.ok) return toast(r.error, "error");
      toast(complete ? "Closing record saved" : `Moved to ${pending.to.name}`);
      onDone();
      router.refresh();
    });

  const reasonList = kind === "won" ? reasons.won : kind === "lost" ? reasons.lost : kind === "disqualified" ? reasons.disqualified : kind === "parked" ? reasons.parked : kind === "reopen" ? reasons.reopened : [];
  const title = complete ? "Complete the closing record" : kind === "won" ? `Close as won: ${pending.to.name}` : `Move to ${pending.to.name}`;
  const desc = kind === "won" ? "Everything you will want in writing once the work starts. Fields marked * are needed." : deal.title;

  return (
    <Sheet open onOpenChange={(o) => !o && cancel()} title={title} description={desc} wide={kind === "won"}>
      <div className="space-y-3">
        {kind === "won" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Point of contact *" hint="Who you work with day to day">
                <Select value={f.poc} onChange={set("poc")} aria-label="Point of contact">
                  {pocOptions.map((p) => <option key={p.id} value={String(p.id)}>{p.full_name}{p.title ? `, ${p.title}` : ""}</option>)}
                  <option value="new">Someone new…</option>
                </Select>
              </Field>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Field label={`Final amount * (${currencySymbol(f.currency)})`}><Input value={f.amount} onChange={set("amount")} inputMode="decimal" aria-label="Final amount" /></Field>
                <Field label="Currency"><Select value={f.currency} onChange={set("currency")} aria-label="Currency">{[...new Set([...CURRENCIES, f.currency])].map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}</Select></Field>
              </div>
              {f.poc === "new" ? (
                <div className="grid gap-2 rounded-lg border border-border p-3 sm:col-span-2 sm:grid-cols-2">
                  <Field label="Name *"><Input value={f.pocName} onChange={set("pocName")} aria-label="Contact name" /></Field>
                  <Field label="Role / designation"><Input value={f.pocTitle} onChange={set("pocTitle")} placeholder="Operations head" /></Field>
                  <Field label="Phone / WhatsApp"><Input value={f.pocPhone} onChange={set("pocPhone")} inputMode="tel" /></Field>
                  <Field label="Email"><Input value={f.pocEmail} onChange={set("pocEmail")} inputMode="email" /></Field>
                </div>
              ) : null}
              <Field label="Start date"><Input type="date" value={f.start_date} onChange={set("start_date")} aria-label="Start date" /></Field>
              <Field label="Delivery date *" hint="Or the delivery time on the right"><Input type="date" value={f.delivery_date} onChange={set("delivery_date")} aria-label="Delivery date" /></Field>
              <Field label="Delivery time" hint="e.g. 6 weeks, 3 phases"><Input value={f.delivery_duration} onChange={set("delivery_duration")} aria-label="Delivery time" /></Field>
              <Field label="Contract / PO number"><Input value={f.contract_ref} onChange={set("contract_ref")} /></Field>
              <div className="sm:col-span-2"><Field label="Scope of work *" hint="Exactly what is included, and what is not. Prefilled from the requirement."><Textarea value={f.scope} onChange={set("scope")} className="min-h-[110px]" aria-label="Scope of work" /></Field></div>
              <Field label="Payment terms" hint="e.g. 50% advance, rest on handover"><Input value={f.payment_terms} onChange={set("payment_terms")} /></Field>
              <Field label="Advance %" hint="Sets up the advance and balance payments (if none are planned yet)"><Input value={f.advance_pct} onChange={set("advance_pct")} inputMode="numeric" placeholder="50" /></Field>
              <Field label="Why they chose you *">
                <Select value={f.reason} onChange={set("reason")} aria-label="Why they chose you"><option value="">Pick one…</option>{reasons.won.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
              </Field>
              <Field label="Competitors they considered" hint="Comma separated"><Input value={f.competitors} onChange={set("competitors")} /></Field>
              <div className="sm:col-span-2"><Field label="In their words (optional)" hint="What they said made them say yes"><Textarea value={f.won_detail} onChange={set("won_detail")} className="min-h-[60px]" /></Field></div>
              {wonFields.map((w) => {
                const k = w.key.replace(/^custom\./, "");
                return <div key={w.key} className={w.type === "long_text" ? "sm:col-span-2" : ""}><FieldInput def={{ ...w, label: `${w.label} *` }} value={custom[k]} onChange={(v) => setCustom((c) => ({ ...c, [k]: v }))} people={people} /></div>;
              })}
            </div>
            <p className="text-xs text-subtle">Attach the signed contract or PO under Documents on the deal (choose Signed contract or Purchase order, kept internal).</p>
          </>
        ) : null}

        {kind === "lost" || kind === "disqualified" || kind === "parked" || kind === "reopen" ? (
          <Field label={`${kind === "lost" ? "Why it was lost" : kind === "disqualified" ? "Why it is not a real deal" : kind === "parked" ? "Why it is parked" : "Why it is reopened"} *`}>
            <Select value={f.reason} onChange={set("reason")} aria-label="Reason"><option value="">Pick one…</option>{reasonList.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
          </Field>
        ) : null}
        {kind === "lost" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lost to" hint="Competitor name, in-house, or no decision"><Input value={f.lost_to} onChange={set("lost_to")} aria-label="Lost to" /></Field>
            <Field label="Try again on (optional)" hint="A date to reach out again"><Input type="date" value={f.date} onChange={set("date")} aria-label="Try again on" /></Field>
            <div className="sm:col-span-2"><Field label="What happened"><Textarea value={f.lost_detail} onChange={set("lost_detail")} className="min-h-[70px]" aria-label="What happened" /></Field></div>
            <div className="sm:col-span-2"><Field label="Lesson" hint="What would have won it"><Textarea value={f.lessons} onChange={set("lessons")} className="min-h-[60px]" aria-label="Lesson" /></Field></div>
          </div>
        ) : null}
        {kind === "disqualified" ? <Field label="Detail"><Textarea value={f.lost_detail} onChange={set("lost_detail")} className="min-h-[60px]" /></Field> : null}
        {kind === "parked" || (kind === "move" && pending.requires === "date") ? (
          <Field label={`Come back on ${kind === "parked" || pending.requires === "date" ? "*" : ""}`}><Input type="date" value={f.date} onChange={set("date")} aria-label="Come back on" /></Field>
        ) : null}
        {kind === "move" && pending.requires === "reason" ? <Field label="Reason *"><Input value={f.reason} onChange={set("reason")} aria-label="Reason" /></Field> : null}
        {!complete ? (
          <Field label={pending.requires === "quote" && kind === "move" ? "No quote sent from Daybook: say how you sent it *" : "Note (optional)"} hint={pending.requires === "quote" ? "e.g. PDF sent on email on 6 Nov" : "Saved with this move in the deal's history"}>
            <Textarea value={f.note} onChange={set("note")} className="min-h-[56px]" aria-label="Note" />
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>{complete ? "Save" : kind === "won" ? "Close as won" : "Move"}</Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- one input for any field

export function FieldInput({ def, value, onChange, people = [] }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; people?: PersonOpt[] }) {
  const s = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value);
  const label = def.label;
  const common = { "aria-label": def.label.replace(/ \*$/, "") };
  let input: React.ReactNode;
  switch (def.type) {
    case "long_text":
      input = <Textarea value={s} onChange={(e) => onChange(e.target.value)} className="min-h-[70px]" {...common} />;
      break;
    case "date":
      input = <Input type="date" value={s.slice(0, 10)} onChange={(e) => onChange(e.target.value)} {...common} />;
      break;
    case "datetime":
      input = <Input type="datetime-local" value={s ? localInput(new Date(s)) : ""} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")} {...common} />;
      break;
    case "number": case "money": case "percent":
      input = <Input value={s} onChange={(e) => onChange(e.target.value)} inputMode="decimal" {...common} />;
      break;
    case "checkbox":
      input = <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} {...common} /> Yes</label>;
      break;
    case "select":
      input = (
        <Select value={s} onChange={(e) => onChange(e.target.value)} {...common}>
          <option value="">—</option>
          {(def.options ?? []).map((o) => <option key={o} value={o}>{def.optionLabels?.[o] ?? (def.key === "deal_type" ? DEAL_TYPES.find(([k]) => k === o)?.[1] ?? o : o)}</option>)}
        </Select>
      );
      break;
    case "multi_select": {
      const cur = Array.isArray(value) ? (value as string[]) : s ? s.split(",").map((x) => x.trim()) : [];
      input = (
        <div className="flex flex-wrap gap-1.5" role="group" {...common}>
          {(def.options ?? []).map((o) => (
            <label key={o} className={cn("cursor-pointer rounded-md border px-2 py-1 text-xs", cur.includes(o) ? "border-accent bg-accent/10 text-accent" : "border-border")}>
              <input type="checkbox" className="sr-only" checked={cur.includes(o)} onChange={(e) => onChange(e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />{o}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "person":
      input = (
        <Select value={s} onChange={(e) => onChange(e.target.value)} {...common}>
          <option value="">—</option>
          {people.map((p) => <option key={p.id} value={String(p.id)}>{p.full_name}{p.title ? `, ${p.title}` : ""}</option>)}
        </Select>
      );
      break;
    default:
      input = <Input value={s} onChange={(e) => onChange(e.target.value)} inputMode={def.type === "phone" ? "tel" : def.type === "email" ? "email" : def.type === "url" ? "url" : undefined} {...common} />;
  }
  return <Field label={label} hint={def.hint}>{input}</Field>;
}

// ---------------------------------------------------------------- details: every field, grouped, with the qualification meter

function shown(def: FieldDef, deal: DealCard, people: PersonOpt[]): string {
  const v = def.custom ? (deal.custom ?? {})[def.key.replace(/^custom\./, "")] : (deal as unknown as Record<string, unknown>)[def.key];
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "";
  if (def.type === "person") return people.find((p) => p.id === Number(v))?.full_name ?? (Number(v) === deal.person_id ? deal.person_name ?? "" : "Someone not on the deal");
  if (def.type === "money" || def.key === "value_amount") return money(Number(v), def.custom ? "INR" : deal.currency);
  if (def.type === "date") return fmtWhen(String(v).slice(0, 10), false);
  if (def.type === "datetime") return fmtWhen(String(v));
  if (def.type === "checkbox") return v ? "Yes" : "No";
  if (def.key === "deal_type") return DEAL_TYPES.find(([k]) => k === v)?.[1] ?? String(v);
  if (def.optionLabels) return def.optionLabels[String(v)] ?? String(v);
  if (def.key === "probability") return `${v}%`;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

export function DealDetails({ deal, people, customDefs, onEdit, choices }: { deal: DealCard; people: PersonOpt[]; customDefs: FieldDef[]; onEdit: (group?: string) => void; choices?: Record<string, [string, string][]> }) {
  const DEAL_FIELDS = dealFieldsWith(choices);
  const [open, setOpen] = useState(false);
  const qual = qualification(deal as unknown as Record<string, unknown>);
  const skip = new Set(["title", "summary", "next_action", "next_action_at", "value_amount"]);
  const closingKeys = new Set(DEAL_FIELDS.filter((f) => f.group === "Closing").map((f) => f.key));
  const all = [...DEAL_FIELDS.filter((f) => !skip.has(f.key) && !closingKeys.has(f.key)), ...customDefs];
  const groups = FIELD_GROUPS.filter((g) => g !== "Closing").map((g) => ({ g, rows: all.filter((f) => f.group === g).map((f) => [f, shown(f, deal, people)] as const) }));
  const filled = groups.reduce((a, x) => a + x.rows.filter(([, v]) => v).length, 0);
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Deal details">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-base">Details</h3>
        <Button size="sm" variant="ghost" onClick={() => onEdit()}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
      </div>
      <div className="rounded-lg border border-border bg-bg p-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium">Qualification {qual.done}/{qual.total}</span>
          <span className={cn("text-subtle", qual.done >= 9 && "text-good")}>{qual.done >= 9 ? "Well qualified" : qual.done >= 5 ? "Partly qualified" : "Not qualified yet"}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent" style={{ width: `${(qual.done / qual.total) * 100}%` }} /></div>
        {qual.missing.length ? (
          <p className="mt-2 text-xs text-subtle">Still to find out: {qual.missing.map((m, i) => (
            <span key={m.key}>
              <button type="button" className="text-accent hover:underline" onClick={() => onEdit(DEAL_FIELD.get(m.key)?.group)}>{m.label}</button>{i < qual.missing.length - 1 ? ", " : ""}
            </span>
          ))}</p>
        ) : null}
      </div>
      <dl className="mt-3 space-y-3 text-sm">
        {groups.map(({ g, rows }) => {
          const vis = rows.filter(([, v]) => v);
          if (!vis.length || (!open && g !== "Basics" && g !== "Location" && g !== "The need")) return null;
          return (
            <div key={g}>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">{g}</p>
              <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {vis.map(([f, v]) => (
                  <div key={f.key} className={cn(f.type === "long_text" && "sm:col-span-2")}>
                    <dt className="text-xs text-subtle">{f.label}</dt>
                    <dd className="whitespace-pre-line break-words">{v}</dd>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </dl>
      <button type="button" className="mt-3 flex items-center gap-1 text-xs text-accent" onClick={() => setOpen((o) => !o)}>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> {open ? "Show less" : `Show all filled fields (${filled})`}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------- edit every field

export function DealEditSheet({ deal, people, customDefs, open, onOpenChange, focusGroup, footer, choices }: {
  deal: DealCard; people: PersonOpt[]; customDefs: FieldDef[]; open: boolean; onOpenChange: (o: boolean) => void; focusGroup?: string; footer?: React.ReactNode;
  choices?: Record<string, [string, string][]>;
}) {
  const DEAL_FIELDS = useMemo(() => dealFieldsWith(choices), [choices]);
  const initial = useMemo(() => {
    const o: Record<string, unknown> = {};
    for (const f of DEAL_FIELDS) {
      const v = (deal as unknown as Record<string, unknown>)[f.key];
      o[f.key] = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : f.type === "date" ? String(v).slice(0, 10) : f.type === "select" ? String(v) : v;
    }
    o.currency = deal.currency;
    for (const c of customDefs) o[c.key] = (deal.custom ?? {})[c.key.replace(/^custom\./, "")] ?? "";
    return o;
  }, [deal, customDefs, DEAL_FIELDS]);
  const [f, setF] = useState(initial);
  const [tab, setTab] = useState<string>(focusGroup ?? "Basics");
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setF(initial);
    setTab(focusGroup ?? "Basics");
  }
  if (!open && lastOpen) setLastOpen(false);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const all = [...DEAL_FIELDS.filter((x) => x.group !== "Closing" || deal.stage_category === "won" || deal.stage_category === "lost"), ...customDefs];
  const tabs = FIELD_GROUPS.filter((g) => all.some((x) => x.group === g));
  const save = () =>
    start(async () => {
      const patch: Record<string, unknown> = {};
      const custom: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) {
        if (JSON.stringify(v) === JSON.stringify(initial[k])) continue;
        if (k.startsWith("custom.")) custom[k.slice(7)] = v;
        else patch[k] = v;
      }
      if (Object.keys(custom).length) patch.custom = custom;
      if (!Object.keys(patch).length) return onOpenChange(false);
      const r = await updateDealAction(deal.id, patch);
      if (!r.ok) return toast(r.error, "error");
      toast("Saved. Every change is in the deal's history.");
      onOpenChange(false);
      router.refresh();
    });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Deal details" description="Only what you change is saved, and each change is recorded with the date." wide>
      <div className="-mx-1 mb-3 flex flex-wrap gap-1" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn("rounded-md px-2.5 py-1 text-xs", tab === t ? "bg-accent text-accent-fg" : "text-subtle hover:bg-muted")}>{t}</button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {all.filter((x) => x.group === tab).map((def) => (
          <div key={def.key} className={cn((def.type === "long_text" || def.key === "title") && "sm:col-span-2")}>
            {def.key === "value_amount" ? (
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <FieldInput def={{ ...def, label: `Value (${currencySymbol(String(f.currency))})` }} value={f[def.key]} onChange={(v) => setF((c) => ({ ...c, [def.key]: v }))} />
                <Field label="Currency"><Select value={String(f.currency)} onChange={(e) => setF((c) => ({ ...c, currency: e.target.value }))} aria-label="Currency">{[...new Set([...CURRENCIES, String(f.currency)])].map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}</Select></Field>
              </div>
            ) : def.key === "source" ? (
              <FieldInput def={{ ...def, options: SOURCES }} value={f[def.key]} onChange={(v) => setF((c) => ({ ...c, [def.key]: v }))} />
            ) : (
              <FieldInput def={def} value={f[def.key]} onChange={(v) => setF((c) => ({ ...c, [def.key]: v }))} people={people} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {footer ?? <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>Save</Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the closing record

export function ClosingRecord({ deal, people, gaps, onComplete }: { deal: DealCard; people: PersonOpt[]; gaps: string[]; onComplete: () => void }) {
  const won = deal.stage_category === "won";
  const lost = deal.stage_category === "lost";
  if (!won && !lost) return null;
  const rows: [string, string][] = won
    ? [
        ["Point of contact", people.find((p) => p.id === deal.poc_id)?.full_name ?? ""],
        ["Final amount", deal.value_amount ? money(Number(deal.value_amount), deal.currency) : ""],
        ["Start", fmtWhen(deal.start_date ?? null, false)],
        ["Delivery", [fmtWhen(deal.delivery_date ?? null, false), deal.delivery_duration].filter(Boolean).join(" · ")],
        ["Payment terms", deal.payment_terms ?? ""],
        ["Contract / PO", deal.contract_ref ?? ""],
        ["Why they chose you", [deal.won_reason, deal.won_detail].filter(Boolean).join(": ")],
        ["Scope of work", deal.scope ?? ""],
      ]
    : [
        ["Why", deal.lost_reason ?? ""],
        ["Lost to", deal.lost_to ?? ""],
        ["What happened", deal.lost_detail ?? ""],
        ["Lesson", deal.lessons ?? ""],
        ["Try again on", fmtWhen(deal.revisit_on ?? null, false)],
      ];
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Closing record">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-base">{won ? "Closing record" : deal.stage_role === "disqualified" ? "Why it was disqualified" : "Why it was lost"}</h3>
        {won ? <Button size="sm" variant={gaps.length ? "primary" : "ghost"} onClick={onComplete}><Pencil className="h-3.5 w-3.5" /> {gaps.length ? "Complete" : "Edit"}</Button> : null}
      </div>
      {won && gaps.length ? <p className="mb-2 rounded-md bg-warn-muted px-2.5 py-1.5 text-xs text-warn">Missing: {gaps.join(", ")}. It was closed without the checklist (from Telegram or by the client).</p> : null}
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className={cn(k === "Scope of work" || k === "What happened" ? "sm:col-span-2" : "")}>
            <dt className="text-xs text-subtle">{k}</dt>
            <dd className="whitespace-pre-line break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------- log an activity by hand, at any date and time

export function ActivityLogger({ dealId, people }: { dealId: number; people: PersonOpt[] }) {
  const blank = () => ({ type: "call", direction: "out", at: localInput(), duration: "", outcome: "", person: "", subject: "", body: "", next: "", nextAt: "" });
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));
  const timed = ["call", "meeting", "in_person"].includes(f.type);
  const outcomes = [...(OUTCOMES[f.type] ?? []), ...OUTCOMES.any];
  const note = f.type === "note";
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => { setF(blank()); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> Log an activity or remark</Button>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl border border-accent/40 bg-surface p-4" aria-label="Log an activity">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What">
          <Select value={f.type} onChange={set("type")} aria-label="Activity type">{ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>
        </Field>
        {!note ? (
          <Field label="Who started it">
            <Select value={f.direction} onChange={set("direction")} aria-label="Who started it">
              <option value="out">I reached out</option><option value="in">They reached out</option><option value="both">We talked (both ways)</option>
            </Select>
          </Field>
        ) : <span className="hidden sm:block" />}
        <Field label="When"><Input type="datetime-local" value={f.at} onChange={set("at")} aria-label="When" /></Field>
        {timed ? <Field label="Duration (minutes)"><Input value={f.duration} onChange={set("duration")} inputMode="numeric" aria-label="Duration" /></Field> : null}
        {!note ? (
          <Field label="Outcome">
            <Select value={f.outcome} onChange={set("outcome")} aria-label="Outcome"><option value="">—</option>{outcomes.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
          </Field>
        ) : null}
        {people.length && !note ? (
          <Field label="With">
            <Select value={f.person} onChange={set("person")} aria-label="With"><option value="">—</option>{people.map((p) => <option key={p.id} value={String(p.id)}>{p.full_name}</option>)}</Select>
          </Field>
        ) : null}
      </div>
      <Field label={note ? "Remark (one line)" : "About (one line)"}><Input value={f.subject} onChange={set("subject")} placeholder={note ? "Prefers calls after 6 pm" : "Pricing call with the owner"} aria-label="About" /></Field>
      <Field label={note ? "Details" : "What was discussed"} hint="One point per line: everything you will want to remember"><Textarea value={f.body} onChange={set("body")} className="min-h-[100px]" aria-label="What was discussed" /></Field>
      {!note ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <Field label="Next step (optional)"><Input value={f.next} onChange={set("next")} placeholder="Send the revised quote" aria-label="Next step" /></Field>
          <Field label="By"><Input type="datetime-local" value={f.nextAt} onChange={set("nextAt")} aria-label="Next step by" /></Field>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => start(async () => {
          const r = await logActivityAction(dealId, {
            type: f.type, direction: note ? "internal" : (f.direction as "in" | "out" | "both"), occurred_at: f.at ? new Date(f.at).toISOString() : null,
            duration_min: timed ? f.duration : null, outcome: note ? null : f.outcome || null, person_id: f.person ? Number(f.person) : null,
            subject: f.subject, body: f.body, next_step: note ? null : f.next || null, next_step_at: f.nextAt ? new Date(f.nextAt).toISOString() : null,
          });
          if (!r.ok) return toast(r.error, "error");
          toast("Logged");
          setOpen(false);
          router.refresh();
        })}>Save</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a timeline entry you can correct

export function TimelineItem({ i, onDelete }: { i: InteractionRow; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const Dir = i.direction === "in" ? ArrowDownLeft : i.direction === "out" ? ArrowUpRight : Users;
  return (
    <li className="rounded-xl border border-border p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-lg bg-muted p-1 text-subtle"><ChannelIcon channel={i.channel} className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1 text-xs text-subtle">
            <Dir className="h-3 w-3" /> {CHANNEL_LABEL[i.channel] ?? i.channel} · {i.direction === "in" ? "from them" : i.direction === "out" ? "from you" : i.direction === "both" ? "both ways" : "note"} · <time dateTime={i.occurred_at}>{fmtWhen(i.occurred_at)}</time>
            {i.duration_min ? <span>· {i.duration_min} min</span> : null}
            {i.confidence === "assumed" ? <span title="Logged when you tapped a Daybook send link">· via link</span> : null}
            {i.person_name ? <span>· {i.person_name}</span> : null}
            {i.edited_at ? <span title={`Edited ${fmtWhen(i.edited_at)}`}>· edited</span> : null}
          </p>
          <p className="text-sm">{i.summary || i.subject || (i.body ?? "").slice(0, 200)}</p>
          {i.outcome ? <Chip className="mt-1">{i.outcome}</Chip> : null}
          {i.body && (i.summary || i.body.length > 200) ? (
            <button type="button" className="block text-xs text-accent" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show full text"}</button>
          ) : null}
          {open ? <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 font-sans text-xs">{i.body}</pre> : null}
        </div>
        <button type="button" aria-label="Edit entry" onClick={() => setEdit(true)} className="text-subtle/60 hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label="Delete entry" onClick={() => confirm("Delete this entry?") && onDelete()} className="text-subtle/50 hover:text-bad"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      {edit ? <EditEntry i={i} onDone={() => setEdit(false)} /> : null}
    </li>
  );
}

function EditEntry({ i, onDone }: { i: InteractionRow; onDone: () => void }) {
  const [f, setF] = useState({
    at: localInput(new Date(i.occurred_at)), channel: i.channel, direction: i.direction, summary: i.summary ?? "", body: i.body ?? "",
    outcome: i.outcome ?? "", duration: i.duration_min ? String(i.duration_min) : "",
  });
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));
  return (
    <Sheet open onOpenChange={(o) => !o && onDone()} title="Correct this entry" description="The date, channel, words or outcome. The deal's last-touch dates follow.">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When"><Input type="datetime-local" value={f.at} onChange={set("at")} aria-label="When" /></Field>
          <Field label="Channel"><Select value={f.channel} onChange={set("channel")} aria-label="Channel">{Object.entries(CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Direction">
            <Select value={f.direction} onChange={set("direction")} aria-label="Direction">
              <option value="out">From you</option><option value="in">From them</option><option value="both">Both ways</option><option value="internal">Note</option>
            </Select>
          </Field>
          <Field label="Duration (minutes)"><Input value={f.duration} onChange={set("duration")} inputMode="numeric" /></Field>
          <div className="sm:col-span-2"><Field label="Outcome"><Input value={f.outcome} onChange={set("outcome")} /></Field></div>
        </div>
        <Field label="Summary"><Input value={f.summary} onChange={set("summary")} aria-label="Summary" /></Field>
        <Field label="Full text"><Textarea value={f.body} onChange={set("body")} className="min-h-[120px]" /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => start(async () => {
            const r = await editInteractionAction(i.id, {
              occurred_at: new Date(f.at).toISOString(), channel: f.channel, direction: f.direction, summary: f.summary, body: f.body, outcome: f.outcome, duration_min: f.duration,
            });
            if (!r.ok) return toast(r.error, "error");
            toast("Corrected");
            onDone();
            router.refresh();
          })}>Save</Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the journey: every stage change and field change, dated

export interface JourneyEvent {
  id: number;
  kind: string;
  from_name: string | null;
  to_name: string | null;
  from_sort: number | null;
  to_sort: number | null;
  from_cat: string | null;
  to_cat: string | null;
  cause: string;
  detail: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  edited_at: string | null;
}

const CAUSE: Record<string, string> = { manual: "by you", auto: "automatically", ai: "by the AI, from a conversation", telegram: "from Telegram", client: "by the client" };

/** Stage moves (with time spent, back-moves and reasons) and every field change, newest first, with a per-stage total. */
export function Journey({ events, created, customLabels }: { events: JourneyEvent[]; created: string; customLabels: Record<string, string> }) {
  const [showFields, setShowFields] = useState(false);
  const [noteFor, setNoteFor] = useState<JourneyEvent | null>(null);
  const asc = [...events].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const stages = asc.filter((e) => e.kind === "stage");
  // time spent in each stage, from the moves (the current stage runs to now)
  const spent = new Map<number, number>();
  const totals = new Map<string, number>();
  let prevAt = +new Date(created);
  for (const e of stages) {
    const ms = +new Date(e.created_at) - prevAt;
    spent.set(e.id, ms);
    if (e.from_name) totals.set(e.from_name, (totals.get(e.from_name) ?? 0) + ms);
    prevAt = +new Date(e.created_at);
  }
  const current = stages.at(-1)?.to_name ?? null;
  if (current) totals.set(current, (totals.get(current) ?? 0) + (Date.now() - prevAt));
  const fields = asc.filter((e) => e.kind === "field");
  const list = [...asc].reverse().filter((e) => e.kind !== "field" || showFields);
  const label = (f: string | null) => (f ? (f.startsWith("custom.") ? customLabels[f.slice(7)] ?? f.slice(7) : DEAL_FIELD.get(f)?.label ?? (f === "currency" ? "Currency" : f)) : "");
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Journey">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-base">Journey</h3>
        {fields.length ? <button type="button" className="text-xs text-accent" onClick={() => setShowFields((s) => !s)}>{showFields ? "Hide field changes" : `Show field changes (${fields.length})`}</button> : null}
      </div>
      {totals.size ? (
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          {[...totals.entries()].map(([n, ms]) => <span key={n} className={cn("rounded-md bg-muted px-2 py-0.5", n === current && "bg-accent/10 text-accent")}>{n}: {fmtSpan(ms)}{n === current ? " so far" : ""}</span>)}
        </div>
      ) : null}
      <ol className="relative space-y-3 border-l border-border pl-4 text-sm">
        {list.map((e) => {
          const back = e.kind === "stage" && e.from_cat === "open" && e.to_cat === "open" && (e.to_sort ?? 0) < (e.from_sort ?? 0);
          return (
            <li key={`${e.kind}-${e.id}`} className="relative">
              <span className={cn("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface", e.kind === "field" ? "bg-subtle/40" : back ? "bg-warn" : "bg-accent")} />
              {e.kind === "field" ? (
                <p className="text-xs"><span className="text-subtle">{label(e.field)}:</span> {e.old_value ? <><s className="text-subtle">{e.old_value.slice(0, 120)}</s> → </> : null}<span>{e.new_value?.slice(0, 200) || <i className="text-subtle">cleared</i>}</span></p>
              ) : (
                <p className="font-medium">
                  {back ? <CornerUpLeft className="mr-1 inline h-3.5 w-3.5 text-warn" aria-label="moved back" /> : null}
                  {e.from_name ? <>{e.from_name} → {e.to_name}</> : <>Started in {e.to_name}</>}
                  {back ? <span className="ml-1 text-xs font-normal text-warn">moved back</span> : null}
                </p>
              )}
              <p className="text-xs text-subtle">
                <time dateTime={e.created_at}>{fmtWhen(e.created_at)}</time> · {CAUSE[e.cause] ?? e.cause}
                {e.kind === "stage" && e.from_name && spent.has(e.id) ? <> · after {fmtSpan(spent.get(e.id)!)} in {e.from_name}</> : null}
              </p>
              {e.kind === "stage" ? (
                <p className="text-xs">
                  {e.detail ? <span className="whitespace-pre-line">{e.detail}</span> : null}
                  <button type="button" className="ml-1 text-accent hover:underline" onClick={() => setNoteFor(e)}>{e.detail ? "edit note" : "add a reason or note"}</button>
                  {e.edited_at ? <span className="ml-1 text-subtle">(note edited {fmtWhen(e.edited_at)})</span> : null}
                </p>
              ) : null}
            </li>
          );
        })}
        <li className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-subtle" />
          <p className="font-medium">Deal created</p>
          <p className="text-xs text-subtle"><time dateTime={created}>{fmtWhen(created)}</time></p>
        </li>
      </ol>
      {noteFor ? <NoteSheet e={noteFor} onDone={() => setNoteFor(null)} /> : null}
    </section>
  );
}

function NoteSheet({ e, onDone }: { e: JourneyEvent; onDone: () => void }) {
  const [note, setNote] = useState(e.detail ?? "");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(o) => !o && onDone()} title="Reason or note for this move" description={`${e.from_name ?? "Start"} → ${e.to_name} · ${fmtWhen(e.created_at)}`}>
      <div className="space-y-3">
        <Textarea value={note} onChange={(x) => setNote(x.target.value)} className="min-h-[90px]" aria-label="Note for this move" autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => start(async () => {
            const r = await setEventNoteAction(e.id, note);
            if (!r.ok) return toast(r.error, "error");
            onDone();
            router.refresh();
          })}>Save</Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- edit a company or a person (every field, plus yours)

export function RecordEditSheet({ title, description, fields, customDefs, record, onSave, onClose }: {
  title: string; description?: string; fields: FieldDef[]; customDefs: FieldDef[]; record: Record<string, unknown>;
  onSave: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>; onClose: () => void;
}) {
  const initial = useMemo(() => {
    const o: Record<string, unknown> = {};
    for (const f of fields) { const v = record[f.key]; o[f.key] = v === null || v === undefined ? (f.type === "checkbox" ? null : "") : Array.isArray(v) ? v.join(", ") : v; }
    for (const c of customDefs) o[c.key] = ((record.custom ?? {}) as Record<string, unknown>)[c.key.replace(/^custom\./, "")] ?? "";
    return o;
  }, [fields, customDefs, record]);
  const [f, setF] = useState(initial);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const all = [...fields, ...customDefs];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={title} description={description} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        {all.map((def) => (
          <div key={def.key} className={cn(def.type === "long_text" && "sm:col-span-2")}>
            <FieldInput def={def} value={f[def.key]} onChange={(v) => setF((c) => ({ ...c, [def.key]: v }))} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => start(async () => {
          const patch: Record<string, unknown> = {};
          const custom: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(f)) {
            if (JSON.stringify(v) === JSON.stringify(initial[k])) continue;
            if (k.startsWith("custom.")) custom[k.slice(7)] = v;
            else patch[k] = v;
          }
          if (Object.keys(custom).length) patch.custom = custom;
          if (!Object.keys(patch).length) return onClose();
          const r = await onSave(patch);
          if (!r.ok) return toast(r.error ?? "Could not save", "error");
          toast("Saved");
          onClose();
          router.refresh();
        })}>Save</Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- documents: category and internal

export function DocCategory({ category, internal }: { category?: string | null; internal?: boolean }) {
  if (!category && !internal) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-1 text-xs text-subtle">
      <FileText className="h-3 w-3" />{category ?? ""}{internal ? " · internal" : ""}
    </span>
  );
}
