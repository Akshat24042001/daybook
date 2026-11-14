"use client";
import { InfoTip } from "@/components/info-tip";

import { Eye, Loader2, MapPin, Pencil, Play, Plane, Plus, Radar, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteHuntAction, huntRunsAction, parseTargetAction, runHuntAction, saveHuntAction, toggleHuntAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { describeSchedule, searchesPerDay, type Schedule } from "@/lib/sales/hunt-schedule";
import type { HuntInput, HuntRun, HuntView } from "@/lib/sales/hunts";
import { fmtRange } from "@/lib/time";
import { TripEvents, TripPlan, tripLabel } from "./radar-trip";
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
  kind: "standing" | "trip"; cities: string; exclude: string; starts_on: string; ends_on: string; trip_from: string; trip_to: string; meet: boolean; prospects: boolean;
  region: string; events: boolean;
} & Schedule;

const blank = (): Draft => ({
  name: "", brief: "", keywords: "", countries: "", industries: "", signals: ["requirement", "hiring", "funding", "review"], sweep_sources: true,
  queries_per_run: 6, min_score: "", notify: true, enabled: true,
  schedule: "at", every_hours: 1, at_time: "09:00", days: [1, 2, 3, 4, 5, 6, 7], window_from: 0, window_to: 24,
  kind: "standing", cities: "", exclude: "", starts_on: "", ends_on: "", trip_from: "", trip_to: "", meet: false, prospects: false,
  region: "", events: true,
});
/** A trip searches twice a day from now until it ends, finds local businesses and asks them to meet. */
const tripDefaults = (d: Draft): Draft => ({
  ...d, kind: "trip", meet: true, prospects: true, sweep_sources: false, signals: ["requirement", "hiring", "launch", "review"],
  schedule: "interval", every_hours: 8, window_from: 7, window_to: 23, days: [1, 2, 3, 4, 5, 6, 7], queries_per_run: 6,
});
const fromHunt = (h: HuntView): Draft => ({
  name: h.name, brief: h.brief, keywords: h.keywords.join(", "), countries: h.countries.join(", "), industries: h.industries.join(", "), signals: h.signals,
  sweep_sources: h.sweep_sources, queries_per_run: h.queries_per_run, min_score: h.min_score === null ? "" : String(h.min_score), notify: h.notify, enabled: h.enabled,
  schedule: h.schedule, every_hours: h.every_hours, at_time: h.at_time, days: h.days, window_from: h.window_from, window_to: h.window_to,
  kind: h.kind, cities: h.cities.join(", "), exclude: h.exclude.join(", "), starts_on: h.starts_on ?? "", ends_on: h.ends_on ?? "", trip_from: h.trip_from ?? "", trip_to: h.trip_to ?? "", meet: h.meet, prospects: h.prospects,
  region: h.region ?? "", events: h.events,
});
/** What the one-line box understood, as a form to check. */
const fromParsed = (p: HuntInput): Draft => {
  const base = p.kind === "trip" ? tripDefaults(blank()) : { ...blank(), prospects: !!p.prospects };
  return {
    ...base, name: p.name ?? "", brief: p.brief ?? "", cities: (p.cities ?? []).join(", "), countries: (p.countries ?? []).join(", "), industries: (p.industries ?? []).join(", "),
    keywords: (p.keywords ?? []).join(", "), exclude: (p.exclude ?? []).join(", "), trip_from: p.trip_from ?? "", trip_to: p.trip_to ?? "", region: p.region ?? "",
    meet: p.kind === "trip" ? true : !!p.meet, signals: p.signals?.length ? p.signals : base.signals,
  };
};
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function HuntForm({ draft, setDraft, cap, providers }: { draft: Draft; setDraft: (d: Draft) => void; cap: number; providers: string[] }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const perDay = searchesPerDay(draft, draft.queries_per_run, list(draft.keywords).length);
  const paid = providers.some((p) => p !== "duckduckgo");
  const trip = draft.kind === "trip";
  return (
    <div className="space-y-4">
      <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs" role="group" aria-label="Kind of target">
        {([["standing", "Ongoing target"], ["trip", "A trip"]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => setDraft(k === "trip" ? tripDefaults(draft) : { ...draft, kind: "standing", meet: false })}
            className={cn("px-3 py-1.5", draft.kind === k ? "bg-accent text-accent-fg" : "bg-surface text-subtle")}>{l}</button>
        ))}
      </div>
      <Field label="Name"><Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={trip ? "e.g. Udaipur trip" : "e.g. UAE logistics founders"} /></Field>
      {trip ? (
        <div className="space-y-3 rounded-2xl border border-border bg-p-butter/50 p-3">
          <p className="text-sm font-semibold">The trip</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City"><Input value={draft.cities} onChange={(e) => set("cities", e.target.value)} placeholder="Udaipur" /></Field>
            <Field label="First day"><Input type="date" value={draft.trip_from} onChange={(e) => set("trip_from", e.target.value)} /></Field>
            <Field label="Last day"><Input type="date" value={draft.trip_to} min={draft.trip_from || undefined} onChange={(e) => set("trip_to", e.target.value)} /></Field>
          </div>
          <Field label="State or region" hint="For events and leads nearby"><Input value={draft.region} onChange={(e) => set("region", e.target.value)} placeholder="Rajasthan" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.meet} onChange={(e) => set("meet", e.target.checked)} /> Messages ask to meet in person while I am there (with two concrete times)</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={draft.events} onChange={(e) => set("events", e.target.checked)} />
            <span>Find events around my dates <span className="block text-xs text-subtle">Your communities (Sales settings), business meets, talks, startup and industry events in and near the city, from 5 days before to 5 days after.</span></span></label>
          <p className="text-xs text-subtle">It starts searching now and stops by itself after the last day.</p>
        </div>
      ) : null}
      <Field label="Who do you want to find?" hint="Plain words. The AI turns this into fresh searches every run and scores every result against it.">
        <Textarea value={draft.brief} onChange={(e) => set("brief", e.target.value)} rows={4} placeholder="Owners of 10 to 200 person logistics or trading companies in the Gulf who are drowning in WhatsApp orders and manual data entry, or who just raised money." />
      </Field>
      <div className={cn("grid gap-3", trip ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
        {!trip ? <Field label="Cities" hint="Optional: only leads there"><Input value={draft.cities} onChange={(e) => set("cities", e.target.value)} placeholder="Jaipur, Udaipur" /></Field> : null}
        <Field label="Countries" hint="Empty = this week's rotation"><Input value={draft.countries} onChange={(e) => set("countries", e.target.value)} placeholder="United Arab Emirates, Saudi Arabia" /></Field>
        <Field label="Industries" hint="Empty = today's rotation"><Input value={draft.industries} onChange={(e) => set("industries", e.target.value)} placeholder="Logistics, Real estate" /></Field>
      </div>
      <Field label="Exact phrases to always search" hint="Optional, comma separated. Searched word for word every run."><Input value={draft.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder='"need a chatbot", "looking for automation expert"' /></Field>
      <Field label="Skip anything that mentions" hint="Optional, comma separated. Dropped before scoring."><Input value={draft.exclude} onChange={(e) => set("exclude", e.target.value)} placeholder="internship, crypto, unpaid" /></Field>
      {draft.cities.trim() ? (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={draft.prospects} onChange={(e) => set("prospects", e.target.checked)} />
          <span>Also find local businesses there that fit my offers <span className="block text-xs text-subtle">Each one must be named in a search result. Nobody posted these, so the message is a first touch.</span></span></label>
      ) : null}
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
        {!trip ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start on" hint="Empty = now"><Input type="date" value={draft.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></Field>
            <Field label="Stop after" hint="Empty = keeps going"><Input type="date" value={draft.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></Field>
          </div>
        ) : null}
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

export function HuntsPanel({ hunts, searchCap, providers, tz, onShowLeads }: { hunts: HuntView[]; searchCap: number; providers: string[]; tz: string; onShowLeads?: (id: number) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState<{ id?: number; draft: Draft; by?: "ai" | "rules" } | null>(null);
  const [line, setLine] = useState("");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const understand = () => start(async () => {
    if (!line.trim()) return;
    const r = await parseTargetAction(line);
    if (!r.ok) return toast(r.error, "error");
    setEditing({ draft: fromParsed(r.target), by: r.target.by });
  });
  // trips first (soonest first), then your other targets; finished ones last
  const sorted = [...hunts].sort((a, b) => Number(!!a.ended_at) - Number(!!b.ended_at) || Number(b.kind === "trip") - Number(a.kind === "trip") || String(a.trip_from ?? "").localeCompare(String(b.trip_from ?? "")) || a.id - b.id);

  const save = () => start(async () => {
    if (!editing) return;
    const d = editing.draft;
    const r = await saveHuntAction({
      name: d.name, brief: d.brief, keywords: list(d.keywords), countries: list(d.countries), industries: list(d.industries), signals: d.signals,
      sweep_sources: d.sweep_sources, queries_per_run: d.queries_per_run, min_score: d.min_score === "" ? null : Number(d.min_score), notify: d.notify, enabled: d.enabled,
      schedule: d.schedule, every_hours: d.every_hours, at_time: d.at_time, days: d.days, window_from: d.window_from, window_to: d.window_to,
      kind: d.kind, cities: list(d.cities), exclude: list(d.exclude), starts_on: d.starts_on || null, ends_on: d.kind === "trip" ? null : d.ends_on || null,
      trip_from: d.trip_from || null, trip_to: d.trip_to || null, meet: d.meet, prospects: d.prospects,
      region: d.region.trim() || null, events: d.events,
    }, editing.id);
    if (!r.ok) return toast(r.error, "error");
    toast(editing.id ? "Saved" : d.kind === "trip" ? "Trip added. The first search runs within a minute." : "Target added. The first search runs within a minute.");
    if (!editing.id && r.id) await runHuntAction(r.id);
    setLine("");
    setEditing(null);
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-p-teal px-4 py-3 text-p-teal-fg">
        <p className="flex items-center gap-1 text-sm font-semibold">Tell the radar what to go after <InfoTip label="About targets">A city, an industry, a country, a kind of company, or a trip. Each target searches on its own schedule, scores what it finds against what you asked, and every good lead is prepared for you. A trip also finds local businesses and asks them to meet while you are there.</InfoTip></p>
        <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); understand(); }}>
          <Input value={line} onChange={(e) => setLine(e.target.value)} aria-label="What to target" className="flex-1 bg-surface text-fg"
            placeholder="I'm in Udaipur from 29 Nov to 2 Dec. Hotels, resorts and wedding planners." />
          <Button type="submit" variant="primary" disabled={busy || !line.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Set it up</Button>
        </form>
        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <span className="opacity-80">Or start from:</span>
          <button type="button" className="rounded-md bg-surface/70 px-2 py-0.5 text-fg hover:bg-surface" onClick={() => setEditing({ draft: tripDefaults({ ...blank(), name: "" }) })}><Plane className="mr-1 inline h-3 w-3" />A trip</button>
          <button type="button" className="rounded-md bg-surface/70 px-2 py-0.5 text-fg hover:bg-surface" onClick={() => setEditing({ draft: { ...blank(), prospects: true, brief: "Local businesses in this city that need AI agents, automation or a better website." } })}><MapPin className="mr-1 inline h-3 w-3" />A city</button>
          <button type="button" className="rounded-md bg-surface/70 px-2 py-0.5 text-fg hover:bg-surface" onClick={() => setEditing({ draft: blank() })}><Plus className="mr-1 inline h-3 w-3" />An industry or anything else</button>
        </p>
      </div>
      {hunts.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-subtle">No targets yet. Type one line above to start.</p> : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {sorted.map((h) => {
          const isTrip = h.kind === "trip" && h.trip_from && h.trip_to;
          const place = [h.cities.join(", "), h.countries.join(", ")].filter(Boolean).join(" · ");
          return (
          <li key={h.id} className={cn("rounded-2xl border bg-surface p-4", h.enabled ? "border-border" : "border-dashed border-border opacity-70", isTrip && h.enabled ? "lg:col-span-2" : "")} aria-label={h.name}>
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", !h.enabled ? "bg-muted text-subtle" : isTrip ? "bg-p-butter text-p-butter-fg" : "bg-p-teal text-p-teal-fg")}>{isTrip ? <Plane className="h-4 w-4" /> : <Radar className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{h.name}</p>
                {isTrip ? <p className="text-xs font-semibold text-p-butter-fg" suppressHydrationWarning>{tripLabel({ city: h.cities[0] ?? h.name, from: h.trip_from!, to: h.trip_to! }, today, { short: true })}</p> : null}
                {!isTrip ? <p className="text-xs font-medium text-subtle">Ongoing target{place ? <span className="ml-1 inline-flex items-center gap-1 font-normal"><MapPin className="h-3 w-3" />{place}</span> : null}</p> : null}
                {h.ended_at ? <p className="text-xs text-subtle">Finished: it stopped after {h.ends_on ?? h.trip_to}.</p> : null}
                <p className="text-xs font-medium text-p-lilac-fg">{describeSchedule(h)}{!isTrip && (h.starts_on || h.ends_on) ? ` · ${h.starts_on && h.ends_on ? fmtRange(h.starts_on, h.ends_on) : h.starts_on ? `from ${h.starts_on}` : `until ${h.ends_on}`}` : ""}</p>
                {h.brief ? <p className="mt-1 line-clamp-2 text-xs text-subtle">{h.brief}</p> : null}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-subtle"><input type="checkbox" checked={h.enabled} onChange={(e) => start(async () => { await toggleHuntAction(h.id, e.target.checked); router.refresh(); })} aria-label={`Run ${h.name} on schedule`} /> On</label>
            </div>
            <div className={cn("mt-3 grid gap-2 text-center", isTrip ? "grid-cols-5" : "grid-cols-4")}>
              {(isTrip
                ? [["Found", h.total.found], ["Good fit", h.total.qualified], ["Ready to send", h.total.ready], ["Contacted", h.total.contacted], ["Meetings", h.total.meetings]] as const
                : [["Found", h.week.found], ["Qualified", h.week.qualified], ["Hot", h.week.hot], ["Leads", h.week.converted]] as const
              ).map(([l, n]) => (
                <div key={l} className="rounded-xl bg-muted px-1 py-1.5"><p className="font-display text-lg tabular leading-none">{n}</p><p className="mt-0.5 text-[10px] text-subtle">{l}{isTrip ? "" : " · 7d"}</p></div>
              ))}
            </div>
            {isTrip ? (
              <details className="mt-2" open={h.enabled}>
                <summary className="cursor-pointer text-xs font-medium">Day by day ({h.meetings.length} meeting{h.meetings.length === 1 ? "" : "s"} booked{h.events_list.filter((e) => e.status === "going").length ? `, ${h.events_list.filter((e) => e.status === "going").length} event${h.events_list.filter((e) => e.status === "going").length === 1 ? "" : "s"}` : ""})</summary>
                <TripPlan from={h.trip_from!} to={h.trip_to!} meetings={h.meetings} tz={tz} events={h.events_list} />
              </details>
            ) : null}
            {isTrip && h.events ? <TripEvents huntId={h.id} events={h.events_list} from={h.trip_from!} to={h.trip_to!} checkedAt={h.events_checked_at ?? null} /> : null}
            <p className="mt-2 text-xs text-subtle">
              {h.last_run ? <>Last run <Ago d={h.last_run.started_at} /> · <span className={h.last_run.status === "error" ? "text-bad" : ""}>{h.last_run.status === "running" ? "running now" : `${h.last_run.found} new`}</span></> : "Never run"}
              {h.enabled && h.next_run_at ? <> · next {new Date(h.next_run_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz })}</> : null}
              {" · "}≈{h.searches_per_day} searches a day
            </p>
            {h.enabled && h.searches_per_day > searchCap ? <p className="mt-1 rounded-lg bg-p-butter px-2 py-1 text-xs text-p-butter-fg">This uses more searches a day than your paid daily limit ({searchCap}), so every target falls back to the weaker free search. Run it less often (Edit, When it runs).</p> : null}
            {h.last_run?.error ? <p className="mt-1 text-xs text-bad">{h.last_run.error}</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
                const r = await runHuntAction(h.id);
                toast(r.ok ? "Queued. It starts within a minute; results appear under Qualified." : r.error, r.ok ? "ok" : "error");
                router.refresh();
              })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run now</Button>
              {onShowLeads ? <Button size="sm" variant="outline" onClick={() => onShowLeads(h.id)}><Eye className="h-3.5 w-3.5" /> See its leads</Button> : null}
              <Button size="sm" variant="outline" onClick={() => setEditing({ id: h.id, draft: fromHunt(h) })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${h.name}"? Leads it already found stay on the radar.`)) start(async () => { await deleteHuntAction(h.id); router.refresh(); }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <RunLog id={h.id} />
          </li>
          );
        })}
      </ul>
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit target" : editing?.draft.kind === "trip" ? "New trip" : "New target"} description={editing?.by ? "Here is what I understood. Check it, change anything, then save." : "Tell the AI who to find and when to look."}>
        {editing ? (
          <div className="space-y-4">
            <HuntForm draft={editing.draft} setDraft={(d) => setEditing({ ...editing, draft: d })} cap={searchCap} providers={providers} />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{editing.id ? "Save" : editing.draft.kind === "trip" ? "Start the trip search" : "Start this target"}</Button></div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
