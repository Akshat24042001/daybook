"use client";

import {
  AlertCircle, Calculator, Check, ChevronDown, CopyPlus, Loader2, Maximize2, Minimize2, PenLine, LineChart, StickyNote, Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { copyScratchToTodayAction, createScratchAction, deleteScratchAction } from "@/app/scratch-actions";
import { cn } from "@/lib/cn";
import {
  emptyData, KIND_META, type CalcData, type GraphData, type NoteData, type ScratchData, type ScratchItemView, type ScratchKind,
  type SketchData,
} from "@/lib/scratch";
import { Button, EmptyState, ErrorNote } from "../ui";
import { useToast } from "../toast";
import { CalcTape } from "./calc-tape";
import { GraphPlot } from "./graph-plot";
import { SketchBoard } from "./sketch-board";
import { useAutosave, type SaveState } from "./use-autosave";

export const KIND_ICON: Record<ScratchKind, typeof StickyNote> = {
  note: StickyNote,
  sketch: PenLine,
  calc: Calculator,
  graph: LineChart,
};

const ADD: { kind: ScratchKind; label: string; hint: string }[] = [
  { kind: "note", label: "Note", hint: "Rough text" },
  { kind: "sketch", label: "Sketch", hint: "Draw, boxes, arrows" },
  { kind: "calc", label: "Calculator", hint: "Sums with a tape" },
  { kind: "graph", label: "Graph", hint: "Plot y = f(x)" },
];

function SaveBadge({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "saving") return <Loader2 className="h-3.5 w-3.5 animate-spin text-subtle" aria-label="Saving" />;
  if (state === "saved") return <Check className="h-3.5 w-3.5 text-good" aria-label="Saved" />;
  if (state === "error") return <span title={error ?? "Not saved"}><AlertCircle className="h-3.5 w-3.5 text-bad" aria-label="Not saved" /></span>;
  return null;
}

function NoteEditor({ data, onChange, autoFocus }: { data: NoteData; onChange: (d: NoteData) => void; autoFocus: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(120, el.scrollHeight + 2)}px`;
  }, [data.text]);
  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={data.text}
      onChange={(e) => onChange({ text: e.target.value })}
      placeholder="Anything: a number to call back, half an idea, a list…"
      className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
    />
  );
}

function ItemCard({
  item,
  isToday,
  fresh,
  onDeleted,
}: {
  item: ScratchItemView;
  isToday: boolean;
  fresh: boolean;
  onDeleted: (id: number) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { queue, flush, state, error } = useAutosave(item.id);
  const [data, setData] = useState<ScratchData>(item.data);
  const [title, setTitle] = useState(item.title);
  const [open, setOpen] = useState(true);
  const [full, setFull] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const Icon = KIND_ICON[item.kind];
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fresh) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [fresh]);

  // Esc leaves full screen; the page behind does not scroll while it is up
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [full]);

  const change = (d: ScratchData) => {
    setData(d);
    queue({ data: d });
  };

  const remove = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    start(async () => {
      const r = await deleteScratchAction(item.id);
      if (!r.ok) return toast(r.error);
      onDeleted(item.id);
      toast(`${KIND_META[item.kind].label} deleted.`);
    });
  };

  const copyToToday = () =>
    start(async () => {
      await flush();
      const r = await copyScratchToTodayAction(item.id);
      if (!r.ok) return toast(r.error);
      toast("Copied to today.");
      router.push("/scratch");
    });

  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-fg";

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]",
        full ? "fixed inset-0 z-50 overflow-y-auto rounded-none p-3 sm:p-5" : "p-3",
      )}
    >
      <div className={cn("flex items-center gap-2", open && "mb-2.5")}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }}
          placeholder={`Untitled ${KIND_META[item.kind].noun}`}
          maxLength={120}
          aria-label="Title"
          className="h-8 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-sm font-medium outline-none placeholder:font-normal placeholder:text-subtle/70 focus:bg-muted/60"
        />
        <span className="hidden shrink-0 text-xs tabular-nums text-subtle sm:inline" title={`Last edited ${item.updatedLabel}`}>{item.timeLabel}</span>
        <SaveBadge state={state} error={error} />
        <div className="flex shrink-0 items-center">
          {item.kind === "sketch" || item.kind === "graph" ? (
            <button className={iconBtn} onClick={() => { setOpen(true); setFull(!full); }} title={full ? "Exit full screen (Esc)" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>
              {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          ) : null}
          {!isToday ? (
            <button className={iconBtn} onClick={copyToToday} disabled={pending} title="Copy to today" aria-label="Copy to today">
              <CopyPlus className="h-4 w-4" />
            </button>
          ) : null}
          <button
            className={cn(iconBtn, confirmDelete && "w-auto bg-bad/10 px-2 text-xs font-medium text-bad hover:bg-bad/15 hover:text-bad")}
            onClick={remove}
            disabled={pending}
            title="Delete"
            aria-label={confirmDelete ? "Tap again to delete" : "Delete"}
          >
            {confirmDelete ? "Delete?" : <Trash2 className="h-4 w-4" />}
          </button>
          {!full ? (
            <button className={iconBtn} onClick={() => setOpen(!open)} title={open ? "Collapse" : "Expand"} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open}>
              <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <>
          {item.kind === "note" ? <NoteEditor data={data as NoteData} onChange={change} autoFocus={fresh} /> : null}
          {item.kind === "sketch" ? <SketchBoard data={data as SketchData} onChange={change} fullscreen={full} /> : null}
          {item.kind === "calc" ? <CalcTape data={data as CalcData} onChange={change} autoFocus={fresh} /> : null}
          {item.kind === "graph" ? <GraphPlot data={data as GraphData} onChange={change} fullscreen={full} /> : null}
          {state === "error" && error ? <div className="mt-2"><ErrorNote message={error} /></div> : null}
        </>
      ) : null}
    </div>
  );
}

export function ScratchPanel({
  date,
  isToday,
  items: initial,
  autoAdd,
}: {
  date: string;
  isToday: boolean;
  items: ScratchItemView[];
  /** from /scratch?new=sketch (command palette): add one item of this kind on arrival */
  autoAdd: ScratchKind | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const add = (kind: ScratchKind) =>
    start(async () => {
      const r = await createScratchAction(date, kind);
      if (!r.ok) return toast(r.error);
      const now = new Date();
      const label = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      setItems((cur) => [{ id: r.id, kind, title: "", data: emptyData(kind), timeLabel: label, updatedLabel: label }, ...cur]);
      setFresh(r.id);
    });

  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoAdd || autoDone.current) return;
    autoDone.current = true;
    router.replace(isToday ? "/scratch" : `/scratch?date=${date}`, { scroll: false });
    add(autoAdd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdd]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ADD.map(({ kind, label, hint }) => {
          const Icon = KIND_ICON[kind];
          return (
            <button
              key={kind}
              onClick={() => add(kind)}
              disabled={pending}
              className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface p-3 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-accent/40 hover:bg-muted disabled:opacity-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-muted text-accent">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">+ {label}</span>
                <span className="block truncate text-xs text-subtle">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={PenLine} title={isToday ? "Nothing on the scratchpad yet today" : "Nothing on the scratchpad this day"}>
          Rough work lives here, filed by day: jot a note, sketch a flow, run some numbers or plot a curve. Everything saves as you go.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              isToday={isToday}
              fresh={fresh === it.id}
              onDeleted={(id) => setItems((cur) => cur.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}
      {pending ? <p className="sr-only" aria-live="polite">Working…</p> : null}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className={cn(items.length < 3 && "hidden")}>
          Back to top
        </Button>
      </div>
    </div>
  );
}
