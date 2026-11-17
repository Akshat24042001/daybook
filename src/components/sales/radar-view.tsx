"use client";

import { Loader2, Plus, Radar, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addRadarItemAction, addSourceAction, digestNowAction, runRadarAction, searchRadarAction, toggleSourceAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { haystack, matchesAll, searchTerms } from "@/lib/sales/find-match";
import type { LinkGroup } from "@/lib/sales/quick-links-types";
import { ago } from "./util";
import { HuntsPanel } from "./hunts-view";
import { PlanPanel } from "./plan-panel";
import { RadarBoard } from "./radar-board";
import type { Poster, WhoIdentity } from "./radar-who";
import type { RadarBrief } from "@/lib/sales/radar-brief";
import type { Prep } from "@/lib/sales/radar-prep";
import type { RadarPlan } from "@/lib/sales/radar-plan";
import type { HuntView } from "@/lib/sales/hunts";
import { Ago } from "@/components/sales/ago";

export interface RadarItem {
  id: number; title: string; body: string | null; url: string | null; score: number | null; status: string; found_at: string; posted_at: string | null;
  source: string | null; category: string | null; deal_id: number | null; hunt?: string | null; hidden?: boolean; company_id?: number | null; researched_at?: string | null;
  fit: { why?: string; angle?: string; money_leak?: string | null; country?: string; industry?: string; services?: string[]; buyer?: string; budget?: string | null; urgency?: string; company?: string | null; website?: string | null; contact?: string | null } | null;
  known?: { deal_id: number | null; deal_title: string | null; stage: string | null; category: string | null; lost_reason: string | null; why: string } | null;
  blocked?: string | null;
  links?: LinkGroup[];
  poster?: Poster | null;
  identity?: WhoIdentity | null;
  brief?: RadarBrief | null;
  seen_at?: string | null;
  author?: string | null;
  prep?: Prep | null;
  ready_draft?: string | null;
  ready_subject?: string | null;
  ready_channel?: string | null;
  hunt_id?: number | null;
  /** post: someone wrote it; prospect: a local business found for a target; news: local news about a business */
  lead_kind?: "post" | "prospect" | "news" | "signal" | null;
  trip?: { city: string; from: string; to: string } | null;
  meeting_at?: string | null;
}

export interface SourceRow {
  id: number; key: string; name: string; kind: string; category: string; enabled: boolean; interval_hours: number; note: string | null;
  last_run_at: string | null; last_ok_at: string | null; last_error: string | null; items_found: number; items_qualified: number; deals_created: number;
}

const KINDS = [["all", "All kinds"], ["post", "Posted needs"], ["signal", "Hidden needs"], ["prospect", "Local businesses"], ["news", "News"]] as const;
type KindFilter = (typeof KINDS)[number][0];
const tabOf = (status: string) => (status === "qualified" ? "qualified" : status === "new" ? "new" : "rejected");

export function RadarView({ items, sources, googleReady, focus, searchProviders, hunts, plan, searchCap, tz, voiceEnabled = false, openId = null }: { items: RadarItem[]; sources: SourceRow[]; googleReady: boolean; focus: { country: string; industry: string }; searchProviders: string[]; hunts: HuntView[]; plan: RadarPlan; searchCap: number; tz: string; voiceEnabled?: boolean; openId?: number | null }) {
  const opened = openId ? items.find((i) => i.id === openId) : null;
  const [tab, setTab] = useState<"qualified" | "new" | "rejected" | "hunts" | "plan" | "sources">(opened ? tabOf(opened.status) : "qualified");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  // the server looks in every lead of any age, the research and drafts included; the page looks in what is loaded
  const [deep, setDeep] = useState<{ ids: Set<number>; older: { id: number; title: string; status: string; score: number | null; where: string | null }[] } | null>(null);
  const terms = searchTerms(query);
  useEffect(() => {
    const qy = query.trim();
    if (!searchTerms(qy).length) { setDeep(null); return; }
    const t = setTimeout(() => {
      searchRadarAction(qy).then((r) => {
        if (r.ok) setDeep({ ids: new Set(r.leads.map((l) => l.id)), older: r.leads.filter((l) => !items.some((i) => i.id === l.id)).slice(0, 12) });
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [query, items]);
  // the leads of one target or trip ("See its leads" on a target card picks it)
  const [target, setTarget] = useState<number | null>(null);
  const [busy, start] = useTransition();
  const [add, setAdd] = useState(false);
  const [paste, setPaste] = useState({ title: "", body: "", url: "" });
  const [src, setSrc] = useState({ name: "", kind: "rss" as "rss" | "search" | "reddit" | "gnews", value: "", category: "requirement" });
  const { toast } = useToast();
  const router = useRouter();
  const ofKind = (i: RadarItem) => kind === "all" || (i.lead_kind ?? "post") === kind;
  // a search looks in every tab at once: what you look for may be scored, below the bar or skipped
  const searching = terms.length > 0;
  const matched = searching ? items.filter((i) => ofKind(i) && (matchesAll(haystack(i), terms) || deep?.ids.has(i.id))) : [];
  const tabItems = searching ? matched : items.filter((i) => (opened && i.id === opened.id && tabOf(i.status) === tab) || (ofKind(i) && (tab === "qualified" ? i.status === "qualified" : tab === "new" ? i.status === "new" : ["rejected", "skipped"].includes(i.status))));
  const counts = { qualified: items.filter((i) => !i.hidden && i.status === "qualified").length, new: items.filter((i) => !i.hidden && i.status === "new").length, rejected: items.filter((i) => !i.hidden && ["rejected", "skipped"].includes(i.status)).length };
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
        {([["qualified", `Qualified · ${counts.qualified}`], ["new", `Scoring · ${counts.new}`], ["rejected", `Below the bar · ${counts.rejected}`], ["hunts", `Targets & trips · ${hunts.filter((h) => h.enabled).length} on`], ["plan", "Plan & platforms"], ["sources", `Sources${broken ? ` · ${broken} failing` : ""}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-md border px-3 py-1 text-xs", tab === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>{l}</button>
        ))}
      </div>
      {!["hunts", "plan", "sources"].includes(tab) ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search anything: company, person, city, need, email, number" aria-label="Search the radar" className="h-9 pl-8 text-sm" />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Kind of lead">
            {KINDS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("rounded-md border px-2.5 py-1 text-xs", kind === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>{l}</button>
            ))}
          </div>
          {searching ? <span className="text-xs text-subtle">{matched.length} match{matched.length === 1 ? "" : "es"} in every tab</span> : null}
        </div>
      ) : null}
      {searching && deep?.older.length && !["hunts", "plan", "sources"].includes(tab) ? (
        <div className="rounded-xl border border-border p-3 text-sm">
          <p className="mb-1.5 text-xs font-medium text-subtle">Older leads that match</p>
          <ul className="space-y-1">
            {deep.older.map((l) => (
              <li key={l.id}><a href={`/sales/radar?lead=${l.id}`} className="hover:underline"><b>{l.score ?? "?"}</b> {l.title}</a>{l.where ? <span className="block truncate text-xs text-subtle">{l.where}</span> : null}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {tab === "plan" ? (
        <PlanPanel plan={plan} />
      ) : tab === "hunts" ? (
        <HuntsPanel hunts={hunts} searchCap={searchCap} providers={searchProviders} tz={tz} onShowLeads={(id) => { setTarget(id); setTab("qualified"); }} />
      ) : tab !== "sources" ? (
        <RadarBoard key={searching ? `search:${query}` : tab} initialSel={!searching && opened && tabOf(opened.status) === tab ? opened.id : null} items={tabItems} googleReady={googleReady} tz={tz} voiceEnabled={voiceEnabled}
          targets={hunts.map((h) => ({ id: h.id, name: h.name, trip: h.kind === "trip" }))} target={target} onTarget={setTarget} emptyText="Nothing here yet. The radar runs every 15 minutes; the morning digest always brings at least one opportunity." />
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
                    <td className="p-2">{s.kind === "email" ? "" : <Ago d={s.last_run_at} />}</td>
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
