"use client";

import {
  ArrowUpRight, Ban, Briefcase, CheckCircle2, ChevronDown, Clock, Copy, Eye, EyeOff, Flame, HelpCircle, Lightbulb, Linkedin, Loader2, Mail, MapPin,
  MessageCircle, Phone, Plus, Search, Sparkles, Target, TriangleAlert, UserCheck, Wallet, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { safeRefresh, watchLinks } from "@/lib/client/safe-refresh";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addBlockAction, deleteRadarItemsAction, radarBriefAction, radarDraftAction, radarHideAction, radarSeenAction, radarStatusAction, radarLogAction, radarToDealAction,
} from "@/app/sales-actions";
import { Button, Input, Select, Sheet, Textarea } from "@/components/ui";
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
import { contactsOf, dedupeKey, hoursSince, isPaid, isReady, priority, reachOf } from "@/lib/sales/radar-rank";
import { ReadyPack } from "./radar-ready";
import { SalesChat } from "./sales-chat";
import { Ago } from "@/components/sales/ago";
import { BookMeeting, TripBadge } from "./radar-trip";
import { ShareLead } from "./radar-share";
import { Tabs } from "./tabs";
import { LeadSettings } from "./lead-settings";
import { ContactBar } from "./contact-bar";

// ------------------------------------------------------------------ ranking lives in lib/sales/radar-rank (pure, tested)

type Sort = "first" | "newest" | "best";
type Only = "all" | "ready" | "unread" | "dm" | "direct" | "free" | "paid";

// ------------------------------------------------------------------ the board

export function RadarBoard({ items, googleReady, tz, emptyText, voiceEnabled = false, targets = [], target = null, onTarget, initialSel = null }: {
  items: RadarItem[]; googleReady: boolean; tz: string; emptyText: string; voiceEnabled?: boolean;
  /** the lead to open first (a link to one lead, or a search result) */
  initialSel?: number | null;
  /** your targets and trips, to show only the leads one of them found */
  targets?: { id: number; name: string; trip: boolean }[]; target?: number | null; onTarget?: (id: number | null) => void;
}) {
  const [sort, setSort] = useState<Sort>("first");
  const [only, setOnly] = useState<Only>("all");
  const [showHidden, setShowHidden] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<number | null>(initialSel);
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
      return only === "ready" ? isReady(it) : only === "unread" ? !it.seen_at : only === "dm" ? reachOf(it).level === "decision_maker" : only === "direct" ? c.emails.length + c.phones.length > 0 || !!c.linkedin : only === "paid" ? isPaid(it.url) : only === "free" ? !isPaid(it.url) : true;
    });
    const t = (i: RadarItem) => new Date(i.posted_at ?? i.found_at).getTime();
    return filtered.sort((a, b) => (sort === "first" ? b.p.value - a.p.value : sort === "newest" ? t(b.it) - t(a.it) : (b.it.score ?? -1) - (a.it.score ?? -1)) || t(b.it) - t(a.it));
  }, [items, gone, showHidden, seen, only, sort, now, target]);

  const unread = rows.filter((r) => !r.it.seen_at).length;
  // leads being prepared in the background: look again every half minute until they are ready
  const preparing = rows.some((r) => r.it.prep && !isReady(r.it) && now - new Date(r.it.prep.started_at).getTime() < 30 * 60_000);
  useEffect(() => {
    if (!preparing) return;
    watchLinks();
    const t = setInterval(() => safeRefresh(router), 30_000);
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
      <Seg label="Show" value={only} onChange={setOnly} options={[["all", "All"], ["ready", `Ready${ready ? ` · ${ready}` : ""}`], ["unread", `Unread${unread ? ` · ${unread}` : ""}`], ["dm", "Decision maker reachable"], ["direct", "Any contact"], ["free", "Free to reply"], ["paid", "Paid sites"]]} />
      {targets.length ? (
        <label className="flex items-center gap-1.5 text-subtle">Target
          <Select aria-label="Target" value={target == null ? "" : String(target)} onChange={(e) => onTarget?.(e.target.value ? Number(e.target.value) : null)} className="h-7 w-auto min-w-[10rem] rounded-md px-2 pr-8 text-xs shadow-none">
            <option value="">All leads</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.trip ? "Trip: " : ""}{t.name} ({items.filter((i) => i.hunt_id === t.id && !i.hidden).length})</option>)}
          </Select>
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
  const reach = reachOf(it);
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
            {it.lead_kind === "signal" ? <Tag>hidden need</Tag> : it.lead_kind === "prospect" ? <Tag>local business</Tag> : it.lead_kind === "news" ? <Tag>local news</Tag> : null}
            {isReady(it) ? <Tag tone="good"><CheckCircle2 className="h-2.5 w-2.5" /> Ready</Tag> : it.prep && now - new Date(it.prep.started_at).getTime() < 30 * 60_000 ? <Tag><Loader2 className="h-2.5 w-2.5 animate-spin" /> Preparing</Tag> : null}
            {reach.level === "decision_maker" ? <Tag tone="good"><UserCheck className="h-2.5 w-2.5" /> decision maker</Tag> : reach.level === "generic" ? <Tag tone="warn">general inbox only</Tag> : null}
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

/** One fact in the need strip: a small label over its value. */
function Fact({ label, value }: { label: string; value: string }) {
  const unknown = /^not (stated|known)$/i.test(value);
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{label}</dt>
      <dd className={cn("truncate", unknown ? "text-subtle" : "font-medium text-fg")} title={value}>{value}</dd>
    </div>
  );
}

