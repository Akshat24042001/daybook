"use client";
import { SalesChat } from "./sales-chat";
import { VoiceReady } from "./deal-rich";
import { InfoTip } from "@/components/info-tip";

import type { LinkGroup } from "@/lib/sales/quick-links-types";
import { QuickLinks } from "./quick-links";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, ExternalLink, FileText, Link2, Loader2, Pencil, Plus, Radar, Sparkles, Trash2, Upload, Users, X } from "lucide-react";
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
import { TeamSharing, VisibleTo, type Audience } from "./team-share";
import type { DealShare } from "@/lib/team/sharing";
import { EnrichmentPanel } from "./enrichment-panel";
import { MoveCard } from "./moves-view";
import { ActivityLogger, ClosingRecord, DealDetails, DealEditSheet, DocCategory, Journey, RecordEditSheet, StageMoveSheet, TimelineItem, type JourneyEvent, type PendingMove } from "./deal-rich";
import { COMPANY_EDIT_FIELDS, DOC_CATEGORIES, needsDetails, PERSON_EDIT_FIELDS, type FieldDef, type Reasons } from "@/lib/sales/fields";
import { updateCompanyAction, updatePersonAction } from "@/app/sales-actions";
import { FitCard, LineItems, PlaybookCard, type PackageOpt } from "./deal-extras";
import type { Fit } from "@/lib/sales/fit-calc";
import type { DealItem } from "@/lib/sales/items-calc";
import type { StagePlay } from "@/lib/sales/playbook-stages";
import { ago, ChannelIcon, CHANNEL_LABEL, CURRENCIES, currencyLabel, currencySymbol, fmtDate, Label, money, Priority } from "./util";

export interface QuotePackage { offerId: number; index: number; offer: string; name: string; currency: string; total: number; items: number; timeline: string; fits: boolean }

export interface DealPageData {
  deal: DealCard;
  /** the screenshots you shared that were filed to this deal */
  shots?: { capture_id: number; index: number; at: string; summary: string | null; source: string; author_user?: number | null; author_name?: string | null; shared_with?: number[] }[];
  /** salespeople who have (or could have) this lead */
  shares?: DealShare[];
  targets: (Stage & { requires: string })[];
  timeline: InteractionRow[];
  touches: { channel: string; last_at: string; last_in: string | null; count: number }[];
  commitments: CommitmentRow[];
  payments: PaymentRow[];
  docs: { id: number; slug: string; kind: string; title: string; status: string; shared_with?: number[]; author_user?: number | null; view_count: number; last_viewed_at: string | null; current_rev: number; total: number | null; currency: string | null; sent_at: string | null; category?: string | null; internal?: boolean }[];
  moves: MoveRow[];
  people: ({ id: number; full_name: string; title: string | null; role: string; emails: string[]; phones: string[]; linkedin: string | null; is_decision_maker: boolean | null } & Record<string, unknown>)[];
  company: ({ id: number; name: string; website: string | null; industry: string | null; country: string | null; employees: number | null; city?: string | null; region?: string | null; address?: string | null; postal_code?: string | null; phone?: string | null; email?: string | null; tax_id?: string | null } & Record<string, unknown> & { revenue_usd: number | null; revenue_is_estimate: boolean; enrichment: Enrichment; enriched_at: string | null; audit: { summary?: string; opportunities?: { title: string; problem: string; fix: string; impact: string; effort: string }[]; money_leak?: string; first_project?: string } | null }) | null;
  person: { id: number; full_name: string; enrichment: Enrichment; enriched_at: string | null } | null;
  /** your own company and person fields */
  companyDefs: FieldDef[];
  personDefs: FieldDef[];
  events: JourneyEvent[];
  /** choices for closing, parking and reopening (Sales settings > Reasons) */
  reasons: Reasons;
  /** your own deal fields */
  customDefs: FieldDef[];
  /** what a won deal's closing record still lacks */
  gaps: string[];
  fit: Fit | null;
  items: DealItem[];
  defaultTax: number;
  itemPackages: PackageOpt[];
  stageKey: string;
  play: StagePlay;
  ticked: string[];
  objections: { label: string; answer: string }[];
  owner: { name: string; company: string };
  /** pick-lists filled at load: pipelines and team members */
  choices: Record<string, [string, string][]>;
  meetings: { id: number; title: string; starts_at: string; link: string | null }[];
  companyFields: { group: string; fields: [string, string][] }[];
  personFields: { group: string; fields: [string, string][] }[];
  googleReady: boolean;
  voiceEnabled: boolean;
  /** company or person is on the do-not-contact list */
  blocked?: boolean;
  /** offer packages a quote can start from, best fit first */
  packages?: QuotePackage[];
  baseUrl: string;
  links: LinkGroup[];
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
  const [completing, setCompleting] = useState(false);
  const [edit, setEdit] = useState(false);
  const [editGroup, setEditGroup] = useState<string | undefined>(undefined);
  const [editPerson, setEditPerson] = useState<DealPageData["people"][number] | null>(null);
  const [editCompany, setEditCompany] = useState(false);
  const people = d.people.map((p) => ({ id: p.id, full_name: p.full_name, title: p.title }));
  const wonFields = d.customDefs.filter((c) => c.required_to_win);
  const customLabels = Object.fromEntries(d.customDefs.map((c) => [c.key.replace(/^custom\./, ""), c.label]));
  const openEdit = (g?: string) => { setEditGroup(g); setEdit(true); };
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

