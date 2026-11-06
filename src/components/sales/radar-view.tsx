"use client";

import { ExternalLink, Loader2, Plus, Radar, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addRadarItemAction, addSourceAction, digestNowAction, radarDraftAction, radarStatusAction, radarToDealAction, runRadarAction, toggleSourceAction,
} from "@/app/sales-actions";
import { Button, Chip, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { MoveRow } from "@/lib/sales/moves";
import { ago } from "./util";
import { MoveCard } from "./moves-view";

export interface RadarItem {
  id: number; title: string; body: string | null; url: string | null; score: number | null; status: string; found_at: string; posted_at: string | null;
  source: string | null; category: string | null; deal_id: number | null;
  fit: { why?: string; angle?: string; money_leak?: string | null; country?: string; industry?: string; services?: string[]; buyer?: string; budget?: string | null; urgency?: string } | null;
}
export interface SourceRow {
  id: number; key: string; name: string; kind: string; category: string; enabled: boolean; interval_hours: number; note: string | null;
  last_run_at: string | null; last_ok_at: string | null; last_error: string | null; items_found: number; items_qualified: number; deals_created: number;
}

function ItemCard({ it, googleReady }: { it: RadarItem; googleReady: boolean }) {
  const [move, setMove] = useState<MoveRow | null>(null);
  const [busy, start] = useTransition();
  const [gone, setGone] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  if (gone) return null;
  const f = it.fit ?? {};
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, hide = true) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast((r as { error: string }).error, "error");
    if (hide) setGone(true);
    router.refresh();
  });
  return (
    <li className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-sm tabular", (it.score ?? 0) >= 75 ? "bg-p-mint text-p-mint-fg" : (it.score ?? 0) >= 60 ? "bg-p-sky text-p-sky-fg" : "bg-muted text-subtle")}>
          {it.score ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{it.title}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-subtle">
            <span>{it.source ?? "manual"}</span>{it.category ? <span>{it.category}</span> : null}<span>found {ago(it.found_at)}</span>
            {it.posted_at ? <span>posted {ago(it.posted_at)}</span> : null}{f.country ? <span>{f.country}</span> : null}{f.industry ? <span>{f.industry}</span> : null}
          </p>
          {f.why ? <p className="mt-1 text-xs">{f.why}</p> : null}
          {f.angle ? <p className="mt-1 text-xs text-accent">💡 {f.angle}</p> : null}
          {f.money_leak ? <p className="mt-1 rounded-lg bg-p-butter px-2 py-1 text-xs text-p-butter-fg">{f.money_leak}</p> : null}
          {f.services?.length ? <div className="mt-1 flex flex-wrap gap-1">{f.services.map((s) => <Chip key={s} className="text-[10px]">{s}</Chip>)}</div> : null}
          {it.body ? <details className="mt-1"><summary className="cursor-pointer text-[11px] text-subtle">Full post</summary><p className="mt-1 whitespace-pre-line text-xs text-subtle">{it.body.slice(0, 2500)}</p></details> : null}
        </div>
      </div>
      {move ? <div className="mt-3"><MoveCard m={move} googleReady={googleReady} onGone={() => setGone(true)} /></div> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {!move ? <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
          const r = await radarDraftAction(it.id);
          if (!r.ok) return toast(r.error, "error");
          setMove(r.move);
        })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Draft reply</Button> : null}
        {it.deal_id ? <Button size="sm" variant="outline" onClick={() => router.push(`/sales/deal/${it.deal_id}`)}>Open deal</Button> : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
            const r = await radarToDealAction(it.id);
            if (!r.ok) return toast(r.error, "error");
            router.push(`/sales/deal/${r.id}`);
          })}><Plus className="h-3.5 w-3.5" /> Make it a lead</Button>
        )}
        {it.url?.startsWith("http") ? <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-xl px-3 text-xs text-accent hover:bg-muted">Open <ExternalLink className="h-3 w-3" /></a> : null}
        <Button size="sm" variant="ghost" onClick={() => act(() => radarStatusAction(it.id, "skipped"))}>Skip</Button>
        <Button size="sm" variant="ghost" onClick={() => act(() => radarStatusAction(it.id, "rejected"))}>Not relevant</Button>
      </div>
    </li>
  );
}

export function RadarView({ items, sources, googleReady, focus, searchProviders }: { items: RadarItem[]; sources: SourceRow[]; googleReady: boolean; focus: { country: string; industry: string }; searchProviders: string[] }) {
  const [tab, setTab] = useState<"qualified" | "new" | "rejected" | "sources">("qualified");
  const [busy, start] = useTransition();
  const [add, setAdd] = useState(false);
  const [paste, setPaste] = useState({ title: "", body: "", url: "" });
  const [src, setSrc] = useState({ name: "", kind: "rss" as "rss" | "search" | "reddit" | "gnews", value: "", category: "requirement" });
  const { toast } = useToast();
  const router = useRouter();
  const list = items.filter((i) => (tab === "qualified" ? i.status === "qualified" : tab === "new" ? i.status === "new" : ["rejected", "skipped"].includes(i.status)));
  const counts = { qualified: items.filter((i) => i.status === "qualified").length, new: items.filter((i) => i.status === "new").length, rejected: items.filter((i) => ["rejected", "skipped"].includes(i.status)).length };
  const broken = sources.filter((s) => s.enabled && s.last_error).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Radar</h1>
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
        {([["qualified", `Qualified · ${counts.qualified}`], ["new", `Scoring · ${counts.new}`], ["rejected", `Below the bar · ${counts.rejected}`], ["sources", `Sources${broken ? ` · ${broken} failing` : ""}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-full border px-3 py-1 text-xs", tab === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>{l}</button>
        ))}
      </div>
      {tab !== "sources" ? (
        list.length ? <ul className="grid gap-3 lg:grid-cols-2">{list.map((it) => <ItemCard key={it.id} it={it} googleReady={googleReady} />)}</ul>
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
