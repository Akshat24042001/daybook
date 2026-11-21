"use client";
// News: the morning brief by date (read here, as a PDF, or on Telegram), every story that matters with why, where the
// news comes from (and whether each source works), and when the brief is written.
import { Download, FileText, Loader2, Newspaper, RefreshCw, Send, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  addNewsSourceAction, readNewsNowAction, saveNewsSettingsAction, sendEditionAction, starNewsAction, toggleNewsSourceAction, writeEditionNowAction,
} from "@/app/news-actions";
import { Ago } from "@/components/sales/ago";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";

export interface NewsStory { id: number; title: string; url: string; outlet: string | null; summary: string | null; score: number | null; topic: string; why: string | null; action: string | null; starred: boolean; at: string }
export interface NewsSourceView { id: number; name: string; kind: string; topic: string | null; enabled: boolean; custom: boolean; last_ok_at: string | null; last_error: string | null; items_found: number }
export interface EditionListItem { date: string; title: string; stories: number; sent_at: string | null }
type Settings = { enabled: boolean; send_hour: number; telegram: boolean; pdf: boolean; extra_interests: string };

const TABS = [["brief", "Morning brief"], ["stories", "All stories"], ["sources", "Sources"], ["settings", "Settings"]] as const;

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function NewsView({ today, editions, stories, sources, topics, edition, settings }: {
  today: string; tz: string; editions: EditionListItem[]; stories: NewsStory[]; sources: NewsSourceView[]; topics: Record<string, string>;
  edition: { date: string; title: string; html: string; stories: number; sent_at: string | null } | null; settings: Settings;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("brief");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const go = <T extends { ok: true } | { ok: false; error: string }>(fn: () => Promise<T>, ok: (r: Extract<T, { ok: true }>) => string) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast((r as { error: string }).error ?? "That did not work.", "error");
    toast(ok(r as Extract<T, { ok: true }>));
    router.refresh();
  });
  const failing = sources.filter((s) => s.enabled && s.last_error).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">News</h1>
          <p className="text-sm text-subtle">Your morning brief at {String(settings.send_hour).padStart(2, "0")}:00{settings.telegram ? ", on Telegram with its PDF" : ""}, and every story that matters to you.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => go(() => readNewsNowAction(), (r) => `Read ${r.read} sources: ${r.added} new stories, ${r.scored} scored`)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Read the news now
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
            toast("Writing today's brief from the latest news. Up to a minute…");
            const r = await writeEditionNowAction(today);
            if (!r.ok) return toast(r.error, "error");
            toast("Today's brief is ready");
            router.push(`/news?date=${r.date}`);
            router.refresh();
          })}><Newspaper className="h-4 w-4" /> Write today&apos;s brief</Button>
        </div>
      </div>

      <div role="tablist" aria-label="News" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm", tab === k ? "border-accent font-semibold text-accent" : "border-transparent text-subtle hover:text-fg")}>
            {l}{k === "sources" && failing ? <span className="ml-1 rounded-full bg-p-rose px-1.5 text-[11px] text-p-rose-fg">{failing} failing</span> : null}
          </button>
        ))}
      </div>

      {tab === "brief" ? (
        <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
          <nav aria-label="Past briefs" className="order-2 lg:order-1">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Past briefs</p>
            {editions.length ? (
              <ul className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
                {editions.map((e) => (
                  <li key={e.date} className="shrink-0">
                    <Link href={`/news?date=${e.date}`} className={cn("block rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted", edition?.date === e.date ? "bg-accent-muted font-semibold text-accent" : "text-fg")}>
                      {e.date === today ? "Today" : dayLabel(e.date)}<span className="ml-1 text-[11px] text-subtle">{e.stories}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-subtle">None yet.</p>}
          </nav>
          <div className="order-1 min-w-0 lg:order-2">
            {edition ? (
              <article className="rounded-2xl border border-border bg-surface p-5 sm:p-7" aria-label="Morning brief">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <p className="text-xs text-subtle">{edition.stories} stories read for it{edition.sent_at ? " · sent to Telegram" : ""}</p>
                  <span className="flex flex-wrap gap-1.5">
                    <a href={`/api/news/pdf/${edition.date}`} target="_blank" rel="noreferrer" className="act"><FileText className="h-3.5 w-3.5" /> Open PDF</a>
                    <a href={`/api/news/pdf/${edition.date}`} download={`morning-brief-${edition.date}.pdf`} className="act"><Download className="h-3.5 w-3.5" /> Download</a>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(() => sendEditionAction(edition.date), () => "Sent to your Telegram")}><Send className="h-3.5 w-3.5" /> Send to Telegram</Button>
                    {edition.date === today ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(() => writeEditionNowAction(today), () => "Rewritten with the latest news")}><RefreshCw className="h-3.5 w-3.5" /> Rewrite</Button> : null}
                  </span>
                </div>
                <div className="news-prose" dangerouslySetInnerHTML={{ __html: edition.html }} />
              </article>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                <p className="font-medium">No brief yet.</p>
                <p className="mt-1 text-sm text-subtle">It is written every morning at {String(settings.send_hour).padStart(2, "0")}:00 from the news read overnight. Write one now with the button above.</p>
              </div>
            )}
          </div>
        </div>
      ) : tab === "stories" ? (
        <Stories stories={stories} topics={topics} onStar={(id, on) => go(() => starNewsAction(id, on), () => (on ? "Starred" : "Unstarred"))} />
      ) : tab === "sources" ? (
        <Sources sources={sources} topics={topics} busy={busy}
          onToggle={(id, on) => go(() => toggleNewsSourceAction(id, on), () => (on ? "Source on" : "Source off"))}
          onAdd={(v, t) => go(() => addNewsSourceAction(v, t), () => "Added. It is read with the next round.")} />
      ) : (
        <SettingsForm settings={settings} busy={busy} onSave={(s) => go(() => saveNewsSettingsAction(s), () => "Saved")} />
      )}
    </div>
  );
}

function Stories({ stories, topics, onStar }: { stories: NewsStory[]; topics: Record<string, string>; onStar: (id: number, on: boolean) => void }) {
  const [topic, setTopic] = useState("all");
  const [qy, setQy] = useState("");
  const [min, setMin] = useState(60);
  const shown = useMemo(() => {
    const t = qy.trim().toLowerCase();
    return stories.filter((s) => (topic === "all" || s.topic === topic) && (s.score ?? 0) >= min && (!t || `${s.title} ${s.why ?? ""} ${s.outlet ?? ""}`.toLowerCase().includes(t)));
  }, [stories, topic, qy, min]);
  const present = Object.entries(topics).filter(([k]) => stories.some((s) => s.topic === k));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={qy} onChange={(e) => setQy(e.target.value)} placeholder="Search the stories" aria-label="Search the stories" className="h-9 max-w-xs text-sm" />
        <Select value={String(min)} onChange={(e) => setMin(Number(e.target.value))} aria-label="How important" className="h-9 w-auto text-sm">
          <option value="80">Must know</option><option value="60">Important and up</option><option value="40">Everything scored</option><option value="0">Everything, not yet scored too</option>
        </Select>
        <span className="text-xs text-subtle">{shown.length} stories, last 3 days</span>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Topic">
        {[["all", "All topics"], ...present].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={topic === k} onClick={() => setTopic(k)} className={cn("rounded-md border px-2.5 py-1 text-xs", topic === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>{l}</button>
        ))}
      </div>
      <ul className="space-y-2">
        {shown.map((s) => (
          <li key={s.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular",
                (s.score ?? 0) >= 80 ? "bg-p-mint text-p-mint-fg" : (s.score ?? 0) >= 60 ? "bg-p-sky text-p-sky-fg" : "bg-muted text-subtle")} title="How much it matters to you">{s.score ?? "?"}</span>
              <div className="min-w-0 flex-1">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-sm font-semibold leading-snug hover:text-accent">{s.title}</a>
                <p className="mt-0.5 text-xs text-subtle">{s.outlet ?? "source"} · <Ago d={s.at} /> · {topics[s.topic] ?? s.topic}</p>
                {s.why ? <p className="mt-1 text-sm">{s.why}</p> : null}
                {s.action ? <p className="mt-0.5 text-xs font-medium text-accent">{s.action}</p> : null}
              </div>
              <button type="button" aria-label={s.starred ? "Unstar" : "Star"} onClick={() => onStar(s.id, !s.starred)} className={cn("shrink-0 rounded p-1 hover:bg-muted", s.starred ? "text-warn" : "text-subtle")}>
                <Star className={cn("h-4 w-4", s.starred && "fill-current")} />
              </button>
            </div>
          </li>
        ))}
        {!shown.length ? <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-subtle">Nothing here. Lower the bar, or read the news now.</li> : null}
      </ul>
    </div>
  );
}

