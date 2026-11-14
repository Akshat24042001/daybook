"use client";

import {
  ArrowUpRight, Ban, Briefcase, CheckCircle2, ChevronDown, Clock, Copy, Eye, EyeOff, Flame, HelpCircle, Lightbulb, Linkedin, Loader2, Mail, MapPin,
  MessageCircle, Phone, Plus, Search, Sparkles, Target, TriangleAlert, Wallet, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addBlockAction, radarBriefAction, radarDraftAction, radarHideAction, radarSeenAction, radarStatusAction, radarToDealAction,
} from "@/app/sales-actions";
import { Button, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { MoveRow } from "@/lib/sales/moves";
import type { RadarBrief } from "@/lib/sales/radar-brief";
import { platformOf } from "@/lib/sales/reply-targets";
import { MoveCard } from "./moves-view";
import { QuickLinks } from "./quick-links";
import { PosterLine, WhoPanel, whenLabel } from "./radar-who";
import { ResearchSheet } from "./research-sheet";
import type { RadarItem } from "./radar-view";
import { ago } from "./util";
import { contactsOf, dedupeKey, hoursSince, isPaid, isReady, priority } from "@/lib/sales/radar-rank";
import { ReadyPack } from "./radar-ready";
import { SalesChat } from "./sales-chat";
import { Ago } from "@/components/sales/ago";
import { BookMeeting, TripBadge } from "./radar-trip";

// ------------------------------------------------------------------ ranking lives in lib/sales/radar-rank (pure, tested)

type Sort = "first" | "newest" | "best";
type Only = "all" | "ready" | "unread" | "direct" | "free" | "paid";

// ------------------------------------------------------------------ the board

export function RadarBoard({ items, googleReady, tz, emptyText, voiceEnabled = false, targets = [], target = null, onTarget }: {
  items: RadarItem[]; googleReady: boolean; tz: string; emptyText: string; voiceEnabled?: boolean;
  /** your targets and trips, to show only the leads one of them found */
  targets?: { id: number; name: string; trip: boolean }[]; target?: number | null; onTarget?: (id: number | null) => void;
}) {
  const [sort, setSort] = useState<Sort>("first");
  const [only, setOnly] = useState<Only>("all");
  const [showHidden, setShowHidden] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => {
    const live = items.filter((i) => !gone.has(i.id) && (showHidden || !i.hidden) && (target == null || i.hunt_id === target)).map((i) => (seen.has(i.id) && !i.seen_at ? { ...i, seen_at: new Date().toISOString() } : i));
    // one row per requirement; the best copy wins, the others are counted
    const groups = new Map<string, RadarItem[]>();
    for (const i of live) groups.set(dedupeKey(i), [...(groups.get(dedupeKey(i)) ?? []), i]);
    const out = [...groups.values()].map((g) => {
      const best = [...g].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
      return { it: best, also: g.length - 1, ids: g.map((x) => x.id), p: priority(best, now) };
    });
    const filtered = out.filter(({ it }) => {
      const c = contactsOf(it);
      return only === "ready" ? isReady(it) : only === "unread" ? !it.seen_at : only === "direct" ? c.emails.length + c.phones.length > 0 || !!c.linkedin : only === "paid" ? isPaid(it.url) : only === "free" ? !isPaid(it.url) : true;
    });
    const t = (i: RadarItem) => new Date(i.posted_at ?? i.found_at).getTime();
    return filtered.sort((a, b) => (sort === "first" ? b.p.value - a.p.value : sort === "newest" ? t(b.it) - t(a.it) : (b.it.score ?? -1) - (a.it.score ?? -1)) || t(b.it) - t(a.it));
  }, [items, gone, showHidden, seen, only, sort, now, target]);

  const unread = rows.filter((r) => !r.it.seen_at).length;
  // leads being prepared in the background: look again every half minute until they are ready
  const preparing = rows.some((r) => r.it.prep && !isReady(r.it) && now - new Date(r.it.prep.started_at).getTime() < 30 * 60_000);
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(t);
  }, [preparing, router]);
  const ready = rows.filter((r) => isReady(r.it)).length;
  const current = rows.find((r) => r.it.id === sel) ?? null;

  // open the first lead on wide screens so the right pane is never empty
  useEffect(() => {
    if (sel === null && rows.length && typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) setSel(rows[0].it.id);
  }, [rows, sel]);

  const open = useCallback((id: number) => {
    setSel(id);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSheet(true);
    if (!seen.has(id)) {
      setSeen((s) => new Set(s).add(id));
      void radarSeenAction([id]);
    }
    listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [seen]);

  // the lead you open counts as read
  useEffect(() => {
    if (sel !== null && current && !current.it.seen_at && !seen.has(sel)) {
      setSeen((s) => new Set(s).add(sel));
      void radarSeenAction([sel]);
    }
  }, [sel, current, seen]);

  const drop = useCallback((id: number) => {
    const idx = rows.findIndex((r) => r.it.id === id);
    // every copy of the same requirement goes together
    setGone((g) => { const n = new Set(g); for (const x of rows[idx]?.ids ?? [id]) n.add(x); return n; });
    const next = rows[idx + 1] ?? rows[idx - 1];
    setSel(next ? next.it.id : null);
  }, [rows]);

  // keyboard: j/k or arrows to move, o opens the post, s skips, h hides, d drafts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = rows.findIndex((r) => r.it.id === sel);
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); const n = rows[Math.min(rows.length - 1, idx + 1)]; if (n) open(n.it.id); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); const n = rows[Math.max(0, idx - 1)]; if (n) open(n.it.id); }
      else if (e.key === "o" && current?.it.url?.startsWith("http")) window.open(current.it.url, "_blank", "noopener");
      else if ((e.key === "s" || e.key === "h") && current) document.getElementById(`radar-${e.key === "s" ? "skip" : "hide"}`)?.click();
      else if (e.key === "d" && current) document.getElementById("radar-draft")?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel, current, open]);

  const hiddenCount = items.filter((i) => i.hidden).length;
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Seg label="Order" value={sort} onChange={setSort} options={[["first", "Do first"], ["newest", "Newest"], ["best", "Best match"]]} />
      <Seg label="Show" value={only} onChange={setOnly} options={[["all", "All"], ["ready", `Ready${ready ? ` · ${ready}` : ""}`], ["unread", `Unread${unread ? ` · ${unread}` : ""}`], ["direct", "Contact found"], ["free", "Free to reply"], ["paid", "Paid sites"]]} />
      {targets.length ? (
        <label className="flex items-center gap-1.5 text-subtle">Target
          <select aria-label="Target" value={target ?? ""} onChange={(e) => onTarget?.(e.target.value ? Number(e.target.value) : null)} className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-fg">
            <option value="">All leads</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.trip ? "Trip: " : ""}{t.name} ({items.filter((i) => i.hunt_id === t.id && !i.hidden).length})</option>)}
          </select>
        </label>
      ) : null}
      <label className="flex items-center gap-1.5 text-subtle"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Hidden ({hiddenCount})</label>
      {rows.length ? (
        <button type="button" className="rounded-md px-2 py-1 text-subtle hover:bg-muted" disabled={busy} onClick={() => start(async () => {
          const ids = rows.map((r) => r.it.id).filter((id) => !items.find((i) => i.id === id)?.hidden);
          if (ids.length > 3 && !confirm(`Hide all ${ids.length} leads in this view? "Hidden" brings them back.`)) return;
          const r = await radarHideAction(ids, true);
          toast(r.ok ? `Hid ${r.changed}` : r.error, r.ok ? "ok" : "error");
          router.refresh();
        })}>Hide all shown</button>
      ) : null}
      {sort === "first" ? <span className="w-full text-subtle">Do first ranks by how fresh it is (the first replies win most work), how good a fit, and whether you can reach them directly. Paid sites with no contact go lower.</span> : null}
      <span className="ml-auto hidden text-subtle lg:inline">Keys: <kbd className="kbd">j</kbd>/<kbd className="kbd">k</kbd> move · <kbd className="kbd">o</kbd> open post · <kbd className="kbd">d</kbd> draft · <kbd className="kbd">s</kbd> skip · <kbd className="kbd">h</kbd> hide</span>
    </div>
  );

  if (!rows.length) {
    return <div className="space-y-3">{toolbar}<p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-subtle">{only === "all" ? emptyText : "Nothing in this view. Try All."}</p></div>;
  }

  const detail = current ? <Detail key={current.it.id} it={current.it} ids={current.ids} rank={rows.indexOf(current) + 1} also={current.also} reasons={current.p.reasons} sort={sort} googleReady={googleReady} tz={tz} onDrop={drop} voiceEnabled={voiceEnabled} /> : null;

  return (
    <div className="space-y-3">
      {toolbar}
      <div className="grid gap-4 lg:grid-cols-[minmax(340px,420px)_1fr]">
        <div ref={listRef} className="space-y-1.5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1" role="listbox" aria-label="Leads">
          {rows.map(({ it, also, p }, i) => (
            <Row key={it.id} it={it} rank={i + 1} also={also} reasons={p.reasons} first={sort === "first" && i < 3} active={it.id === sel} tz={tz} now={now} onOpen={() => open(it.id)} />
          ))}
        </div>
        <div className="hidden lg:block">
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">{detail}</div>
        </div>
      </div>
      <Sheet open={sheet && !!current} onOpenChange={setSheet} title={current?.it.title.slice(0, 80) ?? "Lead"}>
        {detail}
      </Sheet>
    </div>
  );
}