  const audience: Audience[] = (d.shares ?? []).filter((s) => s.shared && s.active).map((s) => ({ id: s.user_id, name: s.display_name }));
  const addedBy = (d.shares ?? []).find((s) => s.added_it);
  const dupHint = (deal as { dup_hint?: string | null }).dup_hint;
  const mine = d.commitments.filter((c) => c.owner === "me" && c.status === "open");
  const theirs = d.commitments.filter((c) => c.owner === "them" && c.status === "open");
  const net = deal.value_amount && deal.commission_value
    ? deal.commission_type === "percent" ? Number(deal.value_amount) * (1 - Number(deal.commission_value) / 100) : Number(deal.value_amount) - Number(deal.commission_value)
    : null;

  return (
    <VoiceReady.Provider value={d.voiceEnabled}>
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold" style={{ background: `${deal.stage_color}26`, borderColor: `${deal.stage_color}80` }}>
                <span className="h-2 w-2 rounded-full" style={{ background: deal.stage_color }} />{deal.stage_name}
              </span>
              <Priority value={deal.priority} prev={deal.priority_prev} why={deal.priority_why} />
              {d.fit ? <span title="Fit: how well they suit your business (see the Fit card)" className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", d.fit.grade === "A" ? "bg-p-mint text-p-mint-fg" : d.fit.grade === "B" ? "bg-p-sky text-p-sky-fg" : d.fit.grade === "C" ? "bg-p-butter text-p-butter-fg" : "bg-muted text-subtle")}>Fit {d.fit.grade} · {d.fit.score}</span> : null}
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
        {deal.radar_item_id ? <SendBackToRadar dealId={deal.id} /> : null}
        {addedBy ? <p className="mt-2 text-xs text-subtle">Added by <b className="text-fg">{addedBy.display_name}</b> (sales team)</p> : null}
        {dupHint ? <p className="mt-2 rounded-md bg-p-butter px-3 py-2 text-xs text-p-butter-fg">Possible duplicate: {dupHint}</p> : null}
        {d.blocked ? <p className="mt-3 rounded-md bg-p-rose px-3 py-2 text-xs text-p-rose-fg">Do not contact: no outreach moves. <a href="/sales/playbook#dnc" className="font-medium underline">Manage</a></p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-subtle">Move to:</span>
          {d.targets.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              onClick={() => (needsDetails({ category: deal.stage_category }, t, t.requires) ? setPendingMove({ deal, to: t, requires: t.requires }) : act(async () => (await import("@/app/sales-actions")).moveStageAction(deal.id, t.id), `Moved to ${t.name}`))}
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
            >
              {t.name}{t.requires !== "none" ? " *" : ""}
            </button>
          ))}
          <span className="ml-auto" />
          <SalesChat focus={{ deal_id: deal.id }} title={`Chat about ${deal.title}`} voiceEnabled={d.voiceEnabled} label="Chat about this lead" />
          <Button size="sm" variant="ghost" onClick={() => openEdit()}>Edit details</Button>
          {!d.blocked && (d.company?.website || deal.company_name || deal.person_name) ? (
            <Button size="sm" variant="ghost" className="text-bad hover:text-bad" title="Stop all outreach to them, now and in future radar leads"
              onClick={() => {
                const [kind, value] = d.company?.website ? ["domain", d.company.website] as const : deal.company_name ? ["company", deal.company_name] as const : ["person", deal.person_name!] as const;
                const why = prompt(`Never contact ${value} again? Optional: why (e.g. "asked not to be contacted").`, "");
                if (why === null) return;
                act(async () => (await import("@/app/sales-actions")).addBlockAction(kind, value, why || "from deal"), "Added to do-not-contact");
              }}>Do not contact</Button>
          ) : null}
        </div>
        {deal.priority_why?.length ? (
          <p className="mt-2 text-xs text-subtle">Why this priority: {deal.priority_why.join(" · ")}</p>
        ) : null}
        {d.touches.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            <span className="text-xs text-subtle">Last touch:</span>
            {d.touches.map((t) => (
              <span key={t.channel} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs" title={`${t.count} touches${t.last_in ? `, they last wrote ${ago(t.last_in)}` : ""}`}>
                <ChannelIcon channel={t.channel} className="h-3 w-3" /> {CHANNEL_LABEL[t.channel] ?? t.channel} {ago(t.last_at)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {d.links.length ? (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <QuickLinks groups={d.links} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <Section title="Where we are">
            {deal.summary ? <p className="whitespace-pre-line text-sm">{deal.summary}</p> : <p className="text-sm text-subtle">Log a conversation below and this fills itself.</p>}
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {deal.objections?.length ? <div className="sm:col-span-2"><dt className="text-subtle">Objections</dt><dd>{deal.objections.join(" · ")}</dd></div> : null}
              {deal.next_action ? <div className="sm:col-span-2"><dt className="text-subtle">Next step</dt><dd className="font-medium">{deal.next_action}{deal.next_action_at ? ` (${fmtDate(deal.next_action_at)})` : ""}</dd></div> : null}
            </dl>
          </Section>

          <ClosingRecord deal={deal} people={people} gaps={d.gaps} onComplete={() => setCompleting(true)} />

          <PlaybookCard key={d.stageKey} deal={deal} stageKey={d.stageKey} play={d.play} ticked={d.ticked} objections={d.objections} owner={d.owner} />

          <DealDetails deal={deal} people={people} customDefs={d.customDefs} onEdit={openEdit} choices={d.choices} />

          <LineItems deal={deal} items={d.items} defaultTax={d.defaultTax} packages={d.itemPackages} />

          {d.moves.length ? (
            <div>
              <Label>Moves for this deal</Label>
              <ul className="space-y-3">{d.moves.map((m) => <MoveCard key={m.id} m={m} googleReady={d.googleReady} onGone={() => router.refresh()} />)}</ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Log something</Label>
            <ActivityLogger dealId={deal.id} people={people} />
            <CaptureBox dealId={deal.id} voiceEnabled={d.voiceEnabled} compact placeholder={`Paste the latest chat with ${deal.person_name ?? "them"}, an email, or speak a debrief. Promises and next steps are picked out for you.`} />
          </div>

          <Section title={`Timeline · ${d.timeline.length}`}>
            {d.timeline.length ? (
              <ol className="space-y-2">
                {d.timeline.map((i) => <TimelineItem key={i.id} i={i} onDelete={() => act(() => deleteInteractionAction(i.id))} extra={<VisibleTo kind="interaction" id={i.id} sharedWith={i.shared_with ?? []} audience={audience} authorUser={i.author_user} authorName={i.author_name} />} />)}
              </ol>
            ) : <p className="text-sm text-subtle">No touches yet.</p>}
          </Section>
        </div>

        <div className="space-y-4">
          {d.fit ? <FitCard fit={d.fit} deal={deal} /> : null}

          {d.shares?.length ? <TeamSharing dealId={deal.id} shares={d.shares} /> : null}

          <Section title="Promises">
            <Promises dealId={deal.id} mine={mine} theirs={theirs} audience={audience} onChange={() => router.refresh()} />
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

          {d.shots?.length ? (
            <Section title={`Screenshots · ${d.shots.length}`}>
              <ul className="grid grid-cols-3 gap-2" aria-label="Screenshots you shared">
                {d.shots.map((x) => (
                  <li key={`${x.capture_id}-${x.index}`}>
                    <a href={`/api/sales/shot/${x.capture_id}/${x.index}`} target="_blank" rel="noreferrer" title={`${fmtDate(x.at)}${x.summary ? `: ${x.summary}` : ""}`} className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/sales/shot/${x.capture_id}/${x.index}`} alt={x.summary ?? "Screenshot"} loading="lazy" className="aspect-square w-full rounded-lg border border-border object-cover hover:border-accent" />
                      <span className="mt-0.5 block truncate text-[11px] text-subtle">{fmtDate(x.at)}{x.source === "telegram" ? " · Telegram" : ""}</span>
                    </a>
                    {x.index === 0 ? <VisibleTo kind="capture" id={x.capture_id} sharedWith={x.shared_with ?? []} audience={audience} authorUser={x.author_user} authorName={x.author_name} /> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Documents" action={<DocButtons dealId={deal.id} companyId={d.company?.id ?? null} packages={d.packages ?? []} />}>
            {d.docs.length ? (
              <ul className="space-y-2">
                {d.docs.map((x) => {
                  const url = x.kind === "link" ? `${d.baseUrl}/l/${x.slug}` : `${d.baseUrl}/q/${x.slug}`;
                  return (
                    <li key={x.id} className="rounded-xl border border-border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <Link href={x.internal ? `/api/sales/file/${x.slug}` : `/sales/docs/${x.id}`} target={x.internal ? "_blank" : undefined} className="text-sm font-medium hover:text-accent">
                            {x.kind === "quote" ? <FileText className="mr-1 inline h-3.5 w-3.5" /> : <Link2 className="mr-1 inline h-3.5 w-3.5" />}
                            {x.title}{x.kind === "quote" ? ` v${x.current_rev}` : ""}
                          </Link>
                          <DocCategory category={DOC_CATEGORIES.find(([k]) => k === x.category)?.[1] ?? x.category} internal={x.internal} />
                        </span>
                        <Chip className={cn(x.status === "accepted" && "bg-p-mint text-p-mint-fg", x.status === "viewed" && "bg-p-sky text-p-sky-fg", x.status === "changes" && "bg-p-butter text-p-butter-fg")}>{x.status}</Chip>
                      </div>
                      <p className="mt-0.5 text-xs text-subtle">
                        {x.total ? `${money(x.total, x.currency ?? deal.currency)} · ` : ""}{x.view_count ? `opened ${x.view_count}x, last ${ago(x.last_viewed_at)}` : x.sent_at ? "not opened yet" : "draft"}
                      </p>
                      <VisibleTo kind="doc" id={x.id} sharedWith={x.shared_with ?? []} audience={audience} authorUser={x.author_user} authorName={null} />
                      <div className={cn("mt-1.5 flex items-center gap-1", x.internal && "hidden")}>
                        <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{url.replace(/^https?:\/\//, "")}</code>
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
                  <span className="flex shrink-0 gap-1">
                    <button type="button" aria-label={`Edit ${p.full_name}`} onClick={() => setEditPerson(p)} className="text-subtle hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label="Remove from deal" onClick={() => act(() => removeDealPersonAction(deal.id, p.id))} className="text-subtle hover:text-bad"><X className="h-3.5 w-3.5" /></button>
                  </span>
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

          {d.company ? (
            <Section title={`Company: ${d.company.name}`} action={<Button size="sm" variant="ghost" onClick={() => setEditCompany(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}>
              <dl className="grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-2">
                {([
                  ["Industry", d.company.industry], ["Employees", d.company.employees ? String(d.company.employees) : null],
                  ["Location", [d.company.city, d.company.region, d.company.country].filter(Boolean).join(", ")], ["PIN / postal code", d.company.postal_code],
                  ["Phone", d.company.phone], ["Email", d.company.email], ["GST / tax ID", d.company.tax_id], ["Website", d.company.website],
                  ...d.companyDefs.map((c) => [c.label, (() => { const v = ((d.company!.custom ?? {}) as Record<string, unknown>)[c.key.replace(/^custom\./, "")]; return v === null || v === undefined ? null : Array.isArray(v) ? v.join(", ") : String(v); })()]),
                ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-subtle">{k}</dt><dd className="break-words">{v}</dd></div>)}
                {d.company.address ? <div className="sm:col-span-2"><dt className="text-subtle">Address</dt><dd className="whitespace-pre-line">{d.company.address}</dd></div> : null}
              </dl>
              {!d.company.city && !d.company.address && !d.company.tax_id ? <p className="mt-2 text-xs text-subtle">No address or GST yet. Edit to add them.</p> : null}
            </Section>
          ) : null}

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

          <Journey events={d.events} created={deal.created_at} customLabels={customLabels} />
        </div>
      </div>

      {d.company ? <EnrichmentPanel kind="company" id={d.company.id} data={d.company.enrichment} groups={d.companyFields} enrichedAt={d.company.enriched_at} title={`Company: ${d.company.name}`} /> : null}
      {d.person ? <EnrichmentPanel kind="person" id={d.person.id} data={d.person.enrichment} groups={d.personFields} enrichedAt={d.person.enriched_at} title={`Person: ${d.person.full_name}`} /> : null}

      <DealEditSheet deal={deal} people={people} customDefs={d.customDefs} open={edit} onOpenChange={setEdit} focusGroup={editGroup} choices={d.choices}
        footer={<Button variant="danger" size="sm" onClick={() => confirm("Delete this deal and its whole history?") && act(async () => {
          const r = await deleteDealAction(deal.id);
          if (r.ok) router.push("/sales/pipeline");
          return r;
        })}><Trash2 className="h-4 w-4" /> Delete</Button>} />
      <StageMoveSheet pending={pendingMove} onDone={() => setPendingMove(null)} reasons={d.reasons} people={people} wonFields={wonFields} />
      {editPerson ? (
        <RecordEditSheet title={editPerson.full_name} description="Every change is saved to this person, across all their deals." fields={PERSON_EDIT_FIELDS} customDefs={d.personDefs}
          record={editPerson} onSave={(patch) => updatePersonAction(editPerson.id, patch)} onClose={() => setEditPerson(null)} />
      ) : null}
      {editCompany && d.company ? (
        <RecordEditSheet title={d.company.name} description="Company details, shared by every deal with them." fields={COMPANY_EDIT_FIELDS} customDefs={d.companyDefs}
          record={d.company} onSave={(patch) => updateCompanyAction(d.company!.id, patch)} onClose={() => setEditCompany(false)} />
      ) : null}
      <StageMoveSheet pending={completing ? { deal, to: d.targets[0] ?? ({ id: deal.stage_id, name: deal.stage_name, category: deal.stage_category } as never), requires: "none" } : null}
        onDone={() => setCompleting(false)} reasons={d.reasons} people={people} wonFields={wonFields} complete />
    </div>
    </VoiceReady.Provider>
  );
}

function Promises({ dealId, mine, theirs, audience, onChange }: { dealId: number; mine: CommitmentRow[]; theirs: CommitmentRow[]; audience: Audience[]; onChange: () => void }) {
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
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{label}</p>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((c) => {
            const late = c.due_at && new Date(c.due_at).getTime() < Date.now();
            return (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <button type="button" aria-label="Done" onClick={() => set(c.id, "done")} className="mt-0.5 rounded border border-border p-0.5 hover:border-good hover:text-good"><Check className="h-3 w-3" /></button>
                <span className="flex-1">{c.text}{c.due_at ? <span className={cn("ml-1 text-xs", late ? "font-semibold text-bad" : "text-subtle")}>by {new Date(c.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span> : null}</span>
                <VisibleTo kind="commitment" id={c.id} sharedWith={c.shared_with ?? []} audience={audience} authorUser={c.author_user} authorName={c.author_name} />
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

/** For a radar lead turned into a deal by mistake: puts it back on the radar, as if it had never been touched. */
function SendBackToRadar({ dealId }: { dealId: number }) {
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2 text-xs text-subtle">
      <span>Came from the radar. Made into a deal by mistake, with no real conversation yet?</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
        const { sendBackToRadarAction } = await import("@/app/sales-actions");
        const check = await sendBackToRadarAction(dealId, true);
        if (!check.ok) return toast(check.error, "error");
        if (!check.result.ok) return toast(check.result.reason ?? "This deal cannot go back to the radar.", "error");
        const n = check.result.messages;
        const ok = confirm(`Send this lead back to the radar?\n\nThe deal is removed${n ? `, with the ${n} message${n === 1 ? "" : "s"} logged on it` : ""}, and the lead shows on Radar again as a new lead you have not contacted.`);
        if (!ok) return;
        const r = await sendBackToRadarAction(dealId);
        if (!r.ok) return toast(r.error, "error");
        if (!r.result.ok) return toast(r.result.reason ?? "This deal cannot go back to the radar.", "error");
        toast("Back on the radar as a new lead");
        router.push("/sales/radar");
      })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />} Send back to Radar</Button>
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
      {payments.length ? <p className="text-xs text-subtle">{money(paid, currency)} of {money(total, currency)} received</p> : <p className="text-xs text-subtle">None yet. They appear when a quote is accepted, or add one.</p>}
      <ul className="space-y-1.5">
        {payments.map((p) => {
          const late = p.status === "due" && p.due_on && new Date(String(p.due_on)).getTime() < Date.now() - 86_400_000;
          return (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{p.label} <span className="text-xs text-subtle">{p.due_on ? `due ${String(p.due_on).slice(0, 10)}` : ""}</span></span>
              <span className={cn("tabular", late && "font-semibold text-bad")}>{money(p.amount, p.currency)}</span>
              {p.status === "paid" ? (
                <button type="button" onClick={() => start(async () => { await markPaidAction(p.id, new Date().toISOString().slice(0, 10), "due"); onChange(); })} className="rounded-md bg-good-muted px-2 text-xs text-good">paid</button>
              ) : (
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => start(async () => {
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
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${currencySymbol(currency)} amount`} inputMode="decimal" className="h-8 w-24 text-xs" />
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

function DocButtons({ dealId, companyId, packages }: { dealId: number; companyId: number | null; packages: QuotePackage[] }) {
  const [busy, start] = useTransition();
  const [pickPkg, setPickPkg] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  const [picked, setPicked] = useState<File | null>(null);
  const [meta, setMeta] = useState({ title: "", category: "other", internal: false });
  const choose = (file: File) => {
    const guess = /contract|agreement|signed/i.test(file.name) ? "contract" : /(^|[^a-z])po([^a-z]|$)|purchase/i.test(file.name) ? "po" : /invoice/i.test(file.name) ? "invoice" : /(^|[^a-z])nda([^a-z]|$)/i.test(file.name) ? "nda" : /proposal|quote/i.test(file.name) ? "proposal" : "other";
    setMeta({ title: file.name.replace(/\.[a-z0-9]+$/i, ""), category: guess, internal: ["contract", "po", "invoice", "receipt", "nda"].includes(guess) });
    setPicked(file);
  };
  const upload = (file: File) =>
    start(async () => {
      const r = await startFileAction(dealId, meta.title || file.name, { name: file.name, mime: file.type, size: file.size }, { category: meta.category, internal: meta.internal });
      if (!r.ok) return toast(r.error, "error");
      const put = await fetch(r.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
      if (!put.ok) return toast("Upload failed. Is file storage set up (SUPABASE_SERVICE_ROLE_KEY)?", "error");
      toast(meta.internal ? "Saved on the deal (internal)." : "File ready. Copy its tracked link.");
      setPicked(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => (packages.length ? setPickPkg(true) : start(async () => {
        const r = await createQuoteAction(dealId);
        if (!r.ok) return toast(r.error, "error");
        router.push(`/sales/docs/${r.id}`);
      }))}><FileText className="h-3.5 w-3.5" /> Quote</Button>
      <Sheet open={pickPkg} onOpenChange={setPickPkg} title="Start a quote" description="From a package in your offer catalogue, or blank. You can edit everything before sending.">
        <ul className="space-y-1.5">
          {packages.map((p) => (
            <li key={`${p.offerId}:${p.index}`}>
              <button type="button" disabled={busy} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-sm hover:bg-muted"
                onClick={() => start(async () => {
                  const r = await createQuoteAction(dealId, { offerId: p.offerId, index: p.index });
                  if (!r.ok) return toast(r.error, "error");
                  router.push(`/sales/docs/${r.id}`);
                })}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.offer} · {p.name}</span>
                  <span className="block text-xs text-subtle">{p.items} line item{p.items === 1 ? "" : "s"}{p.timeline ? ` · ${p.timeline}` : ""}{p.fits ? " · matches this deal" : ""}</span>
                </span>
                <span className="shrink-0 tabular text-sm">{money(p.total, p.currency)}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" disabled={busy} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-subtle hover:bg-muted"
              onClick={() => start(async () => {
                const r = await createQuoteAction(dealId);
                if (!r.ok) return toast(r.error, "error");
                router.push(`/sales/docs/${r.id}`);
              })}>Blank quote (one line from the deal value)</button>
          </li>
        </ul>
      </Sheet>
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
      <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} aria-label="Choose a file" />
      <Sheet open={!!picked} onOpenChange={(o) => !o && setPicked(null)} title="Attach a document" description={picked ? `${picked.name} · ${(picked.size / 1024 / 1024).toFixed(1)} MB` : undefined}>
        <div className="space-y-3">
          <Field label="Name"><Input value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} aria-label="Document name" /></Field>
          <Field label="What it is">
            <Select value={meta.category} onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))} aria-label="Document type">
              {DOC_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={meta.internal} onChange={(e) => setMeta((m) => ({ ...m, internal: e.target.checked }))} />
            <span>For me only <span className="text-subtle">(contract, PO, invoice)</span></span>
            <InfoTip label="About internal documents">Internal documents stay on the deal for you only. Untick to get a tracked link you can send to the client.</InfoTip>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => picked && upload(picked)}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload</Button>
          </div>
        </div>
      </Sheet>
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