function Sources({ sources, topics, busy, onToggle, onAdd }: { sources: NewsSourceView[]; topics: Record<string, string>; busy: boolean; onToggle: (id: number, on: boolean) => void; onAdd: (v: string, topic: string) => void }) {
  const [v, setV] = useState("");
  const [t, setT] = useState("other");
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold">Add your own</p>
        <p className="text-xs text-subtle">A few words become a Google News search (&quot;Nvidia earnings&quot;, &quot;Dubai real estate tech&quot;); a link becomes a feed.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="Words to search, or a feed URL" aria-label="New source" className="h-9 min-w-0 flex-1 text-sm" />
          <Select value={t} onChange={(e) => setT(e.target.value)} aria-label="Topic" className="h-9 w-auto text-sm">{Object.entries(topics).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Button size="sm" variant="primary" disabled={busy || v.trim().length < 3} onClick={() => { onAdd(v, t); setV(""); }}>Add</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-muted text-left text-subtle"><tr><th className="p-2">Source</th><th className="p-2">Topic</th><th className="p-2">Works?</th><th className="p-2 text-right">Stories</th><th className="p-2">On</th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="p-2">{s.name}{s.custom ? <span className="ml-1 text-subtle">(yours)</span> : null}</td>
                <td className="p-2 text-subtle">{topics[s.topic ?? "other"] ?? s.topic}</td>
                <td className="p-2">{!s.enabled ? <span className="text-subtle">off</span> : s.last_error ? <span className="text-bad" title={s.last_error}>failing: {s.last_error.slice(0, 40)}</span> : s.last_ok_at ? <span className="text-good">yes, <Ago d={s.last_ok_at} /></span> : <span className="text-subtle">not read yet</span>}</td>
                <td className="p-2 text-right tabular">{s.items_found}</td>
                <td className="p-2"><input type="checkbox" checked={s.enabled} aria-label={`${s.name} on`} onChange={(e) => onToggle(s.id, e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsForm({ settings, busy, onSave }: { settings: Settings; busy: boolean; onSave: (s: Settings) => void }) {
  const [s, setS] = useState(settings);
  return (
    <div className="max-w-xl space-y-3 rounded-2xl border border-border bg-surface p-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Write a brief every morning</label>
      <Field label="At">
        <Select value={String(s.send_hour)} onChange={(e) => setS({ ...s, send_hour: Number(e.target.value) })} aria-label="Hour">
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.telegram} onChange={(e) => setS({ ...s, telegram: e.target.checked })} /> Send it to Telegram</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.pdf} onChange={(e) => setS({ ...s, pdf: e.target.checked })} /> With the PDF</label>
      <Field label="Also watch" hint="Anything else the brief should care about: companies, people, stocks, countries, tools. One per line.">
        <Textarea value={s.extra_interests} onChange={(e) => setS({ ...s, extra_interests: e.target.value })} rows={4} placeholder={"Reliance Jio AI\nOmniDimension\nTata Elxsi"} />
      </Field>
      <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={() => onSave(s)}>Save</Button></div>
    </div>
  );
}
