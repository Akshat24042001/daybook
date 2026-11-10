"use client";

import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { moveStageAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { StageMoveSheet, type PendingMove } from "./deal-rich";
import { DEFAULT_REASONS, needsDetails, type FieldDef, type Reasons } from "@/lib/sales/fields";
import { applyFilters, DealTable, FilterBar, NO_FILTERS, type Filters } from "./pipeline-table";
import { ImportExport } from "./pipeline-io";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { DealCard } from "@/lib/sales/deals";
import type { Stage, Transition } from "@/lib/sales/stages";
import { ago, ChannelIcon, money, Priority } from "./util";

// the move sheet (closing checklists, reasons) lives with the deal components; re-exported for older imports
export { StageMoveSheet, type PendingMove } from "./deal-rich";

type SortKey = "priority" | "value" | "touch" | "stuck" | "newest";
const SORTS: [SortKey, string][] = [["priority", "Priority"], ["value", "Value"], ["touch", "Last touch"], ["stuck", "Longest in stage"], ["newest", "Newest"]];

function sortDeals(list: DealCard[], key: SortKey): DealCard[] {
  const t = (x: string | null) => (x ? new Date(x).getTime() : 0);
  const by: Record<SortKey, (a: DealCard, b: DealCard) => number> = {
    priority: (a, b) => b.priority - a.priority,
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
          {d.fit ? <span title={`Fit ${d.fit.score}/100`} className={cn("rounded px-1 text-[11px] font-semibold", d.fit.grade === "A" ? "bg-p-mint text-p-mint-fg" : d.fit.grade === "B" ? "bg-p-sky text-p-sky-fg" : d.fit.grade === "C" ? "bg-p-butter text-p-butter-fg" : "bg-muted text-subtle")}>{d.fit.grade}</span> : null}
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

function DraggableCard({ d, s, onMove, targets }: { d: DealCard; s: Stage | undefined; onMove: (d: DealCard, to: number) => void; targets: Stage[] }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: d.id });
  return (
    <li ref={setNodeRef} className={cn("group rounded-xl border border-border bg-surface p-2.5 shadow-[var(--shadow-sm)] transition-opacity", isDragging && "opacity-30")}>
      <div className="flex gap-1.5">
        <button type="button" {...listeners} {...attributes} aria-label={`Drag ${d.title} to another stage`} className="-ml-1 mt-0.5 h-6 cursor-grab touch-none rounded text-subtle/50 hover:text-fg active:cursor-grabbing">
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

function Column({ s, count, total, cur, state, children }: { s: Stage; count: number; total: number; cur: string; state: "idle" | "allowed" | "blocked" | "home"; children: React.ReactNode }) {
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
        <span className="text-xs tabular text-subtle">{total ? money(Math.round(total), cur) : ""}</span>
      </header>
      {children}
    </section>
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

  const onDragStart = (e: DragStartEvent) => setDragging(items.find((d) => d.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    const d = dragging;
    setDragging(null);
    const over = e.over?.id;
    if (!d || typeof over !== "string") return;
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
        {busy ? <span className="text-xs text-subtle">Saving…</span> : null}
      </div>

      {view === "ranked" ? (
        <DealTable deals={filtered.filter((d) => cols.some((c) => c.id === d.stage_id))} stages={stages} customDefs={customDefs} team={team} pipelines={pipelines} transitions={transitions} />
      ) : (
        <>
          <p className="hidden text-xs text-subtle md:block">Drag a card by its handle. While you drag, the stages it can move to light up; the rest fade.</p>
          <DndContext id="pipeline-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
              {cols.map((s) => {
                const list = filtered.filter((d) => d.stage_id === s.id);
                const total = list.reduce((sum, d) => sum + Number(d.value_usd ?? 0), 0) / (report.rate > 0 ? report.rate : 1);
                const state = !dragging ? "idle" : dragging.stage_id === s.id ? "home" : allowed?.has(s.id) ? "allowed" : "blocked";
                return (
                  <Column key={s.id} s={s} count={list.length} total={total} cur={report.cur} state={state}>
                    <ul className="min-h-16 space-y-2">
                      {list.map((d) => (
                        <DraggableCard
                          key={d.id}
                          d={d}
                          s={s}
                          onMove={move}
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
