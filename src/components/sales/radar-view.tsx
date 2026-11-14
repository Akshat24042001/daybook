"use client";

import { Ban, CheckCircle2, Eye, EyeOff, ExternalLink, Loader2, Plus, Radar, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addRadarItemAction, addSourceAction, digestNowAction, radarDraftAction, radarHideAction, radarStatusAction, radarToDealAction, runRadarAction, toggleSourceAction,
  addBlockAction,
} from "@/app/sales-actions";
import { Button, Chip, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { MoveRow } from "@/lib/sales/moves";
import { platformOf } from "@/lib/sales/reply-targets";
import type { LinkGroup } from "@/lib/sales/quick-links-types";
import { QuickLinks } from "./quick-links";
import { ago } from "./util";
import { MoveCard } from "./moves-view";
import { HuntsPanel } from "./hunts-view";
import { PlanPanel } from "./plan-panel";
import { ResearchSheet } from "./research-sheet";
import { PosterLine, WhoPanel, dayHeader, whenLabel, type Poster, type WhoIdentity } from "./radar-who";
import type { RadarPlan } from "@/lib/sales/radar-plan";
import type { HuntView } from "@/lib/sales/hunts";

export interface RadarItem {
  id: number; title: string; body: string | null; url: string | null; score: number | null; status: string; found_at: string; posted_at: string | null;
  source: string | null; category: string | null; deal_id: number | null; hunt?: string | null; hidden?: boolean; company_id?: number | null; researched_at?: string | null;
  fit: { why?: string; angle?: string; money_leak?: string | null; country?: string; industry?: string; services?: string[]; buyer?: string; budget?: string | null; urgency?: string; company?: string | null; website?: string | null; contact?: string | null } | null;
  known?: { deal_id: number | null; deal_title: string | null; stage: string | null; category: string | null; lost_reason: string | null; why: string } | null;
  blocked?: string | null;
  links?: LinkGroup[];
  poster?: Poster | null;
  identity?: WhoIdentity | null;
}

/** Marketplaces where replying costs bids, credits or connects. */
const PAID = new Set(["upwork", "freelancer", "pph", "guru"]);
const isPaid = (url: string | null) => PAID.has(platformOf(url)?.key ?? "") || /fiverr\.com|truelancer\.com|workana\.com/.test(url ?? "");
const canReachDirectly = (it: RadarItem) => !!(it.identity && (it.identity.emails.length || it.identity.phones.length || it.identity.linkedin));
export interface SourceRow {
  id: number; key: string; name: string; kind: string; category: string; enabled: boolean; interval_hours: number; note: string | null;
  last_run_at: string | null; last_ok_at: string | null; last_error: string | null; items_found: number; items_qualified: number; deals_created: number;
}

function ItemCard({ it, googleReady, tz }: { it: RadarItem; googleReady: boolean; tz: string }) {
  const [move, setMove] = useState<MoveRow | null>(null);
  const [busy, start] = useTransition();
  const [gone, setGone] = useState(false);
  const [research, setResearch] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  if (gone) return null;
  const f = it.fit ?? {};
  const where = platformOf(it.url);
  const paid = isPaid(it.url);
  const at = it.posted_at ?? it.found_at;
  const fresh = Date.now() - new Date(at).getTime() < 24 * 3_600_000;
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, hide = true) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast((r as { error: string }).error, "error");
    if (hide) setGone(true);
    router.refresh();
  });
  return (
    <li className={cn("rounded-2xl border border-border bg-surface p-3", it.hidden && "border-dashed opacity-60")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-sm tabular", (it.score ?? 0) >= 75 ? "bg-p-mint text-p-mint-fg" : (it.score ?? 0) >= 60 ? "bg-p-sky text-p-sky-fg" : "bg-muted text-subtle")}>
          {it.score ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs" aria-label="When">
            {fresh ? <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-fg">New</span> : null}
            <time dateTime={new Date(at).toISOString()} className="font-semibold text-fg">{it.posted_at ? "Posted" : "Found"} {whenLabel(at, tz)}</time>
            <span className="text-subtle">({ago(at)})</span>
            {it.posted_at && Math.abs(new Date(it.found_at).getTime() - new Date(it.posted_at).getTime()) > 6 * 3_600_000 ? <span className="text-subtle">· found {ago(it.found_at)}</span> : null}
          </p>
          <p className="text-sm font-semibold leading-snug">{it.title}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-subtle">
            {it.hunt ? <span className="font-medium text-p-teal-fg">🔎 {it.hunt}</span> : null}<span>{it.source ?? "manual"}</span>{it.category ? <span>{it.category}</span> : null}
            {f.country ? <span>{f.country}</span> : null}{f.industry ? <span>{f.industry}</span> : null}
          </p>
          <PosterLine p={it.poster} />
          {it.blocked ? <p className="mt-1.5 rounded-md bg-p-rose px-2 py-1 text-xs text-p-rose-fg">{it.blocked}</p> : null}
          {it.known ? (
            <p className="mt-1.5 rounded-md bg-p-sky px-2 py-1 text-xs text-p-sky-fg">
              You already know them ({it.known.why})
              {it.known.deal_id ? <> · <a href={`/sales/deal/${it.known.deal_id}`} className="font-medium underline">{it.known.deal_title}</a>, {it.known.stage}{it.known.lost_reason ? ` (lost: ${it.known.lost_reason})` : ""}</> : null}
              {it.known.deal_id && (it.known.category === "open" || it.known.category === "parked") ? ". Making it a lead adds it to that deal." : it.known.category === "won" ? ". An existing client: making it a lead starts a new deal (repeat business)." : null}
            </p>
          ) : null}
          {where && !paid ? (
            <p className="mt-1 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{where.replyable ? `Reply on ${where.name}` : where.key === "email_alert" ? "From an alert email" : "Signal, nobody asked you"}</span>{" "}
              <span className="text-subtle">{where.replyable ? "Answer them where they posted." : "Find the decision maker first, then reach out."}</span>
            </p>
          ) : null}
          {!it.known && !it.deal_id ? <WhoPanel itemId={it.id} identity={it.identity} paid={paid} platform={where?.name ?? null} /> : null}
          {f.why ? <p className="mt-1 text-xs">{f.why}</p> : null}
          {f.angle ? <p className="mt-1 text-xs text-accent">💡 {f.angle}</p> : null}
          {f.money_leak ? <p className="mt-1 rounded-lg bg-p-butter px-2 py-1 text-xs text-p-butter-fg">{f.money_leak}</p> : null}
          {f.services?.length ? <div className="mt-1 flex flex-wrap gap-1">{f.services.map((s) => <Chip key={s} className="text-[10px]">{s}</Chip>)}</div> : null}
          {it.body ? <details className="mt-1"><summary className="cursor-pointer text-xs text-subtle">Full post</summary><p className="mt-1 whitespace-pre-line text-xs text-subtle">{it.body.slice(0, 2500)}</p></details> : null}
          {it.links?.length ? <div className="mt-2 rounded-xl bg-muted/50 p-2.5"><QuickLinks groups={it.links} fold={2} /></div> : null}
        </div>
      </div>
      {move ? <div className="mt-3"><MoveCard m={move} googleReady={googleReady} onGone={() => setGone(true)} /></div> : null}
      {research ? <ResearchSheet open onOpenChange={setResearch} radarItemId={it.id} companyId={it.company_id ?? undefined} title={it.title.slice(0, 60)} /> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => setResearch(true)} title="Everything known about the company and the people behind this lead">
          {it.researched_at ? <CheckCircle2 className="h-3.5 w-3.5 text-good" /> : it.company_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {it.researched_at ? "Research" : it.company_id ? "Researching…" : "Research"}
        </Button>
        {!move && !(paid && !canReachDirectly(it)) ? <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
          const r = await radarDraftAction(it.id);
          if (!r.ok) return toast(r.error, "error");
          setMove(r.move);
        })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {paid ? "Draft a direct message" : where?.replyable ? `Draft reply for ${where.name}` : "Draft first message"}</Button> : null}
        {it.deal_id ? <Button size="sm" variant="outline" onClick={() => router.push(`/sales/deal/${it.deal_id}`)}>Open deal</Button> : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
            const r = await radarToDealAction(it.id);
            if (!r.ok) return toast(r.error, "error");
            router.push(`/sales/deal/${r.id}`);
          })}><Plus className="h-3.5 w-3.5" /> Make it a lead</Button>
        )}
        {it.url?.startsWith("http") ? <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-xl px-3 text-xs text-accent hover:bg-muted">Open <ExternalLink className="h-3 w-3" /></a> : null}
        <Button size="sm" variant="ghost" onClick={() => act(() => radarHideAction([it.id], !it.hidden), false)}>
          {it.hidden ? <><Eye className="h-3.5 w-3.5" /> Unhide</> : <><EyeOff className="h-3.5 w-3.5" /> Hide</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act(() => radarStatusAction(it.id, "skipped"))}>Skip</Button>
        <Button size="sm" variant="ghost" onClick={() => act(() => radarStatusAction(it.id, "rejected"))}>Not relevant</Button>
        {!it.blocked && (f.website || f.company || f.contact) ? (
          <Button size="sm" variant="ghost" className="text-bad hover:text-bad" title="Add them to your do-not-contact list: this lead and any future one from them are dropped"
            onClick={() => {
              const [kind, value] = f.website ? ["domain", f.website] as const : f.company ? ["company", f.company] as const : ["person", f.contact!] as const;
              if (!confirm(`Never contact ${value}? Future leads from them are dropped and no outreach moves are made. You can undo this in Sales > Playbook.`)) return;
              act(() => addBlockAction(kind, value, "from radar"));
            }}>
            <Ban className="h-3.5 w-3.5" /> Never contact
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function RadarView({ items, sources, googleReady, focus, searchProviders, hunts, plan, searchCap, tz }: { items: RadarItem[]; sources: SourceRow[]; googleReady: boolean; focus: { country: string; industry: string }; searchProviders: string[]; hunts: HuntView[]; plan: RadarPlan; searchCap: number; tz: string }) {
  const [tab, setTab] = useState<"qualified" | "new" | "rejected" | "hunts" | "plan" | "sources">("qualified");
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<"newest" | "best">("newest");
  const [only, setOnly] = useState<"all" | "direct" | "free" | "paid">("all");
  const [busy, start] = useTransition();
  const [add, setAdd] = useState(false);
  const [paste, setPaste] = useState({ title: "", body: "", url: "" });
  const [src, setSrc] = useState({ name: "", kind: "rss" as "rss" | "search" | "reddit" | "gnews", value: "", category: "requirement" });
  const { toast } = useToast();
  const router = useRouter();
  const hiddenCount = items.filter((i) => i.hidden).length;
  const visible = showHidden ? items : items.filter((i) => !i.hidden);
  const when = (i: RadarItem) => new Date(i.posted_at ?? i.found_at).getTime();
  const list = visible
    .filter((i) => (tab === "qualified" ? i.status === "qualified" : tab === "new" ? i.status === "new" : ["rejected", "skipped"].includes(i.status)))
    .filter((i) => (only === "direct" ? canReachDirectly(i) : only === "paid" ? isPaid(i.url) : only === "free" ? !isPaid(i.url) : true))
    .sort((a, b) => (sort === "newest" ? when(b) - when(a) : (b.score ?? -1) - (a.score ?? -1) || when(b) - when(a)));
  // newest first: grouped under Today, Yesterday, then the date
  const groups: [string, RadarItem[]][] = [];
  for (const it of list) {
    const h = sort === "newest" ? dayHeader(it.posted_at ?? it.found_at, tz) : "";
    const last = groups[groups.length - 1];
    if (last && last[0] === h) last[1].push(it);
    else groups.push([h, [it]]);
  }
  const counts = { qualified: visible.filter((i) => i.status === "qualified").length, new: visible.filter((i) => i.status === "new").length, rejected: visible.filter((i) => ["rejected", "skipped"].includes(i.status)).length };
  const broken = sources.filter((s) => s.enabled && s.last_error).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">Radar</h1>
          <p className="text-sm text-subtle">{sources.filter((s) => s.enabled).length} sources on · focus this week <b>{focus.country}</b>, today <b>{focus.industry}</b> · search: {searchProviders.join(", ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdd(true)}><Plus className="h-4 w-4" /> Paste a lead</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
            const r = await digestNowAction();
            toast(r.ok ? `Digest: ${r.result}` : r.error, r.ok ? "ok" : "error");
            router.refresh();
          })}>Send digest now</Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
            toast("Crawling and scoring. Up to a minute…");
            const r = await runRadarAction();
            toast(r.ok ? `${r.added} new, ${r.scored} scored` : r.error, r.ok ? "ok" : "error");
            router.refresh();
          })}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Run now</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {([["qualified", `Qualified · ${counts.qualified}`], ["new", `Scoring · ${counts.new}`], ["rejected", `Below the bar · ${counts.rejected}`], ["hunts", `Hunts · ${hunts.filter((h) => h.enabled).length} on`], ["plan", "Plan & platforms"], ["sources", `Sources${broken ? ` · ${broken} failing` : ""}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-md border px-3 py-1 text-xs", tab === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>{l}</button>
        ))}
      </div>
      {["qualified", "new", "rejected"].includes(tab) ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-subtle">
          <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Order">
            {([["newest", "Newest first"], ["best", "Best match"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={cn("px-2.5 py-1", sort === k ? "bg-accent-muted font-medium text-accent" : "hover:bg-muted")}>{l}</button>
            ))}
          </span>
          <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Show">
            {([["all", "All"], ["direct", "Contact found"], ["free", "Free to reply"], ["paid", "Paid sites"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setOnly(k)} aria-pressed={only === k} className={cn("px-2.5 py-1", only === k ? "bg-accent-muted font-medium text-accent" : "hover:bg-muted")}>{l}</button>
            ))}
          </span>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden leads ({hiddenCount})</label>
          {list.some((i) => !i.hidden) ? (
            <button type="button" className="rounded-md border border-border px-2.5 py-1 hover:bg-muted" disabled={busy} onClick={() => start(async () => {
              const ids = list.filter((i) => !i.hidden).map((i) => i.id);
              if (ids.length > 3 && !confirm(`Hide all ${ids.length} leads in this list? You can bring them back with “Show hidden leads”.`)) return;
              const r = await radarHideAction(ids, true);
              toast(r.ok ? `Hid ${r.changed} lead${r.changed === 1 ? "" : "s"}` : r.error, r.ok ? "ok" : "error");
              router.refresh();
            })}>Hide all in this list</button>
          ) : null}
          {showHidden && list.some((i) => i.hidden) ? (
            <button type="button" className="rounded-md border border-border px-2.5 py-1 hover:bg-muted" disabled={busy} onClick={() => start(async () => {
              const r = await radarHideAction(list.filter((i) => i.hidden).map((i) => i.id), false);
              toast(r.ok ? `Unhid ${r.changed}` : r.error, r.ok ? "ok" : "error");
              router.refresh();
            })}>Unhide all shown</button>
          ) : null}
        </div>
      ) : null}
      {tab === "plan" ? (
        <PlanPanel plan={plan} />
      ) : tab === "hunts" ? (
        <HuntsPanel hunts={hunts} searchCap={searchCap} providers={searchProviders} tz={tz} />
      ) : tab !== "sources" ? (
        list.length ? (
          <div className="space-y-5">
            {groups.map(([h, its]) => (
              <section key={h || "all"} aria-label={h || "Leads"}>
                {h ? <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">{h}<span className="text-xs font-normal text-subtle">{its.length} lead{its.length === 1 ? "" : "s"}</span></h2> : null}
                <ul className="grid gap-3 lg:grid-cols-2">{its.map((it) => <ItemCard key={it.id} it={it} googleReady={googleReady} tz={tz} />)}</ul>
              </section>
            ))}
          </div>
        )
          : <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-subtle">Nothing here yet. The radar runs every 15 minutes; the morning digest always brings at least one opportunity.</p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-muted text-left text-subtle"><tr><th className="p-2">On</th><th className="p-2">Source</th><th className="p-2">Type</th><th className="p-2">Every</th><th className="p-2">Last run</th><th className="p-2 text-right">Found</th><th className="p-2 text-right">Qualified</th><th className="p-2 text-right">Deals</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-t border-border align-top">
                    <td className="p-2"><input type="checkbox" checked={s.enabled} onChange={(e) => start(async () => { await toggleSourceAction(s.id, e.target.checked); router.refresh(); })} aria-label={`Toggle ${s.name}`} /></td>
                    <td className="p-2"><p className="font-medium">{s.name}</p>{s.note ? <p className="text-subtle">{s.note}</p> : null}{s.last_error ? <p className="text-bad">{s.last_error.slice(0, 120)}</p> : null}</td>
                    <td className="p-2">{s.category}<br /><span className="text-subtle">{s.kind}</span></td>
                    <td className="p-2">{s.kind === "email" ? "on arrival" : `${s.interval_hours}h`}</td>
                    <td className="p-2">{s.kind === "email" ? "" : ago(s.last_run_at)}</td>
                    <td className="p-2 text-right tabular">{s.items_found}</td><td className="p-2 text-right tabular">{s.items_qualified}</td><td className="p-2 text-right tabular">{s.deals_created}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-3">
            <p className="mb-2 text-sm font-semibold">Add a source</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_120px_1.4fr_130px_auto]">
              <Input value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} placeholder="Name" className="h-9 text-sm" />
              <Select value={src.kind} onChange={(e) => setSrc({ ...src, kind: e.target.value as typeof src.kind })} className="h-9 text-sm"><option value="rss">RSS feed</option><option value="search">Web search</option><option value="reddit">Subreddit</option><option value="gnews">Google News</option></Select>
              <Input value={src.value} onChange={(e) => setSrc({ ...src, value: e.target.value })} placeholder={src.kind === "rss" ? "https://…/feed" : src.kind === "reddit" ? "subreddit name" : "query, {country} and {industry} allowed"} className="h-9 text-sm" />
              <Select value={src.category} onChange={(e) => setSrc({ ...src, category: e.target.value })} className="h-9 text-sm">{["requirement", "hiring", "funding", "review", "tender", "launch"].map((c) => <option key={c}>{c}</option>)}</Select>
              <Button size="sm" variant="outline" onClick={() => start(async () => {
                const r = await addSourceAction(src);
                if (!r.ok) return toast(r.error, "error");
                setSrc({ ...src, name: "", value: "" });
                router.refresh();
              })}>Add</Button>
            </div>
          </div>
        </div>
      )}
      <Sheet open={add} onOpenChange={setAdd} title="Paste a lead" description="A post, a requirement, a job ad: it is scored like everything else.">
        <div className="space-y-3">
          <Field label="Title"><Input value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} /></Field>
          <Field label="Text"><Textarea value={paste.body} onChange={(e) => setPaste({ ...paste, body: e.target.value })} /></Field>
          <Field label="Link"><Input value={paste.url} onChange={(e) => setPaste({ ...paste, url: e.target.value })} /></Field>
          <div className="flex justify-end"><Button variant="primary" disabled={busy || !paste.title} onClick={() => start(async () => {
            const r = await addRadarItemAction(paste.title, paste.body, paste.url);
            if (!r.ok) return toast(r.error, "error");
            setAdd(false);
            setPaste({ title: "", body: "", url: "" });
            router.refresh();
          })}>Score it</Button></div>
        </div>
      </Sheet>
    </div>
  );
}
