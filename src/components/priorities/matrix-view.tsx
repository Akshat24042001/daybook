"use client";
// Priorities: every open task on a 2x2 board. Drag a card between the boxes (or back to "To sort"), drag within a box
// to set your order, or use the Move menu on a card (phones, keyboards). Two boards: Value x Effort and Urgent x Important.
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, Check, GripVertical, Inbox, Loader2, Search, Sparkles, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  addTasksToTodayAction, applySuggestionsAction, dropTasksAction, placeTaskAction, suggestBoxesAction,
} from "@/app/matrix-actions";
import { InfoTip } from "@/components/info-tip";
import { useToast } from "@/components/toast";
import { Button, Chip, Input, Select, Sheet } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HUE } from "@/lib/hue";
import { AXES, BOXES, boxOf, type Box, type BoxDef, type MatrixTask, type Mode, type Suggestion } from "@/lib/matrix";
import { diffDays, fmtDuration, type DateStr } from "@/lib/time";

const TRAY = "tray";
type Where = Box | typeof TRAY;

const BOARD_NAME: Record<Mode, string> = { value: "Value × Effort", eisen: "Urgent × Important" };
const BOARD_HELP: Record<Mode, string> = {
  value: "- Quick wins (high value, low effort): do these first.\n- Big bets (high value, high effort): plan them and give them real time.\n- Fill-ins (low value, low effort): only in the gaps.\n- Time sinks (low value, high effort): drop, shrink or rethink.\n- Value = how much it moves your business, income, health or key people forward. Effort = total time and complexity, waiting included.\n- Re-sort when things change: a value guess is a guess.",
  eisen: "- Do now (urgent and important): today, yourself.\n- Schedule (important, not urgent): put a date on it. Most real progress lives here.\n- Delegate (urgent, not important): hand it off or batch it.\n- Drop (neither): delete it or park it as someday.\n- Urgency you have not set is read from the due date: due within 2 days or overdue counts as urgent (marked \"from date\").",
};
// rows and columns of the board, as the methods draw them
const LABELS: Record<Mode, { cols: [string, string]; rows: [string, string] }> = {
  value: { cols: ["Low effort", "High effort"], rows: ["High value", "Low value"] },
  eisen: { cols: ["Urgent", "Not urgent"], rows: ["Important", "Not important"] },
};

