"use client";

import { InfoTip } from "@/components/info-tip";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { GripVertical, Pin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { moveStageAction, orderDealsAction, resetOrderAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { StageMoveSheet, type PendingMove } from "./deal-rich";
import { DEFAULT_REASONS, needsDetails, type FieldDef, type Reasons } from "@/lib/sales/fields";
import { applyFilters, DealTable, FilterBar, NO_FILTERS, type Filters } from "./pipeline-table";
import { ImportExport } from "./pipeline-io";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { DealCard } from "@/lib/sales/deals";
import type { Stage, Transition } from "@/lib/sales/stages";
import { ago, ChannelIcon, money, Priority, PriorityLegend } from "./util";

// the move sheet (closing checklists, reasons) lives with the deal components; re-exported for older imports
export { StageMoveSheet, type PendingMove } from "./deal-rich";

type SortKey = "priority" | "value" | "touch" | "stuck" | "newest";
const SORTS: [SortKey, string][] = [["priority", "Priority + your order"], ["value", "Value"], ["touch", "Last touch"], ["stuck", "Longest in stage"], ["newest", "Newest"]];

/** What is under your finger or pointer wins: a card first (to reorder), else the column (to move stage). */
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const cards = hits.filter((h) => String(h.id).startsWith("card-"));
  if (cards.length) return cards;
  return hits.length ? hits : rectIntersection(args);
};

function sortDeals(list: DealCard[], key: SortKey): DealCard[] {
  const t = (x: string | null) => (x ? new Date(x).getTime() : 0);
  const by: Record<SortKey, (a: DealCard, b: DealCard) => number> = {
    // the deals you placed by hand first, in your order; then everything else by priority
    priority: (a, b) =>
      a.manual_rank != null && b.manual_rank != null ? a.manual_rank - b.manual_rank
      : a.manual_rank != null ? -1 : b.manual_rank != null ? 1 : b.priority - a.priority,
    value: (a, b) => Number(b.value_usd ?? 0) - Number(a.value_usd ?? 0),
    touch: (a, b) => t(b.last_touch_at) - t(a.last_touch_at),
    stuck: (a, b) => t(a.stage_changed_at) - t(b.stage_changed_at),
    newest: (a, b) => t(b.created_at) - t(a.created_at),
  };
  return [...list].sort(by[key]);
}

function CardBody({ d, s }: { d: DealCard; s: Stage | undefined }) {
  const days = Math.floor((Date.now() - new Date(d.stage_changed_at).getTime()) / 86_400_000);
  const stuck = s?.sla_days && days > s.sla_days;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug">{d.title}</p>
        <span className="flex shrink-0 items-center gap-1">
          {d.manual_rank != null ? <span title="You placed this by hand. Reset order on the column goes back to automatic." aria-label="Placed by you"><Pin className="h-3 w-3 text-subtle" /></span> : null}
          {d.fit ? <span title={`Fit ${d.fit.grade}: ${d.fit.score}/100, how well they suit your business`} className={cn("rounded px-1 text-[11px] font-semibold", d.fit.grade === "A" ? "bg-p-mint text-p-mint-fg" : d.fit.grade === "B" ? "bg-p-sky text-p-sky-fg" : d.fit.grade === "C" ? "bg-p-butter text-p-butter-fg" : "bg-muted text-subtle")}>Fit {d.fit.grade}</span> : null}
          <Priority value={d.priority} prev={d.priority_prev} why={d.priority_why} compact />
        </span>
      </div>
      {d.person_name ? <p className="truncate text-xs text-subtle">{d.person_name}{d.company_name && d.company_name !== d.title ? ` · ${d.company_name}` : ""}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
        {d.value_amount ? <span className="font-medium text-fg">{money(d.value_amount, d.currency)}</span> : null}
        {d.last_channel ? <span className="inline-flex items-center gap-1"><ChannelIcon channel={d.last_channel} className="h-3 w-3" />{ago(d.last_touch_at)}</span> : <span>no touch yet</span>}
        <span className={cn(stuck && "font-semibold text-bad")}>{days}d here</span>
        {d.open_moves ? <span className="text-accent">{d.open_moves} move{d.open_moves > 1 ? "s" : ""}</span> : null}
      </div>
      {d.priority_why?.[0] ? <p className="mt-1 line-clamp-1 text-xs text-subtle">{d.priority_why[0]}</p> : null}
    </>
  );
}

function DraggableCard({ d, s, onMove, targets, hint, dropOff }: {
  d: DealCard; s: Stage | undefined; onMove: (d: DealCard, to: number) => void; targets: Stage[];
  /** while another card of this column is dragged over this one: where it will land */
  hint: "above" | "below" | null;
  dropOff: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: d.id });
  // every card is also a drop target: drop a card of the same stage on it to put it above (or below) this one
  const drop = useDroppable({ id: `card-${d.id}`, disabled: dropOff });
  return (
    <li
      ref={(n) => {
        setNodeRef(n);
        drop.setNodeRef(n);
      }}
      className={cn("group relative rounded-xl border border-border bg-surface p-2.5 shadow-[var(--shadow-sm)] transition-opacity", isDragging && "opacity-30")}
    >
      {hint ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 h-1 rounded-full bg-accent", hint === "above" ? "-top-1.5" : "-bottom-1.5")} /> : null}
      <div className="flex gap-1.5">
        <button type="button" {...listeners} {...attributes} aria-label={`Drag ${d.title} to reorder or to another stage`} className="-ml-1 mt-0.5 h-6 cursor-grab touch-none rounded text-subtle/50 hover:text-fg active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </button>
        <Link href={`/sales/deal/${d.id}`} className="min-w-0 flex-1">
          <CardBody d={d} s={s} />
        </Link>
      </div>
      {targets.length ? (
        <Select value="" onChange={(e) => e.target.value && onMove(d, Number(e.target.value))} aria-label="Move to stage" className="mt-2 h-7 text-xs md:hidden">
          <option value="">Move to…</option>
          {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      ) : null}
    </li>
  );
}

function Column({ s, count, total, cur, state, onReset, children }: { s: Stage; count: number; total: number; cur: string; state: "idle" | "allowed" | "blocked" | "home"; onReset?: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${s.id}`, disabled: state === "blocked" });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "w-72 shrink-0 rounded-2xl p-1.5 transition-all",
        state === "allowed" && "bg-accent-muted/60 ring-2 ring-accent/40",
        state === "allowed" && isOver && "bg-accent-muted ring-accent",
        state === "blocked" && "opacity-35",
      )}
    >
      <header className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
          {s.name}
          <span className="font-normal text-subtle">{count}</span>
        </h2>
        <span className="flex items-baseline gap-2 text-xs tabular text-subtle">
          {onReset ? <button type="button" onClick={onReset} title="Forget the order you set by hand; go back to automatic priority" className="underline-offset-2 hover:text-fg hover:underline">Reset order</button> : null}
          {total ? money(Math.round(total), cur) : ""}
        </span>
      </header>
      {children}
    </section>
  );
}

/** What the two badges on a card mean, the colours, and dragging. */
function BoardHelp() {
  return (
    <div className="space-y-2">
      <p><span className="font-semibold">Each card has two badges:</span></p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li><span className="font-semibold">Fit A to D</span>: how well they suit your business (industry, country, need, size, money). Open the deal to see the fit score out of 100 and why.</li>
        <li><span className="font-semibold">The number</span> (0 to 100) is priority: how much they need you right now. It rises and falls with replies, quote opens, meetings and deal size.</li>
      </ul>
      <PriorityLegend />
      <p><span className="font-semibold">Drag</span> a card by its handle onto another card in its column to put it above or below (a pin shows; Reset order undoes it), or onto another stage to move the deal.</p>
    </div>
  );
}

/** report: column totals are added up in USD and shown in your report currency (rate = 1 unit in USD). */
export function PipelineBoard({ stages, deals, transitions, report = { cur: "INR", rate: 0.012 }, reasons = DEFAULT_REASONS, customDefs = [], team = [], pipelines = [], pipelineId = null }: {
  stages: Stage[]; deals: DealCard[]; transitions: Transition[]; report?: { cur: string; rate: number }; reasons?: Reasons; customDefs?: FieldDef[];
  team?: { id: number; name: string }[]; pipelines?: { id: number; name: string }[]; pipelineId?: number | null;
}) {
  const wonFields = customDefs.filter((c) => c.required_to_win);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [items, setItems] = useState(deals);
  const [query, setQuery] = useState("");
  // a pipeline with no open stages (say, Retainers: won and live only) starts on All, not on an empty Open view
  const [show, setShow] = useState<"open" | "won" | "parked" | "lost" | "all">(stages.some((s) => s.category === "open") ? "open" : "all");
  const [view, setView] = useState<"board" | "ranked">("board");
  const [sort, setSort] = useState<SortKey>("priority");
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [dragging, setDragging] = useState<DealCard | null>(null);
  const [overCard, setOverCard] = useState<number | null>(null);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  useEffect(() => setItems(deals), [deals]);
  useEffect(() => {
    try {
      const v = localStorage.getItem("sales-pipeline-view");
      const so = localStorage.getItem("sales-pipeline-sort");
      if (v === "board" || v === "ranked") setView(v);
      if (so && SORTS.some(([k]) => k === so)) setSort(so as SortKey);
    } catch {
      /* private mode */
    }
  }, []);
  const remember = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const cols = stages.filter((s) => show === "all" || s.category === show);
  const filtered = useMemo(() => {
    const qy = query.trim().toLowerCase();
    const list = qy ? items.filter((d) => [d.title, d.person_name, d.company_name, d.source, d.country, d.city, d.industry, ...(d.tags ?? [])].some((x) => x?.toLowerCase().includes(qy))) : items;
    return sortDeals(applyFilters(list, filters), sort);
  }, [items, query, sort, filters]);
  const edgesFrom = (stageId: number) => transitions.filter((t) => t.from_stage === stageId);

  const move = (d: DealCard, toId: number) => {
    if (toId === d.stage_id) return;
    const t = transitions.find((x) => x.from_stage === d.stage_id && x.to_stage === toId);
    const to = stages.find((s) => s.id === toId)!;
    if (!t) return toast(`${d.stage_name} cannot go to ${to.name}. Change the flow in Sales settings.`, "error");
    if (needsDetails({ category: d.stage_category }, to, t.requires)) return setPending({ deal: d, to, requires: t.requires });
    const before = items;
    setItems((cur) => cur.map((x) => (x.id === d.id ? { ...x, stage_id: toId, stage_name: to.name, stage_changed_at: new Date().toISOString() } : x)));
    start(async () => {
      const r = await moveStageAction(d.id, toId);
      if (!r.ok) {
        setItems(before);
        return toast(r.error, "error");
      }
      toast(`${d.title} → ${to.name}`);
      router.refresh();
    });
  };

  /** You dropped d on target, in the same column: d takes target's place, and the column's top down to there is saved. */
  const reorder = (d: DealCard, target: DealCard) => {
    if (sort !== "priority") return toast("Your own order shows with Sort: Priority + your order. Switch to it, then drag.", "error");
    const list = filtered.filter((x) => x.stage_id === d.stage_id);
    const from = list.findIndex((x) => x.id === d.id);
    const to = list.findIndex((x) => x.id === target.id);
    if (from < 0 || to < 0 || from === to) return;
    const next = arrayMove(list, from, to);
    // keep every card you placed before, plus everything down to where this one landed
    const lastPlaced = next.reduce((m, x, i) => (x.manual_rank != null ? i : m), -1);
    const top = next.slice(0, Math.max(to, lastPlaced) + 1);
    const rank = new Map(top.map((x, i) => [x.id, i + 1]));
    const before = items;
    setItems((cur) => cur.map((x) => (rank.has(x.id) ? { ...x, manual_rank: rank.get(x.id)! } : x)));
    start(async () => {
      const r = await orderDealsAction(d.stage_id, top.map((x) => x.id));
      if (!r.ok) {
        setItems(before);
        return toast(r.error, "error");
      }
      toast(`${d.title} placed ${to < from ? "above" : "below"} ${target.title}`);
    });
  };
  const resetColumn = (stageId: number) => {
    const before = items;
    setItems((cur) => cur.map((x) => (x.stage_id === stageId ? { ...x, manual_rank: null } : x)));
    start(async () => {
      const r = await resetOrderAction(stageId);
      if (!r.ok) {
        setItems(before);
        return toast(r.error, "error");
      }
      toast("Back to automatic order");
    });
  };

  const onDragStart = (e: DragStartEvent) => setDragging(items.find((d) => d.id === e.active.id) ?? null);
  const onDragOver = (e: DragOverEvent) => {
    const over = e.over?.id;
    setOverCard(typeof over === "string" && over.startsWith("card-") ? Number(over.slice(5)) : null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const d = dragging;
    setDragging(null);
    setOverCard(null);
    const over = e.over?.id;
    if (!d || typeof over !== "string") return;
    if (over.startsWith("card-")) {
      const target = items.find((x) => x.id === Number(over.slice(5)));
      if (!target || target.id === d.id) return;
      // on a card in the same stage: reorder; on a card in another stage: move there
      return target.stage_id === d.stage_id ? reorder(d, target) : move(d, target.stage_id);
    }
    move(d, Number(over.replace("stage-", "")));
  };
  const allowed = dragging ? new Set(edgesFrom(dragging.stage_id).map((t) => t.to_stage)) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-muted p-0.5 text-xs">
          {(["board", "ranked"] as const).map((v) => (
            <button key={v} type="button" onClick={() => { setView(v); remember("sales-pipeline-view", v); }} className={cn("rounded-md px-3 py-1", view === v ? "bg-surface text-fg shadow-[var(--shadow-sm)]" : "text-subtle hover:text-fg")}>
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search deals, people, companies, city, tag" className="h-9 max-w-xs text-sm" />
        <FilterBar deals={items} f={filters} onChange={setFilters} team={team} />
        <span className="flex-1" />
        <ImportExport pipelineId={pipelineId} />
        {view === "board" ? (
          <Select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); remember("sales-pipeline-sort", e.target.value); }} aria-label="Sort cards" className="h-9 w-44 text-xs">
            {SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
          </Select>
        ) : null}
        {(["open", "won", "parked", "lost", "all"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setShow(k)} className={cn("rounded-md border px-3 py-1 text-xs capitalize", show === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>
            {k}
          </button>
        ))}
        <span className="inline-flex items-center gap-1 text-xs text-subtle">How it works <InfoTip label="How the board works"><BoardHelp /></InfoTip></span>
        {busy ? <span className="text-xs text-subtle">Saving…</span> : null}
      </div>

      {view === "ranked" ? (
        <DealTable deals={filtered.filter((d) => cols.some((c) => c.id === d.stage_id))} stages={stages} customDefs={customDefs} team={team} pipelines={pipelines} transitions={transitions} />
      ) : (
        <>
          <DndContext id="pipeline-board" sensors={sensors} collisionDetection={collide} autoScroll={{ threshold: { x: 0.08, y: 0.12 } }} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setDragging(null); setOverCard(null); }}>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
              {cols.map((s) => {
                const list = filtered.filter((d) => d.stage_id === s.id);
                const total = list.reduce((sum, d) => sum + Number(d.value_usd ?? 0), 0) / (report.rate > 0 ? report.rate : 1);
                const state = !dragging ? "idle" : dragging.stage_id === s.id ? "home" : allowed?.has(s.id) ? "allowed" : "blocked";
                return (
                  <Column key={s.id} s={s} count={list.length} total={total} cur={report.cur} state={state} onReset={sort === "priority" && list.some((d) => d.manual_rank != null) ? () => resetColumn(s.id) : undefined}>
                    <ul className="min-h-16 space-y-2">
                      {list.map((d, i) => (
                        <DraggableCard
                          key={d.id}
                          d={d}
                          s={s}
                          onMove={move}
                          dropOff={state === "blocked"}
                          hint={dragging && overCard === d.id && dragging.id !== d.id && dragging.stage_id === s.id
                            ? (list.findIndex((x) => x.id === dragging.id) < i ? "below" : "above")
                            : null}
                          targets={edgesFrom(d.stage_id).map((t) => stages.find((x) => x.id === t.to_stage)).filter((x): x is Stage => !!x && x.active)}
                        />
                      ))}
                      {!list.length ? <li className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-subtle">{dragging && state === "allowed" ? "Drop here" : "Empty"}</li> : null}
                    </ul>
                  </Column>
                );
              })}
            </div>
            <DragOverlay dropAnimation={null}>
              {dragging ? (
                <div className="w-72 rotate-1 rounded-xl border border-accent/50 bg-surface p-2.5 shadow-[var(--shadow-lg)]">
                  <CardBody d={dragging} s={stages.find((x) => x.id === dragging.stage_id)} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}
      <StageMoveSheet pending={pending} onDone={() => setPending(null)} reasons={reasons} wonFields={wonFields} />
    </div>
  );
}
