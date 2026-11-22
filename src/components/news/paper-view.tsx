"use client";
// The morning paper on screen: a masthead, the day's headline and lead story, the 60-second brief, the world today, who
// wins and who loses, then every section. Each story opens in place (the full write-up, who it hits, what it means for
// you) and links to the full article at its source.
import { ArrowDownRight, ArrowUpRight, ChevronDown, ExternalLink, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export interface PaperStoryView {
  id: number; title: string; link: string; outlet: string | null; author: string | null; image_url: string | null; detail: string | null; summary: string | null;
  affects: string | null; impact: string | null; for_you: string | null; why: string | null; topic: string; at: string;
}
export interface LayoutView {
  headline: string; standfirst: string; lead: number | null; brief: { text: string; id: number | null }[]; glance: string; note: string;
  sectors: { name: string; move: "up" | "down" | "mixed"; why: string; ids: number[] }[]; opportunities: { idea: string; id: number | null }[]; today: string[];
  sections: { key: string; title: string; ids: number[] }[];
}

const when = (iso: string, tz: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

function Move({ move, className }: { move: string | null; className?: string }) {
  if (move === "up") return <ArrowUpRight className={cn("h-4 w-4 text-good", className)} aria-label="good for business" />;
  if (move === "down") return <ArrowDownRight className={cn("h-4 w-4 text-bad", className)} aria-label="bad for business" />;
  if (move === "mixed") return <Minus className={cn("h-4 w-4 text-warn", className)} aria-label="mixed" />;
  return null;
}

function Picture({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} className={cn("w-full rounded-xl object-cover", className)} />;
}

function SourceLink({ s, className }: { s: PaperStoryView; className?: string }) {
  return (
    <a href={s.link} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline", className)}>
      Read the full story at {s.outlet ?? "the source"} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** One story: closed it shows the headline, writer and a short summary; open it shows everything. */
function StoryCard({ s, tz, topics, open, onToggle, big }: { s: PaperStoryView; tz: string; topics: Record<string, string>; open: boolean; onToggle: () => void; big?: boolean }) {
  const body = s.detail ?? s.summary ?? "";
  return (
    <article id={`story-${s.id}`} className={cn("clay scroll-mt-24 overflow-hidden", big ? "p-5 sm:p-6" : "p-4")} data-story={s.id}>
      {s.image_url ? <Picture src={s.image_url} alt="" className={cn("mb-3", big ? "max-h-[360px]" : "max-h-48")} /> : null}
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
        <Move move={s.impact} className="h-3.5 w-3.5" />{topics[s.topic] ?? s.topic}
      </p>
      <h3 className={cn("mt-1 font-serif font-bold leading-snug", big ? "text-2xl sm:text-[28px]" : "text-[17px]")}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="text-left hover:text-accent">{s.title}</button>
      </h3>
      <p className="mt-1 text-[11px] text-subtle">{[s.author ? `By ${s.author}` : null, s.outlet, when(s.at, tz)].filter(Boolean).join(" · ")}</p>
      <div className={cn("mt-2 font-serif text-[15px] leading-relaxed text-fg/90", !open && "line-clamp-3")}>
        {body.split(/\n{2,}/).map((p, i) => <p key={i} className={i ? "mt-2" : ""}>{p}</p>)}
      </div>
      {open ? (
        <div className="mt-3 space-y-2.5">
          {s.affects ? <p className="text-sm"><span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-accent">Who it hits</span><span className="font-serif italic">{s.affects}</span></p> : null}
          {s.for_you || s.why ? (
            <div className="clay-inset p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">For you</p>
              <p className="mt-0.5 text-sm">{s.for_you || s.why}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SourceLink s={s} />
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 text-xs text-subtle hover:text-fg" aria-label={open ? "Show less" : "Read more"}>
          {open ? "Show less" : "Read more"} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
    </article>
  );
}

export function PaperView({ layout, stories, tz, topics, dayLine, number, owner, company, sources }: {
  layout: LayoutView; stories: PaperStoryView[]; tz: string; topics: Record<string, string>; dayLine: string; number: number; owner: string; company: string; sources: number;
}) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const [open, setOpen] = useState<Set<number>>(() => new Set(layout.lead ? [layout.lead] : []));
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reveal = (id: number) => {
    setOpen((o) => new Set(o).add(id));
    requestAnimationFrame(() => document.getElementById(`story-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // a link to #story-12 opens that story
  useEffect(() => {
    const m = location.hash.match(/^#story-(\d+)$/);
    if (m) reveal(Number(m[1]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lead = layout.lead ? byId.get(layout.lead) : undefined;
  const nav = [["front", "Front page"], ...(layout.sectors.length ? [["sectors", "Who wins, who loses"]] : []), ...layout.sections.map((s) => [`sec-${s.key}`, s.title]), ...(layout.opportunities.length || layout.today.length ? [["act", "What to do"]] : [])];
  const cite = (id: number | null) => {
    const s = id ? byId.get(id) : undefined;
    return s ? <button type="button" onClick={() => reveal(s.id)} className="ml-1 whitespace-nowrap text-xs font-semibold text-accent hover:underline">{s.outlet ?? "Story"} ›</button> : null;
  };

  return (
    <div className="space-y-6" aria-label="Today's paper">
      {/* masthead */}
      <header id="front" className="clay scroll-mt-24 px-5 pb-4 pt-5 text-center sm:px-8">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">
          <span>Personal edition for {owner}</span><span>No. {number}</span>
        </div>
        <p className="mt-2 font-serif text-4xl font-black tracking-tight sm:text-6xl">The Daybook Daily</p>
        <p className="mt-1 font-serif text-sm italic text-subtle">The news that moves your business, read every morning for {company}</p>
        <div className="mt-3 border-y-[3px] border-double border-fg/70 py-1.5 text-xs text-fg/80">
          {dayLine} · {stories.length} stories from {sources} sources · every story links to its source
        </div>
      </header>

      <nav aria-label="Sections" className="sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-bg/90 px-1 py-2 backdrop-blur">
        {nav.map(([k, l]) => (
          <a key={k} href={`#${k}`} className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-subtle shadow-sm hover:border-accent hover:text-accent">{l}</a>
        ))}
      </nav>

      {/* front page */}
      <section aria-label="Front page" className="space-y-4">
        <div>
          <h2 className="font-serif text-3xl font-black leading-tight sm:text-[42px]">{layout.headline}</h2>
          {layout.standfirst ? <p className="mt-2 font-serif text-lg italic text-subtle">{layout.standfirst}</p> : null}
        </div>
        {lead ? <StoryCard s={lead} tz={tz} topics={topics} open={open.has(lead.id)} onToggle={() => toggle(lead.id)} big /> : null}
      </section>

      {layout.brief.length ? (
        <section aria-label="The 60-second brief">
          <h2 className="mb-2 border-b-2 border-accent pb-1 text-xs font-bold uppercase tracking-[0.15em] text-accent">The 60-second brief</h2>
          <ol className="grid gap-3 sm:grid-cols-2">
            {layout.brief.map((b, i) => (
              <li key={i} className="clay flex gap-3 p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">{i + 1}</span>
                <p className="font-serif text-[15px] leading-snug">{b.text}{cite(b.id)}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {layout.glance || layout.note ? (
        <section aria-label="The world today" className="grid gap-4 lg:grid-cols-[1fr_300px]">
          {layout.glance ? (
            <div>
              <h2 className="mb-2 border-b-2 border-accent pb-1 text-xs font-bold uppercase tracking-[0.15em] text-accent">The world today</h2>
              <p className="font-serif text-[17px] leading-relaxed first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-5xl first-letter:font-black first-letter:leading-[0.85]">{layout.glance}</p>
            </div>
          ) : null}
          {layout.note ? (
            <aside className="clay-inset self-start p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">From the editor</p>
              <p className="mt-1 font-serif italic leading-relaxed">{layout.note}</p>
            </aside>
          ) : null}
        </section>
      ) : null}

      {layout.sectors.length ? (
        <section id="sectors" aria-label="Who wins, who loses" className="scroll-mt-24">
          <h2 className="mb-2 border-b-2 border-accent pb-1 text-xs font-bold uppercase tracking-[0.15em] text-accent">Who wins, who loses today</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {layout.sectors.map((x, i) => (
              <li key={i} className={cn("clay p-3.5", x.move === "up" ? "clay-good" : x.move === "down" ? "clay-bad" : "clay-warn")}>
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Move move={x.move} />{x.name}</p>
                <p className="mt-1 text-sm leading-snug text-fg/85">{x.why}</p>
                <p className="mt-1">{x.ids.slice(0, 3).map((id) => <span key={id}>{cite(id)}</span>)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {layout.sections.map((sec) => (
        <section key={sec.key} id={`sec-${sec.key}`} aria-label={sec.title} className="scroll-mt-24">
          <div className="mb-3 flex items-center justify-between rounded-xl bg-accent px-4 py-2 text-accent-fg shadow-md">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em]">{sec.title}</h2>
            <span className="text-xs opacity-90">{sec.ids.length} {sec.ids.length === 1 ? "story" : "stories"}</span>
          </div>
          <div className="grid items-start gap-3 md:grid-cols-2">
            {sec.ids.map((id) => byId.get(id)).filter((s): s is PaperStoryView => !!s).map((s) => (
              <StoryCard key={s.id} s={s} tz={tz} topics={topics} open={open.has(s.id)} onToggle={() => toggle(s.id)} />
            ))}
          </div>
        </section>
      ))}

      {layout.opportunities.length || layout.today.length ? (
        <section id="act" aria-label="What to do" className="grid scroll-mt-24 gap-4 md:grid-cols-2">
          {layout.opportunities.length ? (
            <div className="clay p-4">
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-accent">Opportunities for {company}</h2>
              <ul className="mt-2 space-y-2">{layout.opportunities.map((o, i) => <li key={i} className="flex gap-2 text-sm"><span className="font-bold text-good">+</span><span>{o.idea}{cite(o.id)}</span></li>)}</ul>
            </div>
          ) : null}
          {layout.today.length ? (
            <div className="clay p-4">
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-accent">Do today</h2>
              <ul className="mt-2 space-y-1.5">
                {layout.today.map((t, i) => (
                  <li key={i}>
                    <label className={cn("flex cursor-pointer items-start gap-2 text-sm", done.has(i) && "text-subtle line-through")}>
                      <input type="checkbox" className="mt-0.5" checked={done.has(i)} onChange={() => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />{t}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <p className="text-center font-serif text-xs italic text-subtle">Every story was read from its publisher and written up from the article only. Open any story for the full write-up, or go to the original.</p>
    </div>
  );
}
