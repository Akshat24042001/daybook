"use client";
import { InfoTip } from "@/components/info-tip";

import { Loader2, Pencil, Play, Plus, Radar, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteHuntAction, huntRunsAction, runHuntAction, saveHuntAction, toggleHuntAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { describeSchedule, searchesPerDay, type Schedule } from "@/lib/sales/hunt-schedule";
import type { HuntRun, HuntView } from "@/lib/sales/hunts";
import { ago } from "./util";
import { Ago } from "@/components/sales/ago";

const SIGNALS: [string, string, string][] = [
  ["requirement", "Asking for help", "Posts and threads where someone needs something built"],
  ["hiring", "Hiring for manual work", "Data entry, support, coordinators: automation opportunities"],
  ["funding", "Funding and launches", "Fresh money means new systems"],
  ["review", "Broken-process complaints", "Public reviews about slow replies, lost orders"],
  ["tender", "Tenders and RFPs", "Public bids a small agency can win"],
  ["launch", "New launches", "New products and companies"],
];
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;
const PRESETS: { label: string; s: Partial<Schedule> }[] = [
  { label: "Every hour", s: { schedule: "interval", every_hours: 1, window_from: 0, window_to: 24, days: [1, 2, 3, 4, 5, 6, 7] } },
  { label: "Hourly, 8 to 20", s: { schedule: "interval", every_hours: 1, window_from: 8, window_to: 20, days: [1, 2, 3, 4, 5, 6, 7] } },
  { label: "Every 3 hours", s: { schedule: "interval", every_hours: 3, window_from: 0, window_to: 24, days: [1, 2, 3, 4, 5, 6, 7] } },
  { label: "Daily at 09:00", s: { schedule: "at", at_time: "09:00", days: [1, 2, 3, 4, 5, 6, 7] } },
  { label: "Weekdays at 09:00", s: { schedule: "at", at_time: "09:00", days: [1, 2, 3, 4, 5] } },
];

type Draft = {
  name: string; brief: string; keywords: string; countries: string; industries: string; signals: string[]; sweep_sources: boolean;
  queries_per_run: number; min_score: string; notify: boolean; enabled: boolean;
} & Schedule;

const blank = (): Draft => ({
  name: "", brief: "", keywords: "", countries: "", industries: "", signals: ["requirement", "hiring", "funding", "review"], sweep_sources: true,
  queries_per_run: 6, min_score: "", notify: true, enabled: true,
  schedule: "at", every_hours: 1, at_time: "09:00", days: [1, 2, 3, 4, 5, 6, 7], window_from: 0, window_to: 24,
});
const fromHunt = (h: HuntView): Draft => ({
  name: h.name, brief: h.brief, keywords: h.keywords.join(", "), countries: h.countries.join(", "), industries: h.industries.join(", "), signals: h.signals,
  sweep_sources: h.sweep_sources, queries_per_run: h.queries_per_run, min_score: h.min_score === null ? "" : String(h.min_score), notify: h.notify, enabled: h.enabled,
  schedule: h.schedule, every_hours: h.every_hours, at_time: h.at_time, days: h.days, window_from: h.window_from, window_to: h.window_to,
});
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function HuntForm({ draft, setDraft, cap, providers }: { draft: Draft; setDraft: (d: Draft) => void; cap: number; providers: string[] }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const perDay = searchesPerDay(draft, draft.queries_per_run, list(draft.keywords).length);
  const paid = providers.some((p) => p !== "duckduckgo");
  return (
    <div className="space-y-4">
      <Field label="Name"><Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. UAE logistics founders" /></Field>
      <Field label="Who do you want to find?" hint="Plain words. The AI turns this into fresh searches every run and scores every result against it.">
        <Textarea value={draft.brief} onChange={(e) => set("brief", e.target.value)} rows={4} placeholder="Owners of 10 to 200 person logistics or trading companies in the Gulf who are drowning in WhatsApp orders and manual data entry, or who just raised money." />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Countries" hint="Empty = this week's rotation"><Input value={draft.countries} onChange={(e) => set("countries", e.target.value)} placeholder="United Arab Emirates, Saudi Arabia" /></Field>
        <Field label="Industries" hint="Empty = today's rotation"><Input value={draft.industries} onChange={(e) => set("industries", e.target.value)} placeholder="Logistics, Real estate" /></Field>
      </div>
      <Field label="Exact phrases to always search" hint="Optional, comma separated. Searched word for word every run."><Input value={draft.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder='"need a chatbot", "looking for automation expert"' /></Field>
      <div>
        <p className="mb-1.5 text-sm font-medium">Look for</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {SIGNALS.map(([k, l, d]) => (
            <label key={k} className={cn("flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-xs", draft.signals.includes(k) ? "border-transparent bg-p-teal text-p-teal-fg" : "border-border text-subtle")}>
              <input type="checkbox" className="mt-0.5" checked={draft.signals.includes(k)} onChange={(e) => set("signals", e.target.checked ? [...draft.signals, k] : draft.signals.filter((x) => x !== k))} />
              <span><b className="block text-sm">{l}</b>{d}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-p-lilac/40 p-3">
        <p className="text-sm font-semibold">When it runs</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => setDraft({ ...draft, ...p.s } as Draft)} className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs hover:bg-muted">{p.label}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repeat">
            <Select value={draft.schedule} onChange={(e) => set("schedule", e.target.value as Schedule["schedule"])}>
              <option value="at">At a set time</option><option value="interval">Every few hours</option>
            </Select>
          </Field>
          {draft.schedule === "at" ? (
            <Field label="Time (your timezone)"><Input type="time" value={draft.at_time} onChange={(e) => set("at_time", e.target.value)} /></Field>
          ) : (
            <Field label="Every how many hours"><Input type="number" min={1} max={168} value={draft.every_hours} onChange={(e) => set("every_hours", Number(e.target.value))} /></Field>
          )}
        </div>
        {draft.schedule === "interval" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Only from (hour)"><Input type="number" min={0} max={23} value={draft.window_from} onChange={(e) => set("window_from", Number(e.target.value))} /></Field>
            <Field label="Until (hour)"><Input type="number" min={1} max={24} value={draft.window_to} onChange={(e) => set("window_to", Number(e.target.value))} /></Field>
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-xs text-subtle">Days</p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([n, l]) => (
              <button key={n} type="button" aria-pressed={draft.days.includes(n)} onClick={() => set("days", draft.days.includes(n) ? draft.days.filter((d) => d !== n) : [...draft.days, n].sort())}
                className={cn("h-8 w-11 rounded-lg border text-xs font-medium", draft.days.includes(n) ? "border-transparent bg-lilac-fill text-p-lilac-fg" : "border-border text-subtle")}>{l}</button>
            ))}
          </div>
        </div>
        <p className="text-sm font-medium">{describeSchedule(draft)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Searches per run" hint="More = wider net, more search credits"><Input type="number" min={1} max={20} value={draft.queries_per_run} onChange={(e) => set("queries_per_run", Number(e.target.value))} /></Field>
        <Field label="Minimum score to keep" hint="Empty = your global bar"><Input type="number" min={0} max={100} value={draft.min_score} onChange={(e) => set("min_score", e.target.value)} placeholder="60" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.sweep_sources} onChange={(e) => set("sweep_sources", e.target.checked)} /> Also sweep the radar's feeds each run (jobs, funding news, tenders)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.notify} onChange={(e) => set("notify", e.target.checked)} /> Tell me on Telegram when it finds something good</label>
      <p className={cn("rounded-xl px-3 py-2 text-xs", perDay > cap && paid ? "bg-p-butter text-p-butter-fg" : "bg-muted text-subtle")}>
        About <b>{perDay}</b> web searches a day.{" "}
        {paid ? (perDay > cap ? `Your paid-search cap is ${cap} a day, so the rest fall back to the free DuckDuckGo search, which is weaker. Raise the cap in Settings if your plan allows.` : `Inside your paid-search cap of ${cap} a day.`)
          : "No search key is set: the free engines (Bing, DuckDuckGo, Mojeek) and, with a Gemini key, Google run instead. A free TAVILY_API_KEY gives steadier coverage."}
      </p>
    </div>
  );
}

function RunLog({ id }: { id: number }) {
  const [runs, setRuns] = useState<HuntRun[] | null>(null);
  const [busy, start] = useTransition();
  return (
    <details className="mt-2" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !runs) start(async () => { const r = await huntRunsAction(id); if (r.ok) setRuns(r.runs); }); }}>
      <summary className="cursor-pointer text-xs text-subtle">Recent runs {busy ? "…" : ""}</summary>
      {runs ? (
        <ul className="mt-1 space-y-1.5 text-xs">
          {runs.length === 0 ? <li className="text-subtle">No runs yet.</li> : runs.map((r) => (
            <li key={r.id} className="rounded-lg bg-muted px-2 py-1.5">
              <span className={cn("font-medium", r.status === "error" ? "text-bad" : r.status === "running" ? "text-accent" : "text-good")}>{r.status}</span>
              {" · "}<Ago d={r.started_at} />{" · "}{r.trigger}{" · "}{r.searched} searches, {r.found} new
              {r.error ? <span className="block text-bad">{r.error}</span> : null}
              {r.queries.length ? <details className="mt-0.5"><summary className="cursor-pointer text-subtle">Queries</summary><ul className="mt-0.5 list-disc pl-4 text-subtle">{r.queries.map((x, i) => <li key={i}>{x}</li>)}</ul></details> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

export function HuntsPanel({ hunts, searchCap, providers, tz }: { hunts: HuntView[]; searchCap: number; providers: string[]; tz: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState<{ id?: number; draft: Draft } | null>(null);

  const save = () => start(async () => {
    if (!editing) return;
    const d = editing.draft;
    const r = await saveHuntAction({
      name: d.name, brief: d.brief, keywords: list(d.keywords), countries: list(d.countries), industries: list(d.industries), signals: d.signals,
      sweep_sources: d.sweep_sources, queries_per_run: d.queries_per_run, min_score: d.min_score === "" ? null : Number(d.min_score), notify: d.notify, enabled: d.enabled,
      schedule: d.schedule, every_hours: d.every_hours, at_time: d.at_time, days: d.days, window_from: d.window_from, window_to: d.window_to,
    }, editing.id);
    if (!r.ok) return toast(r.error, "error");
    toast(editing.id ? "Hunt saved" : "Hunt created");
    setEditing(null);
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-p-teal px-4 py-3 text-p-teal-fg">
        <p className="flex max-w-2xl items-center gap-1 text-sm">AI that searches the web for buyers on your schedule. <InfoTip label="About hunts">Make as many as you like: one broad daily sweep, one hourly watch on a hot niche, one weekly deep dive on a country.</InfoTip></p>
        <Button size="sm" variant="primary" onClick={() => setEditing({ draft: blank() })}><Plus className="h-4 w-4" /> New hunt</Button>
      </div>
      {hunts.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-subtle">No hunts yet. Create one to start finding leads automatically.</p> : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {hunts.map((h) => (
          <li key={h.id} className={cn("rounded-2xl border bg-surface p-4", h.enabled ? "border-border" : "border-dashed border-border opacity-70")}>
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", h.enabled ? "bg-p-teal text-p-teal-fg" : "bg-muted text-subtle")}><Radar className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{h.name}</p>
                <p className="text-xs font-medium text-p-lilac-fg">{describeSchedule(h)}</p>
                {h.brief ? <p className="mt-1 line-clamp-2 text-xs text-subtle">{h.brief}</p> : null}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-subtle"><input type="checkbox" checked={h.enabled} onChange={(e) => start(async () => { await toggleHuntAction(h.id, e.target.checked); router.refresh(); })} aria-label={`Run ${h.name} on schedule`} /> On</label>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {([["Found", h.week.found], ["Qualified", h.week.qualified], ["Hot", h.week.hot], ["Leads", h.week.converted]] as const).map(([l, n]) => (
                <div key={l} className="rounded-xl bg-muted px-1 py-1.5"><p className="font-display text-lg tabular leading-none">{n}</p><p className="mt-0.5 text-[10px] text-subtle">{l} · 7d</p></div>
              ))}
            </div>
            <p className="mt-2 text-xs text-subtle">
              {h.last_run ? <>Last run <Ago d={h.last_run.started_at} /> · <span className={h.last_run.status === "error" ? "text-bad" : ""}>{h.last_run.status === "running" ? "running now" : `${h.last_run.found} new`}</span></> : "Never run"}
              {h.enabled && h.next_run_at ? <> · next {new Date(h.next_run_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz })}</> : null}
              {" · "}≈{h.searches_per_day} searches a day
            </p>
            {h.last_run?.error ? <p className="mt-1 text-xs text-bad">{h.last_run.error}</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
                const r = await runHuntAction(h.id);
                toast(r.ok ? "Queued. It starts within a minute; results appear under Qualified." : r.error, r.ok ? "ok" : "error");
                router.refresh();
              })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run now</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing({ id: h.id, draft: fromHunt(h) })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${h.name}"? Leads it already found stay on the radar.`)) start(async () => { await deleteHuntAction(h.id); router.refresh(); }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <RunLog id={h.id} />
          </li>
        ))}
      </ul>
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit hunt" : "New hunt"} description="Tell the AI who to find and when to look.">
        {editing ? (
          <div className="space-y-4">
            <HuntForm draft={editing.draft} setDraft={(d) => setEditing({ ...editing, draft: d })} cap={searchCap} providers={providers} />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>Save hunt</Button></div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