function Seg<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-border bg-surface" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k} className={cn("px-2.5 py-1.5", value === k ? "bg-accent text-accent-fg" : "text-subtle hover:bg-muted hover:text-fg")}>{l}</button>
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ one row in the list

function Row({ it, rank, also, reasons, first, active, tz, now, onOpen }: { it: RadarItem; rank: number; also: number; reasons: string[]; first: boolean; active: boolean; tz: string; now: number; onOpen: () => void }) {
  const h = hoursSince(it, now);
  const c = contactsOf(it);
  const paid = isPaid(it.url);
  const where = platformOf(it.url);
  const need = it.brief?.need ?? (it.fit as { need?: string } | null)?.need ?? it.fit?.why ?? null;
  const unread = !it.seen_at;
  return (
    <button
      type="button" data-id={it.id} role="option" aria-selected={active} onClick={onOpen}
      className={cn(
        "group block w-full rounded-xl border p-2.5 text-left transition-colors",
        active ? "border-accent bg-accent-muted/60 shadow-[var(--shadow-sm)]" : "border-border bg-surface hover:border-accent/50 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex w-9 shrink-0 flex-col items-center gap-1">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg font-display text-sm tabular",
            (it.score ?? 0) >= 80 ? "bg-p-mint text-p-mint-fg" : (it.score ?? 0) >= 65 ? "bg-p-sky text-p-sky-fg" : "bg-muted text-subtle")} title="Fit score">{it.score ?? "?"}</span>
          {first ? <span className="rounded bg-accent px-1 text-[9px] font-bold uppercase text-accent-fg">#{rank}</span> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px]">
            {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
            <span suppressHydrationWarning className={cn("tabular", h < 24 ? "font-semibold text-fg" : "text-subtle")}>{h < 24 ? ago(it.posted_at ?? it.found_at) : whenLabel(it.posted_at ?? it.found_at, tz).replace(/, \d.*$/, "")}</span>
            <span className="text-subtle">· {where?.key === "page" ? it.source ?? where.name : where?.name ?? it.source ?? "manual"}</span>
            {it.fit?.country ? <span className="truncate text-subtle">· {it.fit.country}</span> : null}
          </p>
          <p className={cn("mt-0.5 line-clamp-2 text-[13px] leading-snug", unread ? "font-semibold" : "font-medium")}>{it.title}</p>
          {need ? <p className="mt-0.5 line-clamp-1 text-xs text-subtle">{need}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
            {it.trip ? <Tag tone="warn"><MapPin className="h-2.5 w-2.5" /> {it.trip.city} trip</Tag> : null}
            {it.lead_kind === "prospect" ? <Tag>local business</Tag> : it.lead_kind === "news" ? <Tag>local news</Tag> : null}
            {isReady(it) ? <Tag tone="good"><CheckCircle2 className="h-2.5 w-2.5" /> Ready</Tag> : it.prep && now - new Date(it.prep.started_at).getTime() < 30 * 60_000 ? <Tag><Loader2 className="h-2.5 w-2.5 animate-spin" /> Preparing</Tag> : null}
            {c.emails.length ? <Tag tone="good"><Mail className="h-2.5 w-2.5" /> email</Tag> : null}
            {c.phones.length ? <Tag tone="good"><Phone className="h-2.5 w-2.5" /> phone</Tag> : null}
            {c.linkedin ? <Tag tone="good"><Linkedin className="h-2.5 w-2.5" /> LinkedIn</Tag> : null}
            {paid && !c.emails.length && !c.phones.length ? <Tag tone="warn">paid to reply</Tag> : null}
            {it.fit?.budget ? <Tag><Wallet className="h-2.5 w-2.5" /> {String(it.fit.budget).slice(0, 24)}</Tag> : null}
            {it.fit?.urgency === "high" ? <Tag tone="bad"><Flame className="h-2.5 w-2.5" /> urgent</Tag> : null}
            {also ? <Tag>+{also} more source{also > 1 ? "s" : ""}</Tag> : null}
            {first && reasons[0] ? <span className="text-accent">{reasons[0]}</span> : null}
          </p>
        </div>
      </div>
    </button>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  return <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium", tone === "good" ? "bg-p-mint text-p-mint-fg" : tone === "warn" ? "bg-p-butter text-p-butter-fg" : tone === "bad" ? "bg-p-rose text-p-rose-fg" : "bg-muted text-subtle")}>{children}</span>;
}

// ------------------------------------------------------------------ the selected lead

function Section({ icon: Icon, title, children, tone }: { icon: typeof Target; title: string; children: React.ReactNode; tone?: "accent" | "warn" }) {
  return (
    <section className={cn("rounded-xl border p-3", tone === "accent" ? "border-accent/30 bg-accent-muted/30" : tone === "warn" ? "border-warn/30 bg-warn/5" : "border-border bg-surface")} aria-label={title}>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle"><Icon className="h-3.5 w-3.5" />{title}</h3>
      {children}
    </section>
  );
}

function Detail({ it, ids, rank, also, reasons, sort, googleReady, tz, onDrop, voiceEnabled }: { it: RadarItem; ids: number[]; rank: number; also: number; reasons: string[]; sort: Sort; googleReady: boolean; tz: string; onDrop: (id: number) => void; voiceEnabled: boolean }) {
  const [brief, setBrief] = useState<RadarBrief | null>(it.brief ?? null);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [move, setMove] = useState<MoveRow | null>(null);
  const [research, setResearch] = useState(false);
  const [full, setFull] = useState(false);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const f = it.fit ?? {};
  const where = platformOf(it.url);
  const paid = isPaid(it.url);
  const c = contactsOf(it);
  const direct = c.emails.length + c.phones.length > 0 || !!c.linkedin;
  const at = it.posted_at ?? it.found_at;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });

  // the plain-language brief is made the first time you open a lead, then kept
  useEffect(() => {
    if (brief) return;
    let live = true;
    void radarBriefAction(it.id).then((r) => {
      if (!live) return;
      if (r.ok) setBrief(r.brief);
      else setBriefErr(r.error);
    });
    return () => { live = false; };
  }, [it.id, brief]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, drop = true) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast((r as { error: string }).error, "error");
    toast(msg);
    if (drop) onDrop(it.id);
    router.refresh();
  });
  const copy = (t: string, what: string) => void navigator.clipboard.writeText(t).then(() => toast(`${what} copied`), () => toast("Your browser blocked copying.", "error"));
  const opener = brief?.opener ?? f.angle ?? "";
  const subject = `About your post: ${it.title.replace(/\([^)]*\)/g, "").trim().slice(0, 70)}`;
  const firstName = c.name?.split(/\s+/).find((w) => !/^(dr|mr|mrs|ms)\.?$/i.test(w)) ?? null;
  const greeting = firstName ? `Hi ${firstName},\n\n` : "Hi,\n\n";

  return (
    <article className="space-y-3" aria-label="Selected lead">
      {/* header */}
      <header className="rounded-xl border border-border bg-surface p-3.5">
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          {sort === "first" ? <span className="rounded-md bg-accent px-1.5 py-0.5 font-bold text-accent-fg">#{rank} to do</span> : null}
          <span className={cn("rounded-md px-1.5 py-0.5 font-semibold tabular", (it.score ?? 0) >= 80 ? "bg-p-mint text-p-mint-fg" : "bg-p-sky text-p-sky-fg")}>Fit {it.score ?? "?"}</span>
          <span className="inline-flex items-center gap-1 font-semibold"><Clock className="h-3.5 w-3.5 text-subtle" />{it.posted_at ? "Posted" : "Found"} {whenLabel(at, tz)}</span>
          <span className="text-subtle">(<Ago d={at} />)</span>
          {it.trip ? <TripBadge trip={it.trip} today={today} /> : null}
          {it.lead_kind === "prospect" ? <span className="rounded-md bg-p-lilac px-1.5 py-0.5 text-p-lilac-fg">Local business we found for you: nobody posted this</span> : null}
        </p>
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <h2 className="font-display text-xl leading-snug">{it.title}</h2>
          <SalesChat focus={{ radar_item_id: it.id }} title={`Ask about: ${it.title.slice(0, 60)}`} voiceEnabled={voiceEnabled} label="Ask about this lead" />
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-subtle">
          <span>{where?.name ?? it.source ?? "manual"}{it.source && where?.key !== "page" ? ` · ${it.source}` : ""}</span>
          {f.country ? <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{f.country}</span> : null}
          {f.industry ? <span>{f.industry}</span> : null}
          {also ? <span>also found on {also} more source{also > 1 ? "s" : ""}</span> : null}
        </p>
        {reasons.length ? <p className="mt-2 flex flex-wrap gap-1 text-[11px]">{reasons.map((r) => <span key={r} className="rounded-full bg-accent-muted px-2 py-0.5 text-accent">{r}</span>)}</p> : null}
        {it.blocked ? <p className="mt-2 rounded-md bg-p-rose px-2 py-1 text-xs text-p-rose-fg">{it.blocked}</p> : null}
        {it.known ? (
          <p className="mt-2 rounded-md bg-p-sky px-2 py-1 text-xs text-p-sky-fg">
            You already know them ({it.known.why})
            {it.known.deal_id ? <> · <a href={`/sales/deal/${it.known.deal_id}`} className="font-medium underline">{it.known.deal_title}</a>, {it.known.stage}{it.known.lost_reason ? ` (lost: ${it.known.lost_reason})` : ""}</> : null}
            {it.known.deal_id && (it.known.category === "open" || it.known.category === "parked") ? ". Making it a lead adds it to that deal." : it.known.category === "won" ? ". An existing client: making it a lead starts a new deal (repeat business)." : null}
          </p>
        ) : null}

        {/* the actions you need, one click each */}
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Reach them">
          {c.emails.map((e) => (
            <a key={e} href={`mailto:${e}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${greeting}${opener}`)}`} className="act act-primary"><Mail className="h-3.5 w-3.5" /> Email {e}</a>
          ))}
          {c.phones.map((p) => (
            <span key={p} className="inline-flex gap-1.5">
              <a href={`tel:${p.replace(/[^\d+]/g, "")}`} className="act"><Phone className="h-3.5 w-3.5" /> Call {p}</a>
              <a href={`https://wa.me/${p.replace(/\D/g, "")}?text=${encodeURIComponent(`${greeting}${opener}`)}`} target="_blank" rel="noreferrer" className="act"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
            </span>
          ))}
          {c.linkedin ? <a href={c.linkedin} target="_blank" rel="noreferrer" className="act"><Linkedin className="h-3.5 w-3.5" /> LinkedIn</a> : null}
          {it.url?.startsWith("http") ? <a href={it.url} target="_blank" rel="noreferrer" className="act">{it.lead_kind === "prospect" ? "Open their website" : it.lead_kind === "news" ? "Open the news" : "Open the post"} <ArrowUpRight className="h-3.5 w-3.5" /></a> : null}
          {opener ? <button type="button" className="act" onClick={() => copy(opener, "Opening line")}><Copy className="h-3.5 w-3.5" /> Copy opener</button> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
          {!(paid && !direct) ? (
            <Button id="radar-draft" size="sm" variant={direct ? "outline" : "primary"} disabled={busy} onClick={() => start(async () => {
              const r = await radarDraftAction(it.id);
              if (!r.ok) return toast(r.error, "error");
              setMove(r.move);
            })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {direct && (paid || !where?.replyable) ? "Draft a direct message" : where?.replyable ? `Draft reply for ${where.name}` : "Draft first message"}</Button>
          ) : null}
          {it.deal_id ? <Button size="sm" variant="outline" onClick={() => router.push(`/sales/deal/${it.deal_id}`)}>Open deal</Button> : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
              const r = await radarToDealAction(it.id);
              if (!r.ok) return toast(r.error, "error");
              router.push(`/sales/deal/${r.id}`);
            })}><Plus className="h-3.5 w-3.5" /> Make it a lead</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setResearch(true)}>{it.researched_at ? <CheckCircle2 className="h-3.5 w-3.5 text-good" /> : <Search className="h-3.5 w-3.5" />} Research</Button>
          <span className="ml-auto flex flex-wrap gap-1">
            <Button id="radar-skip" size="sm" variant="ghost" onClick={() => act(async () => { for (const x of ids) { const r = await radarStatusAction(x, "skipped"); if (!r.ok) return r; } return { ok: true }; }, "Skipped")}><X className="h-3.5 w-3.5" /> Skip</Button>
            <Button id="radar-hide" size="sm" variant="ghost" onClick={() => act(() => radarHideAction(ids, !it.hidden), it.hidden ? "Back in the list" : "Hidden")}>{it.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {it.hidden ? "Unhide" : "Hide"}</Button>
            <Button size="sm" variant="ghost" onClick={() => act(async () => { for (const x of ids) { const r = await radarStatusAction(x, "rejected"); if (!r.ok) return r; } return { ok: true }; }, "Marked not relevant")}>Not relevant</Button>
            {!it.blocked && (f.website || f.company || f.contact) ? (
              <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => {
                const [kind, value] = f.website ? ["domain", f.website] as const : f.company ? ["company", f.company] as const : ["person", f.contact!] as const;
                if (confirm(`Never contact ${value}? Future leads from them are dropped.`)) act(() => addBlockAction(kind, value, "from radar"), "Added to do-not-contact");
              }}><Ban className="h-3.5 w-3.5" /> Never contact</Button>
            ) : null}
          </span>
        </div>
        {it.trip || it.lead_kind === "prospect" || it.meeting_at ? <div className="mt-2 border-t border-border pt-2"><BookMeeting itemId={it.id} trip={it.trip ?? null} today={today} booked={it.meeting_at ?? null} /></div> : null}
      </header>

      {it.prep && !move ? <ReadyPack itemId={it.id} prep={it.prep} draft={it.ready_draft ?? null} subject={it.ready_subject ?? null} channel={it.ready_channel ?? null} /> : null}
      {move ? <MoveCard m={move} googleReady={googleReady} onGone={() => onDrop(it.id)} /> : null}

      {/* what they need */}
      <Section icon={Target} title="What they need" tone="accent">
        {brief ? (
          <>
            <p className="text-[15px] leading-relaxed">{brief.need}</p>
            {brief.deliverables.length ? <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{brief.deliverables.map((d) => <li key={d} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{d}</li>)}</ul> : null}
            <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {brief.budget ?? f.budget ? <Tag><Wallet className="h-3 w-3" /> {brief.budget ?? f.budget}</Tag> : <Tag>No budget stated</Tag>}
              {brief.timing ? <Tag><Clock className="h-3 w-3" /> {brief.timing}</Tag> : null}
              {brief.size ? <Tag><Briefcase className="h-3 w-3" /> {brief.size} job</Tag> : null}
            </p>
          </>
        ) : briefErr ? (
          <p className="text-sm">{(f as { need?: string }).need ?? f.why ?? it.title}<span className="mt-1 block text-xs text-subtle">{briefErr}</span></p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-subtle"><Loader2 className="h-3.5 w-3.5 animate-spin" />{(f as { need?: string }).need ?? "Reading the requirement…"}</p>
        )}
      </Section>

      {/* how you can help */}
      <Section icon={Lightbulb} title="How you can help">
        {brief?.help.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{brief.help.map((h) => <li key={h}>{h}</li>)}</ol> : <p className="text-sm">{(f as { help?: string }).help ?? f.why ?? "Open the post to see what they want."}</p>}
        {(brief?.offers.length ? brief.offers : f.services ?? []).length ? <p className="mt-2 flex flex-wrap gap-1">{(brief?.offers.length ? brief.offers : f.services ?? []).map((s) => <span key={s} className="rounded-md border border-accent/30 px-2 py-0.5 text-xs text-accent">{s}</span>)}</p> : null}
        {f.money_leak ? <p className="mt-2 rounded-lg bg-p-butter px-2 py-1 text-xs text-p-butter-fg">{f.money_leak}</p> : null}
        {opener ? (
          <div className="mt-2 rounded-lg bg-muted/60 p-2 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Open with</span>
            <p className="mt-0.5">{opener}</p>
          </div>
        ) : null}
      </Section>

      {brief?.questions.length || brief?.watch_out ? (
        <div className={cn("grid gap-3", brief?.questions.length && brief?.watch_out && "xl:grid-cols-2")}>
          {brief?.questions.length ? (
            <Section icon={HelpCircle} title="Ask them">
              <ul className="list-disc space-y-0.5 pl-5 text-sm">{brief.questions.map((x) => <li key={x}>{x}</li>)}</ul>
            </Section>
          ) : null}
          {brief?.watch_out ? <Section icon={TriangleAlert} title="Watch out" tone="warn"><p className="text-sm">{brief.watch_out}</p></Section> : null}
        </div>
      ) : null}

      {/* who */}
      <Section icon={Search} title="Who posted it">
        <PosterLine p={it.poster} />
        {!it.poster?.name && !it.poster?.username && it.author ? <p className="text-xs">{it.author}</p> : null}
        {!it.known && !it.deal_id ? <WhoPanel itemId={it.id} identity={it.identity} paid={paid} platform={where?.name ?? null} /> : null}
      </Section>

      {it.links?.length ? <div className="rounded-xl border border-border bg-surface p-3"><QuickLinks groups={it.links} fold={3} /></div> : null}

      {it.body ? (
        <Section icon={ChevronDown} title="Their post, word for word">
          <p className={cn("whitespace-pre-line text-sm text-subtle", !full && "line-clamp-[8]")}>{it.body}</p>
          {it.body.length > 500 ? <button type="button" className="mt-1 text-xs text-accent" onClick={() => setFull((x) => !x)}>{full ? "Show less" : "Show the whole post"}</button> : null}
        </Section>
      ) : null}

      {research ? <ResearchSheet open onOpenChange={setResearch} radarItemId={it.id} companyId={it.company_id ?? undefined} title={it.title.slice(0, 60)} /> : null}
    </article>
  );
}