function dueText(due: DateStr | null, today: DateStr): { text: string; late: boolean } | null {
  if (!due) return null;
  const d = diffDays(due, today);
  if (d < 0) return { text: `${-d}d overdue`, late: true };
  if (d === 0) return { text: "due today", late: true };
  if (d === 1) return { text: "due tomorrow", late: false };
  const day = new Date(`${due}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return { text: `due ${day}`, late: false };
}

function sortBox(list: MatrixTask[], mode: Mode): MatrixTask[] {
  const rank = AXES[mode].rank;
  return [...list].sort((a, b) =>
    (a[rank] ?? 1e9) - (b[rank] ?? 1e9) ||
    (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
    b.created_at.localeCompare(a.created_at));
}

const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

export function MatrixView({ tasks, today, initialMode, aiReady }: { tasks: MatrixTask[]; today: DateStr; initialMode: Mode; aiReady: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const [items, setItems] = useState(tasks);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "work" | "personal">("all");
  const [project, setProject] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [sugg, setSugg] = useState<(Suggestion & { take: boolean })[] | null>(null);
  const [thinking, setThinking] = useState(false);
  useEffect(() => setItems(tasks), [tasks]);

  const switchMode = (m: Mode) => {
    setMode(m);
    const url = new URL(window.location.href);
    url.searchParams.set("board", m);
    window.history.replaceState(null, "", url.toString());
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const projects = useMemo(() => [...new Set(items.map((t) => t.project).filter(Boolean) as string[])].sort(), [items]);
  const visible = useMemo(() => {
    const qy = query.trim().toLowerCase();
    return items.filter((t) =>
      (scope === "all" || (scope === "personal") === t.is_personal) &&
      (!project || t.project === project) &&
      (!qy || t.title.toLowerCase().includes(qy) || (t.project ?? "").toLowerCase().includes(qy)));
  }, [items, query, scope, project]);

  const placed = useMemo(() => {
    const out = new Map<Where, MatrixTask[]>([[TRAY, []], ...BOXES[mode].map((b) => [b.key, []] as [Where, MatrixTask[]])]);
    const auto = new Set<number>();
    for (const t of visible) {
      const at = boxOf(t, mode, today);
      if (at?.autoUrgency) auto.add(t.id);
      out.get(at ? at.box : TRAY)!.push(t);
    }
    for (const [k, v] of out) out.set(k, k === TRAY ? [...v].sort((a, b) => b.created_at.localeCompare(a.created_at)) : sortBox(v, mode));
    return { lists: out, auto };
  }, [visible, mode, today]);

  const whereOf = (id: number): Where => {
    for (const [k, v] of placed.lists) if (v.some((t) => t.id === id)) return k;
    return TRAY;
  };

  /** Moves a card (optimistic), then saves; on failure the board goes back. */
  const move = (id: number, to: Where, beforeId: number | null) => {
    const from = whereOf(id);
    const target = (placed.lists.get(to) ?? []).filter((t) => t.id !== id);
    const at = beforeId ? Math.max(0, target.findIndex((t) => t.id === beforeId)) : target.length;
    const order = to === TRAY ? [] : [...target.slice(0, at).map((t) => t.id), id, ...target.slice(at).map((t) => t.id)];
    if (from === to && beforeId === null && to === TRAY) return;
    const ax = AXES[mode];
    const def = to === TRAY ? null : BOXES[mode].find((b) => b.key === to)!;
    const rankOf = new Map(order.map((x, i) => [x, i + 1]));
    const before = items;
    setItems((cur) => cur.map((t) => {
      if (t.id === id) {
        return { ...t, [ax.aCol]: def ? def.levels[0] : null, [ax.bCol]: def ? def.levels[1] : null, [ax.rank]: rankOf.get(id) ?? null, matrix_why: null };
      }
      return rankOf.has(t.id) ? { ...t, [ax.rank]: rankOf.get(t.id)! } : t;
    }));
    start(async () => {
      const r = await placeTaskAction(id, mode, def ? def.key : null, order);
      if (!r.ok) {
        setItems(before);
        return toast(r.error, "error");
      }
      if (from !== to) toast(`${items.find((t) => t.id === id)?.title ?? "Task"} → ${def ? def.name : "To sort"}`);
    });
  };

  const onDragStart = (e: DragStartEvent) => setDragId(Number(String(e.active.id).slice(2)));
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    if (!e.over) return;
    const id = Number(String(e.active.id).slice(2));
    const over = String(e.over.id);
    if (over.startsWith("c:")) {
      const onId = Number(over.slice(2));
      if (onId === id) return;
      move(id, whereOf(onId), onId);
    } else {
      move(id, over as Where, null);
    }
  };

  const addToday = (ids: number[], what: string) => start(async () => {
    const r = await addTasksToTodayAction(ids);
    if (!r.ok) return toast(r.error, "error");
    setItems((cur) => cur.map((t) => (ids.includes(t.id) ? { ...t, on_today: true } : t)));
    toast(`${what} on Today`);
    router.refresh();
  });
  const dropAll = (ids: number[], name: string) => {
    if (!ids.length || !confirm(`Drop all ${ids.length} task${ids.length === 1 ? "" : "s"} in ${name}? They close as dropped. Undo from History any time.`)) return;
    start(async () => {
      const r = await dropTasksAction(ids);
      if (!r.ok) return toast(r.error, "error");
      setItems((cur) => cur.filter((t) => !ids.includes(t.id)));
      toast(`Dropped ${r.dropped}. Undo from History if needed.`);
      router.refresh();
    });
  };

  const askAi = async () => {
    setThinking(true);
    const r = await suggestBoxesAction(mode, (placed.lists.get(TRAY) ?? []).map((t) => t.id));
    setThinking(false);
    if (!r.ok) return toast(r.error, "error");
    if (!r.items.length) return toast(mode === "value" ? "Nothing the AI could judge from the task text. Drag them yourself." : "Nothing it could judge. Drag them yourself.");
    setSugg(r.items.map((x) => ({ ...x, take: true })));
  };
  const acceptAi = () => {
    const take = (sugg ?? []).filter((x) => x.take);
    if (!take.length) return setSugg(null);
    start(async () => {
      const r = await applySuggestionsAction(mode, take.map(({ id, box, why }) => ({ id, box, why })));
      if (!r.ok) return toast(r.error, "error");
      setSugg(null);
      toast(`Placed ${r.placed}. Each card shows why; drag any you disagree with.`);
      router.refresh();
    });
  };

  const tray = placed.lists.get(TRAY) ?? [];
  const first = BOXES[mode][0];
  const firstList = (placed.lists.get(first.key) ?? []).filter((t) => !t.on_today);
  const top3 = firstList.slice(0, 3);
  const dragging = dragId ? items.find((t) => t.id === dragId) ?? null : null;
  const total = visible.length;
  const crowded = mode === "eisen" && (placed.lists.get("do")?.length ?? 0) > 7;
  const sinkKey: Box = mode === "value" ? "sink" : "drop";
  const sinkMin = (placed.lists.get(sinkKey) ?? []).reduce((s, t) => s + (t.estimate_min ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-p-lilac-fg">Priorities</p>
          <h1 className="font-display text-2xl leading-tight sm:text-3xl">What to do first, and what to drop</h1>
          <p className="mt-1 flex items-center gap-1 text-sm text-subtle">
            All {total} open tasks. Drag them into the boxes.
            <InfoTip label={`About ${BOARD_NAME[mode]}`}>{BOARD_HELP[mode]}</InfoTip>
          </p>
        </div>
        <div className="flex rounded-xl border border-border bg-surface p-1" role="tablist" aria-label="Board">
          {(["value", "eisen"] as Mode[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", mode === m ? "bg-accent text-white" : "text-subtle hover:bg-muted")}>
              {BOARD_NAME[m]}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a task" aria-label="Find a task" className="pl-9" />
        </div>
        <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Work or personal" className="w-44">
          <option value="all">Work + personal</option>
          <option value="work">Work only</option>
          <option value="personal">Personal only</option>
        </Select>
        {projects.length ? (
          <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="w-44">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        ) : null}
      </div>

      {top3.length ? (
        <section aria-label="Start here" className={cn("flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2.5", HUE[first.hue].tint, HUE[first.hue].edge)}>
          <p className={cn("text-sm font-semibold", HUE[first.hue].ink)}>Start here:</p>
          <p className="min-w-0 flex-1 text-sm">{top3.map((t) => t.title).join(" · ")}</p>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => addToday(top3.map((t) => t.id), top3.length === 1 ? "1 task" : `Top ${top3.length}`)}>
            <Sun className="h-3.5 w-3.5" /> Put {top3.length === 1 ? "it" : `top ${top3.length}`} on Today
          </Button>
        </section>
      ) : null}
      {crowded ? <p className="rounded-xl bg-p-butter px-3 py-2 text-xs text-p-butter-fg">Do now holds {placed.lists.get("do")!.length} tasks. Real urgency is rarely that common: move what can wait to Schedule.</p> : null}
      {sinkMin >= 120 ? <p className="rounded-xl bg-p-rose px-3 py-2 text-xs text-p-rose-fg">{BOXES[mode].find((b) => b.key === sinkKey)!.name} hold about {fmtDuration(sinkMin)} of estimated work. Dropping them buys that time back.</p> : null}

      <DndContext sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Zone id={TRAY} className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start">
            <div className="flex items-center gap-2 px-3 pt-3">
              <Inbox className="h-4 w-4 text-subtle" aria-hidden />
              <h2 className="text-sm font-semibold">To sort</h2>
              <span className="tabular text-xs text-subtle">{tray.length}</span>
              {tray.length && aiReady ? (
                <Button size="sm" variant="outline" className="ml-auto h-7 whitespace-nowrap" disabled={thinking || busy} onClick={askAi}>
                  {thinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Sort with AI
                </Button>
              ) : null}
            </div>
            <p className="px-3 pb-2 text-[11px] text-subtle">{tray.length ? "Drag each into a box, or use Move on the card." : "All sorted. New tasks land here."}</p>
            <ul className="max-h-[45vh] space-y-1.5 overflow-y-auto px-2 pb-2 lg:max-h-[calc(100vh-9rem)]">
              {tray.map((t) => <Card key={t.id} t={t} mode={mode} today={today} where={TRAY} auto={false} onMove={move} onToday={addToday} busy={busy} />)}
            </ul>
          </Zone>

          <div className="min-w-0">
            <div className="mb-1 hidden grid-cols-2 gap-3 pl-7 text-center text-[11px] font-semibold uppercase tracking-wider text-subtle sm:grid">
              <span>{LABELS[mode].cols[0]}</span><span>{LABELS[mode].cols[1]}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)]">
              {[0, 1].map((row) => (
                <RowCells key={row} row={row} mode={mode}>
                  {BOXES[mode].slice(row * 2, row * 2 + 2).map((b) => (
                    <BoxZone key={b.key} def={b} list={placed.lists.get(b.key) ?? []} mode={mode} today={today} auto={placed.auto}
                      onMove={move} onToday={addToday} onDrop={dropAll} busy={busy} />
                  ))}
                </RowCells>
              ))}
            </div>
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <div className="max-w-xs rotate-1 rounded-xl border border-accent bg-surface px-3 py-2 text-sm font-medium shadow-lg">{dragging.title}</div> : null}
        </DragOverlay>
      </DndContext>

      <Sheet open={!!sugg} onOpenChange={(o) => !o && setSugg(null)} title="Where the AI would put them" description="From each task's text, project, estimate and date. Untick or change any, then place.">
        <ul className="space-y-2">
          {(sugg ?? []).map((s, i) => (
            <li key={s.id} className="rounded-xl border border-border p-2.5">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={s.take} onChange={(e) => setSugg((cur) => cur!.map((x, j) => (j === i ? { ...x, take: e.target.checked } : x)))} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-subtle">{s.why}</span>
                </span>
              </label>
              <Select value={s.box} onChange={(e) => setSugg((cur) => cur!.map((x, j) => (j === i ? { ...x, box: e.target.value as Box } : x)))} aria-label={`Box for ${s.title}`} className="mt-2">
                {BOXES[mode].map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
              </Select>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={busy} onClick={acceptAi}><Check className="h-4 w-4" /> Place {(sugg ?? []).filter((x) => x.take).length}</Button>
          <Button variant="ghost" onClick={() => setSugg(null)}>Cancel</Button>
        </div>
      </Sheet>
    </div>
  );
}

function RowCells({ row, mode, children }: { row: number; mode: Mode; children: React.ReactNode }) {
  return (
    <>
      <div className="hidden items-center justify-center sm:flex">
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-subtle [writing-mode:vertical-rl] rotate-180">{LABELS[mode].rows[row]}</span>
      </div>
      {children}
    </>
  );
}

function Zone({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} aria-label={id === TRAY ? "To sort" : undefined}
      className={cn("flex min-w-0 flex-col rounded-2xl border border-border bg-surface", isOver && "ring-2 ring-accent", className)}>
      {children}
    </section>
  );
}

function BoxZone({ def, list, mode, today, auto, onMove, onToday, onDrop, busy }: {
  def: BoxDef; list: MatrixTask[]; mode: Mode; today: DateStr; auto: Set<number>;
  onMove: (id: number, to: Where, before: number | null) => void; onToday: (ids: number[], what: string) => void; onDrop: (ids: number[], name: string) => void; busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: def.key });
  const h = HUE[def.hue];
  const mins = list.reduce((s, t) => s + (t.estimate_min ?? 0), 0);
  const notToday = list.filter((t) => !t.on_today);
  const isFirst = def.key === "quick" || def.key === "do";
  const isLast = def.key === "sink" || def.key === "drop";
  return (
    <section ref={setNodeRef} aria-label={def.name} data-box={def.key}
      className={cn("flex min-h-48 min-w-0 flex-col rounded-2xl border", h.tint, h.edge, isOver && "ring-2 ring-accent")}>
      <header className="flex flex-wrap items-start gap-x-2 gap-y-1 px-3 pt-3">
        <div className="min-w-0 flex-1">
          <h2 className={cn("text-[15px] font-semibold", h.ink)}>{def.name} <span className="tabular text-xs font-normal text-subtle">{list.length}{mins ? ` · ${fmtDuration(mins)}` : ""}</span></h2>
          <p className="text-xs text-subtle">{def.action}</p>
        </div>
        {isFirst && notToday.length ? (
          <Button size="sm" variant="outline" className="h-7 whitespace-nowrap bg-surface" disabled={busy} onClick={() => onToday(notToday.slice(0, 5).map((t) => t.id), `${Math.min(5, notToday.length)} from ${def.name}`)}>
            <Sun className="h-3.5 w-3.5" /> Top {Math.min(5, notToday.length)} to Today
          </Button>
        ) : null}
        {isLast && list.length ? (
          <Button size="sm" variant="ghost" className="h-7 whitespace-nowrap text-bad" disabled={busy} onClick={() => onDrop(list.map((t) => t.id), def.name)}>
            <Trash2 className="h-3.5 w-3.5" /> Drop all
          </Button>
        ) : null}
      </header>
      <ul className="mt-2 max-h-[28rem] flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
        {list.length ? list.map((t) => <Card key={t.id} t={t} mode={mode} today={today} where={def.key} auto={auto.has(t.id)} onMove={onMove} onToday={onToday} busy={busy} />)
          : <li className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-subtle">Drop tasks here</li>}
      </ul>
    </section>
  );
}

function Card({ t, mode, today, where, auto, onMove, onToday, busy }: {
  t: MatrixTask; mode: Mode; today: DateStr; where: Where; auto: boolean;
  onMove: (id: number, to: Where, before: number | null) => void; onToday: (ids: number[], what: string) => void; busy: boolean;
}) {
  const drag = useDraggable({ id: `t:${t.id}` });
  const drop = useDroppable({ id: `c:${t.id}` });
  const due = dueText(t.due_date, today);
  return (
    <li ref={(n) => { drag.setNodeRef(n); drop.setNodeRef(n); }} data-task={t.id}
      className={cn("group rounded-xl border border-border bg-surface px-2 py-2 shadow-[var(--shadow-sm)]", drag.isDragging && "opacity-40", drop.isOver && !drag.isDragging && "border-t-2 border-t-accent")}>
      <div className="flex items-start gap-1.5">
        <button type="button" aria-label={`Drag ${t.title}`} className="mt-0.5 cursor-grab touch-none text-subtle/60 hover:text-fg active:cursor-grabbing" {...drag.listeners} {...drag.attributes}>
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/task/${t.id}`} className="block break-words text-sm font-medium leading-snug hover:underline">{t.title}</Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
            {t.project ? <Chip color={t.color} className="text-[11px]">{t.project}</Chip> : null}
            {t.estimate_min ? <span className="tabular">~{fmtDuration(t.estimate_min)}</span> : null}
            {due ? <span className={cn(due.late && "font-semibold text-bad")}>{due.text}</span> : null}
            {auto ? <span className="inline-flex items-center gap-0.5 text-p-sky-fg" title="Urgency read from the due date. Drag to set it yourself."><CalendarClock className="h-3 w-3" />from date</span> : null}
            {t.on_today ? <span className="rounded bg-p-mint px-1 text-p-mint-fg">on Today</span> : null}
            {t.waiting ? <span className="rounded bg-p-peach px-1 text-p-peach-fg">waiting</span> : null}
            {t.carry_count >= 3 ? <span className="text-p-butter-fg">carried {t.carry_count}×</span> : null}
          </p>
          {t.matrix_why ? <p className="mt-0.5 text-[11px] italic text-subtle">{t.matrix_why}</p> : null}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 pl-5">
        <Select value={where} onChange={(e) => onMove(t.id, e.target.value as Where, null)} aria-label={`Move ${t.title}`} className="h-7 min-w-0 flex-1 text-xs">
          <option value={TRAY}>To sort</option>
          {BOXES[mode].map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
        </Select>
        {!t.on_today ? (
          <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" disabled={busy} aria-label={`Put ${t.title} on Today`} onClick={() => onToday([t.id], t.title)}>
            <Sun className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
