"use client";

import { ArrowDownLeft, ArrowUpRight, Check, Copy, ExternalLink, FileText, Link2, Loader2, Plus, Sparkles, Trash2, Upload, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  addCommitmentAction, addPaymentAction, briefFromAuditAction, commitmentAction, createLinkAction, createQuoteAction, deleteDealAction,
  deleteInteractionAction, deletePaymentAction, markPaidAction, removeDealPersonAction, setPersonAction, startFileAction, updateDealAction,
} from "@/app/sales-actions";
import { Button, Chip, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { CommitmentRow, DealCard, InteractionRow, PaymentRow } from "@/lib/sales/deals";
import type { Enrichment } from "@/lib/sales/enrich";
import type { MoveRow } from "@/lib/sales/moves";
import type { Stage } from "@/lib/sales/stages";
import { CaptureBox } from "./capture-box";
import { EnrichmentPanel } from "./enrichment-panel";
import { MoveCard } from "./moves-view";
import { StageMoveSheet, type PendingMove } from "./pipeline-board";
import { ago, ChannelIcon, CHANNEL_LABEL, fmtDate, Label, money, Priority } from "./util";

export interface DealPageData {
  deal: DealCard;
  targets: (Stage & { requires: string })[];
  timeline: InteractionRow[];
  touches: { channel: string; last_at: string; last_in: string | null; count: number }[];
  commitments: CommitmentRow[];
  payments: PaymentRow[];
  docs: { id: number; slug: string; kind: string; title: string; status: string; view_count: number; last_viewed_at: string | null; current_rev: number; total: number | null; currency: string | null; sent_at: string | null }[];
  moves: MoveRow[];
  people: { id: number; full_name: string; title: string | null; role: string; emails: string[]; phones: string[]; linkedin: string | null; is_decision_maker: boolean | null }[];
  company: { id: number; name: string; website: string | null; industry: string | null; country: string | null; employees: number | null; revenue_usd: number | null; revenue_is_estimate: boolean; enrichment: Enrichment; enriched_at: string | null; audit: { summary?: string; opportunities?: { title: string; problem: string; fix: string; impact: string; effort: string }[]; money_leak?: string; first_project?: string } | null } | null;
  person: { id: number; full_name: string; enrichment: Enrichment; enriched_at: string | null } | null;
  events: { id: number; from_name: string | null; to_name: string | null; cause: string; detail: string | null; created_at: string }[];
  meetings: { id: number; title: string; starts_at: string; link: string | null }[];
  companyFields: { group: string; fields: [string, string][] }[];
  personFields: { group: string; fields: [string, string][] }[];
  googleReady: boolean;
  voiceEnabled: boolean;
  baseUrl: string;
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-base">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DealView({ d }: { d: DealPageData }) {
  const deal = d.deal;
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({
    title: deal.title, value_amount: deal.value_amount ?? "", currency: deal.currency, expected_close: deal.expected_close ? String(deal.expected_close).slice(0, 10) : "",
    summary: deal.summary ?? "", requirements: deal.requirements ?? "", budget: deal.budget ?? "", timeline: deal.timeline ?? "", next_action: deal.next_action ?? "",
    next_action_at: deal.next_action_at ? new Date(deal.next_action_at).toISOString().slice(0, 16) : "", country: deal.country ?? "", probability: deal.probability ?? "",
    commission_type: deal.commission_type ?? "", commission_value: deal.commission_value ?? "", source: deal.source, talk_via_intermediary: deal.talk_via_intermediary,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((c) => ({ ...c, [k]: e.target.value }));
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return toast((r as { error: string }).error, "error");
      if (msg) toast(msg);
      router.refresh();
    });

  const save = () =>
    act(() => updateDealAction(deal.id, {
      ...f,
      value_amount: f.value_amount === "" ? null : Number(f.value_amount),
      probability: f.probability === "" ? null : Number(f.probability),
      commission_value: f.commission_value === "" ? null : Number(f.commission_value),
      commission_type: f.commission_type || null,
      expected_close: f.expected_close || null,
      next_action_at: f.next_action_at ? new Date(f.next_action_at).toISOString() : null,
    }), "Saved");

  const mine = d.commitments.filter((c) => c.owner === "me" && c.status === "open");
  const theirs = d.commitments.filter((c) => c.owner === "them" && c.status === "open");
  const net = deal.value_amount && deal.commission_value
    ? deal.commission_type === "percent" ? Number(deal.value_amount) * (1 - Number(deal.commission_value) / 100) : Number(deal.value_amount) - Number(deal.commission_value)
    : null;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold" style={{ background: `${deal.stage_color}26`, borderColor: `${deal.stage_color}80` }}>
                <span className="h-2 w-2 rounded-full" style={{ background: deal.stage_color }} />{deal.stage_name}
              </span>
              <Priority value={deal.priority} prev={deal.priority_prev} why={deal.priority_why} />
              <Chip>{deal.source}{deal.source_detail && !/^https?:/.test(deal.source_detail) ? `: ${deal.source_detail.slice(0, 40)}` : ""}</Chip>
              {deal.source_detail && /^https?:/.test(deal.source_detail) ? <a href={deal.source_detail} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent">source <ExternalLink className="h-3 w-3" /></a> : null}
              {deal.country ? <Chip>{deal.country}</Chip> : null}
            </div>
            <h1 className="mt-1.5 font-display text-2xl leading-tight">{deal.title}</h1>
            <p className="text-sm text-subtle">
              {deal.person_name ?? "No contact yet"}{deal.person_title ? `, ${deal.person_title}` : ""}{deal.company_name ? ` · ${deal.company_name}` : ""}
              {deal.referrer_name ? ` · referred by ${deal.referrer_name}` : ""}{deal.intermediary_name ? ` · via ${deal.intermediary_name} (${deal.intermediary_type})` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl tabular">{deal.value_amount ? money(deal.value_amount, deal.currency) : "No value yet"}</p>
            {net !== null ? <p className="text-xs text-subtle">net after commission {money(net, deal.currency)}</p> : null}
            <p className="text-xs text-subtle">{Math.floor((Date.now() - new Date(deal.stage_changed_at).getTime()) / 86_400_000)}d in stage{deal.stage_sla ? ` (limit ${deal.stage_sla})` : ""}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-subtle">Move to:</span>
          {d.targets.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              onClick={() => (t.requires !== "none" || t.category === "lost" || t.category === "parked" ? setPendingMove({ deal, to: t, requires: t.requires }) : act(async () => (await import("@/app/sales-actions")).moveStageAction(deal.id, t.id), `Moved to ${t.name}`))}
              className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
            >
              {t.name}{t.requires !== "none" ? " *" : ""}
            </button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit(true)}>Edit details</Button>
        </div>
        {deal.priority_why?.length ? (
          <p className="mt-2 text-xs text-subtle">Why this priority: {deal.priority_why.join(" · ")}</p>
        ) : null}
        {d.touches.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            <span className="text-xs text-subtle">Last touch:</span>
            {d.touches.map((t) => (
              <span key={t.channel} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" title={`${t.count} touches${t.last_in ? `, they last wrote ${ago(t.last_in)}` : ""}`}>
                <ChannelIcon channel={t.channel} className="h-3 w-3" /> {CHANNEL_LABEL[t.channel] ?? t.channel} {ago(t.last_at)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <Section title="Where we are">
            {deal.summary ? <p className="whitespace-pre-line text-sm">{deal.summary}</p> : <p className="text-sm text-subtle">Log a conversation below and this fills itself.</p>}
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {deal.requirements ? <div className="sm:col-span-2"><dt className="text-subtle">Requirement</dt><dd className="whitespace-pre-line">{deal.requirements}</dd></div> : null}
              {deal.budget ? <div><dt className="text-subtle">Budget</dt><dd>{deal.budget}</dd></div> : null}
              {deal.timeline ? <div><dt className="text-subtle">Timeline</dt><dd>{deal.timeline}</dd></div> : null}
              {deal.objections?.length ? <div className="sm:col-span-2"><dt className="text-subtle">Objections</dt><dd>{deal.objections.join(" · ")}</dd></div> : null}
              {deal.next_action ? <div className="sm:col-span-2"><dt className="text-subtle">Next step</dt><dd className="font-medium">{deal.next_action}{deal.next_action_at ? ` (${fmtDate(deal.next_action_at)})` : ""}</dd></div> : null}
            </dl>
          </Section>

          {d.moves.length ? (
            <div>
              <Label>Moves for this deal</Label>
              <ul className="space-y-3">{d.moves.map((m) => <MoveCard key={m.id} m={m} googleReady={d.googleReady} onGone={() => router.refresh()} />)}</ul>
            </div>
          ) : null}

          <div>
            <Label>Log something</Label>
            <CaptureBox dealId={deal.id} voiceEnabled={d.voiceEnabled} compact placeholder={`Paste the latest chat with ${deal.person_name ?? "them"}, an email, or speak a debrief. Promises and next steps are picked out for you.`} />
          </div>

          <Section title={`Timeline · ${d.timeline.length}`}>
            {d.timeline.length ? (
              <ol className="space-y-2">
                {d.timeline.map((i) => <TimelineItem key={i.id} i={i} onDelete={() => act(() => deleteInteractionAction(i.id))} />)}
              </ol>
            ) : <p className="text-sm text-subtle">No touches yet.</p>}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Promises">
            <Promises dealId={deal.id} mine={mine} theirs={theirs} onChange={() => router.refresh()} />
          </Section>

          {d.meetings.length ? (
            <Section title="Meetings">
              <ul className="space-y-1.5 text-sm">
                {d.meetings.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>{m.title} <span className="text-xs text-subtle">{fmtDate(m.starts_at)}</span></span>
                    {m.link?.startsWith("https://") ? <a href={m.link} target="_blank" rel="noreferrer" className="text-xs text-accent">Join</a> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Documents" action={<DocButtons dealId={deal.id} companyId={d.company?.id ?? null} />}>
            {d.docs.length ? (
              <ul className="space-y-2">
                {d.docs.map((x) => {
                  const url = x.kind === "link" ? `${d.baseUrl}/l/${x.slug}` : `${d.baseUrl}/q/${x.slug}`;
                  return (
                    <li key={x.id} className="rounded-xl border border-border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/sales/docs/${x.id}`} className="text-sm font-medium hover:text-accent">
                          {x.kind === "quote" ? <FileText className="mr-1 inline h-3.5 w-3.5" /> : <Link2 className="mr-1 inline h-3.5 w-3.5" />}
                          {x.title}{x.kind === "quote" ? ` v${x.current_rev}` : ""}
                        </Link>
                        <Chip className={cn(x.status === "accepted" && "bg-p-mint text-p-mint-fg", x.status === "viewed" && "bg-p-sky text-p-sky-fg", x.status === "changes" && "bg-p-butter text-p-butter-fg")}>{x.status}</Chip>
                      </div>
                      <p className="mt-0.5 text-xs text-subtle">
                        {x.total ? `${money(x.total, x.currency ?? "USD")} · ` : ""}{x.view_count ? `opened ${x.view_count}x, last ${ago(x.last_viewed_at)}` : x.sent_at ? "not opened yet" : "draft"}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1">
                        <code className="truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">{url.replace(/^https?:\/\//, "")}</code>
                        <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => void navigator.clipboard.writeText(url).then(() => toast("Link copied. Send it instead of an attachment."), () => toast("Your browser blocked copying. Select the text and copy it by hand.", "error"))}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-subtle">Send links, not attachments: every open is tracked and pinged to you.</p>}
          </Section>

          <Section title="Money">
            <Payments dealId={deal.id} currency={deal.currency} payments={d.payments} onChange={() => router.refresh()} />
          </Section>

          <Section title="People" action={<AddPerson dealId={deal.id} />}>
            <ul className="space-y-2">
              {d.people.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{p.full_name} <span className="text-xs font-normal text-subtle">{p.role.replace("_", " ")}{p.is_decision_maker ? " · decides" : ""}</span></p>
                    <p className="truncate text-xs text-subtle">{[p.title, ...p.emails, ...p.phones].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button type="button" aria-label="Remove from deal" onClick={() => act(() => removeDealPersonAction(deal.id, p.id))} className="text-subtle hover:text-bad"><X className="h-3.5 w-3.5" /></button>
                </li>
              ))}
              {!d.people.length ? <li className="text-sm text-subtle">Nobody yet.</li> : null}
            </ul>
            {deal.intermediary_name ? (
              <label className="mt-3 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={f.talk_via_intermediary} onChange={(e) => {
                  setF((c) => ({ ...c, talk_via_intermediary: e.target.checked }));
                  act(() => updateDealAction(deal.id, { talk_via_intermediary: e.target.checked }));
                }} />
                Follow-ups go to {deal.intermediary_name}, not the client
              </label>
            ) : null}
          </Section>

          {d.company?.audit?.summary ? (
            <Section title="Opportunity audit">
              <p className="text-sm">{d.company.audit.summary}</p>
              {d.company.audit.money_leak ? <p className="mt-2 rounded-lg bg-warn-muted px-2.5 py-1.5 text-xs text-warn">{d.company.audit.money_leak}</p> : null}
              <ul className="mt-2 space-y-1.5 text-xs">
                {(d.company.audit.opportunities ?? []).map((o, i) => <li key={i}><b>{o.title}</b>: {o.fix} <span className="text-subtle">({o.impact}; {o.effort})</span></li>)}
              </ul>
              {d.company.audit.first_project ? <p className="mt-2 text-xs"><b>Start with:</b> {d.company.audit.first_project}</p> : null}
            </Section>
          ) : null}

          <Section title="Stage history">
            <ol className="space-y-1 text-xs">
              {d.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span>{e.from_name ? `${e.from_name} → ` : "Created in "}{e.to_name}{e.detail ? <span className="text-subtle"> · {e.detail}</span> : null}</span>
                  <span className="shrink-0 text-subtle">{e.cause} · {ago(e.created_at)}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      {d.company ? <EnrichmentPanel kind="company" id={d.company.id} data={d.company.enrichment} groups={d.companyFields} enrichedAt={d.company.enriched_at} title={`Company: ${d.company.name}`} /> : null}
      {d.person ? <EnrichmentPanel kind="person" id={d.person.id} data={d.person.enrichment} groups={d.personFields} enrichedAt={d.person.enriched_at} title={`Person: ${d.person.full_name}`} /> : null}

      <Sheet open={edit} onOpenChange={setEdit} title="Deal details">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Title"><Input value={f.title} onChange={set("title")} /></Field></div>
          <Field label="Value"><Input value={String(f.value_amount)} onChange={set("value_amount")} inputMode="decimal" /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={set("currency")}>{["USD", "INR", "AED", "GBP", "EUR", "CAD", "AUD", "SGD", "SAR", "CNY"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Win probability % (blank = stage default)"><Input value={String(f.probability)} onChange={set("probability")} inputMode="numeric" /></Field>
          <Field label="Expected close"><Input type="date" value={f.expected_close} onChange={set("expected_close")} /></Field>
          <Field label="Source">
            <Select value={f.source} onChange={set("source")}>{["outbound", "inbound", "referral", "network", "content", "partner", "radar", "repeat", "other"].map((s) => <option key={s}>{s}</option>)}</Select>
          </Field>
          <Field label="Country"><Input value={f.country} onChange={set("country")} /></Field>
          <Field label="Commission to intermediary">
            <Select value={f.commission_type} onChange={set("commission_type")}><option value="">None</option><option value="percent">Percent</option><option value="fixed">Fixed amount</option></Select>
          </Field>
          <Field label="Commission value"><Input value={String(f.commission_value)} onChange={set("commission_value")} inputMode="decimal" /></Field>
          <div className="sm:col-span-2"><Field label="Where we are"><Textarea value={f.summary} onChange={set("summary")} /></Field></div>
          <div className="sm:col-span-2"><Field label="Requirement"><Textarea value={f.requirements} onChange={set("requirements")} /></Field></div>
          <Field label="Budget"><Input value={f.budget} onChange={set("budget")} /></Field>
          <Field label="Timeline"><Input value={f.timeline} onChange={set("timeline")} /></Field>
          <Field label="Next step"><Input value={f.next_action} onChange={set("next_action")} /></Field>
          <Field label="Next step at"><Input type="datetime-local" value={f.next_action_at} onChange={set("next_action_at")} /></Field>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Button variant="danger" size="sm" onClick={() => confirm("Delete this deal and its whole history?") && act(async () => {
            const r = await deleteDealAction(deal.id);
            if (r.ok) router.push("/sales/pipeline");
            return r;
          })}><Trash2 className="h-4 w-4" /> Delete</Button>
          <Button variant="primary" onClick={() => { save(); setEdit(false); }} disabled={busy}>Save</Button>
        </div>
      </Sheet>
      <StageMoveSheet pending={pendingMove} onDone={() => setPendingMove(null)} />
    </div>
  );
}

// channels stay neutral on purpose: colour is reserved for meaning (action, success, attention, urgent)
const CHANNEL_TINT: Record<string, string> = {};

function TimelineItem({ i, onDelete }: { i: InteractionRow; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const Dir = i.direction === "in" ? ArrowDownLeft : i.direction === "out" ? ArrowUpRight : Users;
  return (
    <li className="rounded-xl border border-border p-2.5">
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5 rounded-lg p-1", CHANNEL_TINT[i.channel] ?? "bg-muted text-subtle")}><ChannelIcon channel={i.channel} className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1 text-[11px] text-subtle">
            <Dir className="h-3 w-3" /> {CHANNEL_LABEL[i.channel] ?? i.channel} · {i.direction === "in" ? "from them" : i.direction === "out" ? "from you" : i.direction === "both" ? "both" : "note"} · {fmtDate(i.occurred_at)}
            {i.confidence === "assumed" ? <span title="Logged when you tapped a Daybook send link">· via link</span> : null}
            {i.person_name ? <span>· {i.person_name}</span> : null}
          </p>
          <p className="text-sm">{i.summary || i.subject || (i.body ?? "").slice(0, 200)}</p>
          {i.body && (i.summary || i.body.length > 200) ? (
            <button type="button" className="text-[11px] text-accent" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show full text"}</button>
          ) : null}
          {open ? <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 font-sans text-xs">{i.body}</pre> : null}
        </div>
        <button type="button" aria-label="Delete" onClick={() => confirm("Delete this entry?") && onDelete()} className="text-subtle/50 hover:text-bad"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </li>
  );
}

function Promises({ dealId, mine, theirs, onChange }: { dealId: number; mine: CommitmentRow[]; theirs: CommitmentRow[]; onChange: () => void }) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<"me" | "them">("me");
  const [due, setDue] = useState("");
  const [, start] = useTransition();
  const { toast } = useToast();
  const set = (id: number, s: "done" | "dropped") => start(async () => {
    await commitmentAction(id, s);
    onChange();
  });
  const List = ({ items, label }: { items: CommitmentRow[]; label: string }) => (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((c) => {
            const late = c.due_at && new Date(c.due_at).getTime() < Date.now();
            return (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <button type="button" aria-label="Done" onClick={() => set(c.id, "done")} className="mt-0.5 rounded border border-border p-0.5 hover:border-good hover:text-good"><Check className="h-3 w-3" /></button>
                <span className="flex-1">{c.text}{c.due_at ? <span className={cn("ml-1 text-xs", late ? "font-semibold text-bad" : "text-subtle")}>by {new Date(c.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span> : null}</span>
                <button type="button" aria-label="Drop" onClick={() => set(c.id, "dropped")} className="text-subtle/50 hover:text-bad"><X className="h-3.5 w-3.5" /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-subtle">None open.</p>}
    </div>
  );
  return (
    <div className="space-y-3">
      <List items={mine} label="You promised" />
      <List items={theirs} label="They promised" />
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <Select value={owner} onChange={(e) => setOwner(e.target.value as "me" | "them")} className="h-8 w-24 text-xs" aria-label="Who"><option value="me">I will</option><option value="them">They will</option></Select>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="send the proposal" className="h-8 min-w-0 flex-1 text-xs" />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-36 text-xs" />
        <Button size="sm" variant="outline" disabled={!text.trim()} onClick={() => start(async () => {
          const r = await addCommitmentAction(dealId, owner, text, due || null);
          if (!r.ok) return toast(r.error, "error");
          setText("");
          setDue("");
          onChange();
        })}><Plus className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function Payments({ dealId, currency, payments, onChange }: { dealId: number; currency: string; payments: PaymentRow[]; onChange: () => void }) {
  const [label, setLabel] = useState("Advance");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [, start] = useTransition();
  const { toast } = useToast();
  const paid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
  const total = payments.reduce((s, p) => s + Number(p.amount), 0);
  return (
    <div className="space-y-2">
      {payments.length ? <p className="text-xs text-subtle">{money(paid, currency)} of {money(total, currency)} received</p> : <p className="text-xs text-subtle">Payments appear here when a quote is accepted, or add them yourself. A deal is not done until it is paid.</p>}
      <ul className="space-y-1.5">
        {payments.map((p) => {
          const late = p.status === "due" && p.due_on && new Date(String(p.due_on)).getTime() < Date.now() - 86_400_000;
          return (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{p.label} <span className="text-xs text-subtle">{p.due_on ? `due ${String(p.due_on).slice(0, 10)}` : ""}</span></span>
              <span className={cn("tabular", late && "font-semibold text-bad")}>{money(p.amount, p.currency)}</span>
              {p.status === "paid" ? (
                <button type="button" onClick={() => start(async () => { await markPaidAction(p.id, new Date().toISOString().slice(0, 10), "due"); onChange(); })} className="rounded-full bg-good-muted px-2 text-xs text-good">paid</button>
              ) : (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => start(async () => {
                  const r = await markPaidAction(p.id, new Date().toISOString().slice(0, 10));
                  if (!r.ok) toast(r.error, "error");
                  onChange();
                })}>Mark paid</Button>
              )}
              <button type="button" aria-label="Delete payment" onClick={() => start(async () => { await deletePaymentAction(p.id); onChange(); })} className="text-subtle/50 hover:text-bad"><X className="h-3.5 w-3.5" /></button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 w-28 text-xs" />
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={currency} inputMode="decimal" className="h-8 w-24 text-xs" />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-36 text-xs" />
        <Button size="sm" variant="outline" disabled={!amount} onClick={() => start(async () => {
          const r = await addPaymentAction(dealId, label, Number(amount), currency, due || null);
          if (!r.ok) return toast(r.error, "error");
          setAmount("");
          onChange();
        })}><Plus className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function AddPerson({ dealId }: { dealId: number }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", title: "", email: "", phone: "", linkedin: "", role: "decision_maker", as: "member" as "primary" | "member" | "referrer" | "intermediary" });
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((c) => ({ ...c, [k]: e.target.value }));
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Add</Button>
      <Sheet open={open} onOpenChange={setOpen} title="Add a person to this deal">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={set("name")} autoFocus /></Field>
          <Field label="Title"><Input value={f.title} onChange={set("title")} /></Field>
          <Field label="Email"><Input value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone / WhatsApp"><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="LinkedIn"><Input value={f.linkedin} onChange={set("linkedin")} /></Field>
          <Field label="Their part">
            <Select value={f.as} onChange={set("as")}>
              <option value="member">Someone at the client</option>
              <option value="primary">Main contact</option>
              <option value="referrer">Referred me</option>
              <option value="intermediary">Intermediary / partner</option>
            </Select>
          </Field>
          {f.as === "member" || f.as === "primary" ? (
            <Field label="Role in decision">
              <Select value={f.role} onChange={set("role")}>
                {["decision_maker", "champion", "influencer", "user", "finance", "gatekeeper", "contact"].map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
              </Select>
            </Field>
          ) : f.as === "intermediary" ? (
            <Field label="Type">
              <Select value={f.role} onChange={set("role")}>{["agency", "broker", "consultant", "partner"].map((r) => <option key={r}>{r}</option>)}</Select>
            </Field>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" disabled={busy || !f.name.trim()} onClick={() => start(async () => {
            const r = await setPersonAction(dealId, f);
            if (!r.ok) return toast(r.error, "error");
            setOpen(false);
            router.refresh();
          })}>Add</Button>
        </div>
      </Sheet>
    </>
  );
}

function DocButtons({ dealId, companyId }: { dealId: number; companyId: number | null }) {
  const [busy, start] = useTransition();
  const [linkOpen, setLinkOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  const upload = (file: File) =>
    start(async () => {
      const r = await startFileAction(dealId, file.name, { name: file.name, mime: file.type, size: file.size });
      if (!r.ok) return toast(r.error, "error");
      const put = await fetch(r.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
      if (!put.ok) return toast("Upload failed. Is file storage set up (SUPABASE_SERVICE_ROLE_KEY)?", "error");
      toast("File ready. Copy its tracked link.");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => {
        const r = await createQuoteAction(dealId);
        if (!r.ok) return toast(r.error, "error");
        router.push(`/sales/docs/${r.id}`);
      })}><FileText className="h-3.5 w-3.5" /> Quote</Button>
      <Button size="sm" variant="ghost" onClick={() => setLinkOpen(true)}><Link2 className="h-3.5 w-3.5" /> Link</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> File</Button>
      {companyId ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => {
          toast("Auditing their website and writing the brief…");
          const r = await briefFromAuditAction(companyId, dealId);
          if (!r.ok) return toast(r.error, "error");
          router.push(`/sales/docs/${r.id}`);
        })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Brief</Button>
      ) : null}
      <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Sheet open={linkOpen} onOpenChange={setLinkOpen} title="Tracked link" description="Wrap a Loom, Drive file or case study. You get pinged when they open it.">
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Demo video" /></Field>
          <Field label="Real URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></Field>
          <div className="flex justify-end">
            <Button variant="primary" disabled={!url} onClick={() => start(async () => {
              const r = await createLinkAction(dealId, title || "Link", url);
              if (!r.ok) return toast(r.error, "error");
              setLinkOpen(false);
              setTitle("");
              setUrl("");
              router.refresh();
            })}>Create</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