/** What to do with this lead now, in one line. */
function LeadNext({ it, hasMessage, direct, replyOn, channel }: { it: RadarItem; hasMessage: boolean; direct: boolean; replyOn: string | null; channel: string | null }) {
  const reach = reachOf(it);
  const text = it.deal_id ? "It is a deal now: log and follow up on the deal page."
    : hasMessage && direct ? `Send the message${channel ? ` on ${channel}` : ""}${reach.level === "decision_maker" ? " to the decision maker" : ""}, then log it below.`
    : direct ? "Write the first message (Draft), send it, then log it below."
    : replyOn ? `Reply on ${replyOn}, or find who is behind it for a direct contact (Who they are).`
    : "Find who is behind it first: open Who they are.";
  return (
    <p className="mt-2 rounded-lg border border-accent/30 bg-accent-muted/40 px-2.5 py-1.5 text-sm" aria-label="Next step">
      <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-accent">Next step</span>{text}
    </p>
  );
}

/** Already reached out, or they answered? Log it here: the lead becomes a deal with it on record. */
function RadarLog({ itemId, dealId }: { itemId: number; dealId: number | null }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ type: "whatsapp", body: "", next: "" });
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Log what you did</Button>
        <span className="text-xs text-subtle">Sent a message, called, or they replied? Log it and it becomes a deal.</span>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-accent/40 bg-surface p-3" aria-label="Log what you did">
      <div className="flex flex-wrap gap-1" role="group" aria-label="How">
        {([["whatsapp", "WhatsApp"], ["email", "Email"], ["linkedin", "LinkedIn"], ["call", "Call"], ["other", "Other"]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={f.type === k} onClick={() => setF({ ...f, type: k })} className={cn("rounded-md border px-2.5 py-1 text-xs", f.type === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>{l}</button>
        ))}
      </div>
      <Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={3} placeholder="What you sent, or what happened" aria-label="What happened" autoFocus />
      <Input value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} placeholder="Next step (optional), e.g. Follow up on Friday" aria-label="Next step after this" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy || !f.body.trim()} onClick={() => start(async () => {
          const r = await radarLogAction(itemId, { type: f.type, body: f.body, next_step: f.next || null });
          if (!r.ok) return toast(r.error, "error");
          toast(dealId ? "Logged on the deal" : "Logged. It is a deal now.");
          router.push(`/sales/deal/${r.id}`);
        })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Log it</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** Who you can reach and how: the decision maker's own contact beats a shared inbox or a front desk number. */
function ReachLine({ it }: { it: RadarItem }) {
  const r = reachOf(it);
  if (r.level === "none") return null;
  const tone = r.level === "decision_maker" || r.level === "person" ? "bg-p-mint text-p-mint-fg" : "bg-p-butter text-p-butter-fg";
  return (
    <p className={cn("mt-1.5 inline-flex flex-wrap items-center gap-1 rounded-md px-2 py-1 text-xs", tone)}>
      <UserCheck className="h-3.5 w-3.5" /> <b>{r.label}</b>{r.via.length ? <span>· {r.via.slice(0, 3).join(" · ")}</span> : null}
    </p>
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
  const subject = it.ready_subject ?? `About your post: ${it.title.replace(/\([^)]*\)/g, "").trim().slice(0, 70)}`;
  const firstName = c.name?.split(/\s+/).find((w) => !/^(dr|mr|mrs|ms)\.?$/i.test(w)) ?? null;
  const greeting = firstName ? `Hi ${firstName},\n\n` : "Hi,\n\n";
  // the full first message: the drafted one when it is ready, else the brief's opener with a greeting
  const message = (move?.draft ?? it.ready_draft ?? (opener ? `${greeting}${opener}` : "")).trim();
  const [showMsg, setShowMsg] = useState(false);
  const dm = it.prep?.pack?.decision_maker ?? null;
  const site = it.identity?.website ?? it.prep?.pack?.company?.website ?? f.website ?? null;
  const co = it.identity?.company ?? it.prep?.pack?.company?.name ?? f.company ?? null;

  return (
    <article className="space-y-3" aria-label="Selected lead">
      {/* 1. who and what: the title first, one quiet line of facts, then what they need and how to reach them */}
      <header className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {it.lead_kind === "prospect" || it.lead_kind === "signal" ? (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-p-lilac-fg">{it.lead_kind === "signal" ? "Hidden need: nobody posted this" : "Local business: nobody posted this"}</p>
            ) : null}
            <h2 className="text-lg font-semibold leading-snug text-fg sm:text-xl">{it.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
              <span title="How well it fits your business" className={cn("rounded px-1.5 py-0.5 font-semibold tabular", (it.score ?? 0) >= 80 ? "bg-p-mint text-p-mint-fg" : "bg-p-sky text-p-sky-fg")}>Fit {it.score ?? "?"}</span>
              <span suppressHydrationWarning>{it.posted_at ? "Posted" : "Found"} {whenLabel(at, tz)} (<Ago d={at} />)</span>
              <span>·</span>
              <span>{where?.name ?? it.source ?? "manual"}</span>
              {f.country ? <><span>·</span><span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{f.country}</span></> : null}
              {f.industry ? <><span>·</span><span>{f.industry}</span></> : null}
              {it.url?.startsWith("http") ? <><span>·</span><a href={it.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline">{it.lead_kind === "prospect" || it.lead_kind === "signal" ? "Their website" : it.lead_kind === "news" ? "The news" : "The post"} <ArrowUpRight className="h-3 w-3" /></a></> : null}
              {also ? <><span>·</span><span>on {also + 1} sources</span></> : null}
              {it.trip ? <TripBadge trip={it.trip} today={today} /> : null}
            </p>
          </div>
          <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <ShareLead itemId={it.id} title={it.title} />
            <SalesChat focus={{ radar_item_id: it.id }} title={`Ask about: ${it.title.slice(0, 60)}`} voiceEnabled={voiceEnabled} label="Ask about this lead" />
            <LeadSettings items={[
              { label: it.hidden ? "Unhide" : "Hide", hint: "Out of the list, kept for later", onSelect: () => act(() => radarHideAction(ids, !it.hidden), it.hidden ? "Back in the list" : "Hidden") },
              { label: "Not relevant", hint: "Teaches the radar what to skip", onSelect: () => act(async () => { for (const x of ids) { const r = await radarStatusAction(x, "rejected"); if (!r.ok) return r; } return { ok: true }; }, "Marked not relevant") },
              { label: "Research the business again", onSelect: () => setResearch(true) },
              {
                label: "Never contact", hint: "Future leads from them are dropped", hidden: !!it.blocked || !(f.website || f.company || f.contact),
                onSelect: () => {
                  const [kind, value] = f.website ? ["domain", f.website] as const : f.company ? ["company", f.company] as const : ["person", f.contact!] as const;
                  if (confirm(`Never contact ${value}? Future leads from them are dropped.`)) act(() => addBlockAction(kind, value, "from radar"), "Added to do-not-contact");
                },
              },
              {
                label: "Delete this lead", danger: true, hint: "Added by mistake? You can restore it from Deleted.",
                onSelect: () => { if (confirm(`Delete "${it.title.slice(0, 80)}"?\n\nYou can restore it any time from Deleted.`)) act(() => deleteRadarItemsAction(ids), "Deleted. Restore it from Deleted if you need it back."); },
              },
            ]} />
          </span>
        </div>
        {it.blocked ? <p className="mt-2 rounded-md bg-p-rose px-2 py-1 text-xs text-p-rose-fg">{it.blocked}</p> : null}
        {it.known ? (
          <p className="mt-2 rounded-md bg-p-sky px-2 py-1 text-xs text-p-sky-fg">
            You already know them ({it.known.why})
            {it.known.deal_id ? <> · <a href={`/sales/deal/${it.known.deal_id}`} className="font-medium underline">{it.known.deal_title}</a>, {it.known.stage}{it.known.lost_reason ? ` (lost: ${it.known.lost_reason})` : ""}</> : null}
            {it.known.deal_id && (it.known.category === "open" || it.known.category === "parked") ? ". Making it a lead adds it to that deal." : it.known.category === "won" ? ". An existing client: making it a lead starts a new deal (repeat business)." : null}
          </p>
        ) : null}

        {/* what they need: the one thing to read, with the facts that decide whether it is worth it */}
        <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5" aria-label="What they need">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">What they need</p>
          <p className="mt-0.5 text-[15px] leading-relaxed text-fg">
            {brief?.need ?? (f as { need?: string }).need ?? f.why ?? (briefErr ? it.title : <span className="inline-flex items-center gap-1.5 text-subtle"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the requirement…</span>)}
          </p>
          {!brief && briefErr ? <p className="mt-0.5 text-xs text-subtle">{briefErr}</p> : null}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <Fact label="Budget" value={brief?.budget ?? (f.budget ? String(f.budget) : null) ?? "Not stated"} />
            <Fact label="Timing" value={brief?.timing ?? (f.urgency === "high" ? "Urgent" : null) ?? "Not stated"} />
            <Fact label="Size" value={brief?.size ? `${brief.size} job` : "Not known"} />
            <Fact label="What fits" value={(brief?.offers.length ? brief.offers : f.services ?? []).slice(0, 2).join(", ") || "See How to win it"} />
          </dl>
        </div>

        {/* how to reach them: the decision maker first, each number and email one tap away */}
        <ContactBar
          people={[{
            name: dm?.name ?? c.name ?? it.poster?.name ?? it.author ?? "Them",
            role: dm ? [dm.title, "decides"].filter(Boolean).join(" · ") : null,
            phones: [...new Set([...(dm?.phone ? [dm.phone] : []), ...c.phones])], emails: [...new Set([...(dm?.email ? [dm.email] : []), ...c.emails])],
            whatsapp: it.prep?.pack?.contacts?.whatsapp ?? null, linkedin: dm?.linkedin ?? c.linkedin,
            location: [it.poster?.city, it.poster?.country ?? f.country].filter(Boolean).join(", ") || null,
          }]}
          company={site || co ? { name: co ?? site ?? "", website: site } : null}
          message={message || null} subject={move?.draft_subject ?? subject}
          headline={reachOf(it).level !== "none" ? reachOf(it).label : null}
          proof={Object.fromEntries((it.identity?.verified ?? []).map((v) => [v.kind === "email" ? v.value.toLowerCase() : v.value.replace(/\D/g, "").slice(-9), v.url]))}
        />
        {!direct && !it.known && !it.deal_id ? (
          <p className="mt-2 text-xs text-subtle">
            {paid ? `${where?.name ?? "This site"} needs an account and credits to reply. ` : ""}No direct contact yet: open <button type="button" className="font-medium text-accent hover:underline" onClick={() => { window.location.hash = "who"; }}>Who they are</button> to find the business behind it. A contact is only shown once a page proves it.
          </p>
        ) : null}
      </header>

      {/* 2. the message: in full, ready to send from the buttons above */}
      {move ? <div ref={(el) => el?.scrollIntoView({ behavior: "smooth", block: "nearest" })}><MoveCard m={move} googleReady={googleReady} onGone={() => onDrop(it.id)} /></div> : (
        <section className="rounded-xl border border-border bg-surface p-4" aria-label="Your first message">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {it.ready_draft ? `Your message${it.ready_channel ? ` · ${it.ready_channel}` : ""}` : message ? "Your opener" : "Your message"}
            </p>
            <span className="flex flex-wrap gap-1.5">
              {message ? <button type="button" className="act" onClick={() => copy(message, "Message")}><Copy className="h-3.5 w-3.5" /> Copy</button> : null}
              {!(paid && !direct) ? (
                <Button id="radar-draft" size="sm" variant={message ? "outline" : "primary"} disabled={busy} onClick={() => start(async () => {
                  const r = await radarDraftAction(it.id);
                  if (!r.ok) return toast(r.error, "error");
                  setMove(r.move);
                })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {it.ready_draft ? "Redraft" : direct && (paid || !where?.replyable) ? "Draft a direct message" : where?.replyable ? `Draft reply for ${where.name}` : "Draft first message"}</Button>
              ) : null}
            </span>
          </div>
          {message ? (
            <>
              <p className={cn("mt-2 whitespace-pre-line text-sm leading-relaxed text-fg", !showMsg && "line-clamp-[10]")}>{message}</p>
              {message.split("\n").length > 10 || message.length > 700 ? <button type="button" className="mt-1 text-xs font-medium text-accent" onClick={() => setShowMsg((x) => !x)}>{showMsg ? "Show less" : "Show all"}</button> : null}
              <p className="mt-2 text-[11px] text-subtle">{direct ? "The WhatsApp and email buttons above open with this message. " : ""}Want it different? Ask in the chat (&quot;shorter&quot;, &quot;mention a 2-week pilot&quot;): the draft here is updated.</p>
            </>
          ) : <p className="mt-2 text-sm text-subtle">{paid && !direct ? "No message until there is a way to reach them directly." : "No message yet: draft one, or ask in the chat."}</p>}
        </section>
      )}

      {/* 3. what to do now, and logging what you did */}
      <section className="rounded-xl border border-border bg-surface p-4" aria-label="Next">
        <LeadNext it={it} hasMessage={!!message} direct={direct} replyOn={where?.replyable ? where.name : null} channel={move?.channel ?? it.ready_channel ?? null} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {it.deal_id ? <Button size="sm" variant="outline" onClick={() => router.push(`/sales/deal/${it.deal_id}`)}>Open deal</Button> : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
              const r = await radarToDealAction(it.id);
              if (!r.ok) return toast(r.error, "error");
              router.push(`/sales/deal/${r.id}`);
            })}><Plus className="h-3.5 w-3.5" /> Make it a lead</Button>
          )}
          <span className="ml-auto flex gap-1">
            <Button id="radar-skip" size="sm" variant="ghost" title="Not now (s)" onClick={() => act(async () => { for (const x of ids) { const r = await radarStatusAction(x, "skipped"); if (!r.ok) return r; } return { ok: true }; }, "Skipped")}><X className="h-3.5 w-3.5" /> Skip</Button>
            <button id="radar-hide" type="button" className="sr-only" onClick={() => act(() => radarHideAction(ids, !it.hidden), it.hidden ? "Back in the list" : "Hidden")}>{it.hidden ? "Unhide" : "Hide"}</button>
          </span>
        </div>
        {it.trip || it.lead_kind === "prospect" || it.meeting_at ? <div className="mt-2 border-t border-border pt-2"><BookMeeting itemId={it.id} trip={it.trip ?? null} today={today} booked={it.meeting_at ?? null} /></div> : null}
        <RadarLog itemId={it.id} dealId={it.deal_id ?? null} />
      </section>

      <Tabs id="radar-lead" label="More about this lead" tabs={[
        { key: "win", label: "How to win it", aliases: ["need", "help"], content: (<>
      {brief?.deliverables.length ? (
        <Section icon={Target} title="What they want built">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">{brief.deliverables.map((d) => <li key={d} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{d}</li>)}</ul>
        </Section>
      ) : null}

      {/* how you can help */}
      <Section icon={Lightbulb} title="How you can help">
        {brief?.help.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{brief.help.map((h) => <li key={h}>{h}</li>)}</ol> : <p className="text-sm">{(f as { help?: string }).help ?? f.why ?? "Open the post to see what they want."}</p>}
        {(brief?.offers.length ? brief.offers : f.services ?? []).length ? <p className="mt-2 flex flex-wrap gap-1">{(brief?.offers.length ? brief.offers : f.services ?? []).map((s) => <span key={s} className="rounded-md border border-accent/30 px-2 py-0.5 text-xs text-accent">{s}</span>)}</p> : null}
        {f.money_leak ? <p className="mt-2 rounded-lg bg-p-butter px-2 py-1 text-xs text-p-butter-fg">{f.money_leak}</p> : null}
      </Section>

      {brief?.questions.length || brief?.watch_out ? (
        <Section icon={HelpCircle} title="Ask them and watch out">
          {brief?.questions.length ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Ask them</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{brief.questions.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          ) : null}
          {brief?.watch_out ? <p className="mt-2 rounded-lg bg-warn/10 px-2 py-1.5 text-sm"><b>Watch out:</b> {brief.watch_out}</p> : null}
        </Section>
      ) : null}

        </>) },
        { key: "who", label: "Who they are", aliases: ["contacts", "research", "find"], content: (<>
      {/* who */}
      <Section icon={Search} title="Who posted it">
        <PosterLine p={it.poster} />
        {!it.poster?.name && !it.poster?.username && it.author ? <p className="text-xs">{it.author}</p> : null}
        {!it.known && !it.deal_id ? <WhoPanel itemId={it.id} identity={it.identity} paid={paid} platform={where?.name ?? null} /> : null}
      </Section>

      {it.links?.length ? <Section icon={ArrowUpRight} title="Links"><QuickLinks groups={it.links} fold={3} /></Section> : null}

      {it.prep && !move ? <ReadyPack itemId={it.id} prep={it.prep} draft={it.ready_draft ?? null} subject={it.ready_subject ?? null} channel={it.ready_channel ?? null} /> : null}

        </>) },
        ...(it.body ? [{ key: "post", label: it.lead_kind === "prospect" || it.lead_kind === "signal" ? "What we found" : it.lead_kind === "news" ? "The news" : "Their post", content: (<>
      {/* the post itself, then what needs doing */}
      {it.body ? (
        <Section icon={Search} title={it.lead_kind === "prospect" || it.lead_kind === "signal" ? "What we found about them" : it.lead_kind === "news" ? "The news, word for word" : "Their post, word for word"}>
          <p className={cn("whitespace-pre-line text-sm text-subtle", !full && "line-clamp-[12]")}>{it.body}</p>
          {it.body.length > 800 ? <button type="button" className="mt-1 text-xs text-accent" onClick={() => setFull((x) => !x)}>{full ? "Show less" : "Show the whole post"}</button> : null}
        </Section>
      ) : null}

        </>) }] : []),
      ]} />

      {research ? <ResearchSheet open onOpenChange={setResearch} radarItemId={it.id} companyId={it.company_id ?? undefined} title={it.title.slice(0, 60)} /> : null}
    </article>
  );
}
