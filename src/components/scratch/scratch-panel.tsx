"use client";

import {
  AlertCircle, Calculator, Camera, Check, ChevronDown, Code2, CopyPlus, FileUp, Link2, ListChecks, Loader2, Maximize2, Mic, Minimize2,
  Paperclip, PenLine, LineChart, StickyNote, Table2, Trash2, UploadCloud,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { copyScratchToTodayAction, createScratchAction, deleteScratchAction, saveScratchAction } from "@/app/scratch-actions";
import { cn } from "@/lib/cn";
import {
  emptyData, KIND_META, type CalcData, type ChecklistData, type CodeData, type FileData, type GraphData, type LinkData, type NoteData,
  type ScratchData, type ScratchItemView, type ScratchKind, type SketchData, type TableData,
} from "@/lib/scratch";
import { Button, EmptyState, ErrorNote } from "../ui";
import { useToast } from "../toast";
import { CalcTape } from "./calc-tape";
import { ChecklistEditor, CodeEditor, LinkEditor, TableEditor } from "./extra-editors";
import { FilePreview, fmtBytes, uploadToScratch, VoiceRecorder } from "./media";
import { GraphPlot } from "./graph-plot";
import { SketchBoard } from "./sketch-board";
import { useAutosave, type SaveState } from "./use-autosave";

export const KIND_ICON: Record<ScratchKind, typeof StickyNote> = {
  note: StickyNote,
  sketch: PenLine,
  calc: Calculator,
  graph: LineChart,
  checklist: ListChecks,
  table: Table2,
  link: Link2,
  code: Code2,
  voice: Mic,
  file: Paperclip,
};

const ADD: { kind: ScratchKind; label: string; hint: string }[] = [
  { kind: "note", label: "Note", hint: "Rough text" },
  { kind: "checklist", label: "Checklist", hint: "Tick things off" },
  { kind: "sketch", label: "Sketch", hint: "Draw, boxes, arrows" },
  { kind: "calc", label: "Calculator", hint: "Sums with a tape" },
  { kind: "table", label: "Table", hint: "Cells and formulas" },
  { kind: "graph", label: "Graph", hint: "Plot y = f(x)" },
  { kind: "link", label: "Link", hint: "Save a URL" },
  { kind: "code", label: "Code", hint: "Snippets, commands" },
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
  progress,
}: {
  item: ScratchItemView;
  isToday: boolean;
  fresh: boolean;
  onDeleted: (id: number) => void;
  /** 0..1 while the file is uploading */
  progress?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { queue, flush, state, error } = useAutosave(item.id);
  const [data, setData] = useState<ScratchData>(item.data);
  // a finished upload replaces the placeholder data
  useEffect(() => setData(item.data), [item.data]);
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
          {item.kind === "checklist" ? <ChecklistEditor data={data as ChecklistData} onChange={change} autoFocus={fresh} /> : null}
          {item.kind === "table" ? <TableEditor data={data as TableData} onChange={change} /> : null}
          {item.kind === "link" ? <LinkEditor data={data as LinkData} onChange={change} autoFocus={fresh} /> : null}
          {item.kind === "code" ? <CodeEditor data={data as CodeData} onChange={change} autoFocus={fresh} /> : null}
          {item.kind === "file" || item.kind === "voice" ? (
            progress !== undefined && progress < 1 ? (
              <div className="space-y-1.5 rounded-xl border border-border p-3">
                <p className="truncate text-sm">{(data as FileData).name} <span className="text-subtle">· {fmtBytes((data as FileData).size)}</span></p>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p className="text-xs text-subtle">Uploading… {Math.round(progress * 100)}%</p>
              </div>
            ) : (
              <FilePreview data={data as FileData} url={item.mediaUrl ?? null} kind={item.kind} />
            )
          ) : null}
          {item.kind === "voice" && (data as FileData).status === "ready" ? (
            <textarea
              value={(data as FileData).transcript ?? ""}
              onChange={(e) => change({ ...(data as FileData), transcript: e.target.value })}
              placeholder="Transcript (fills in automatically when voice is set up, or type one)"
              className="mt-2 min-h-[64px] w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent/60"
            />
          ) : null}
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
  storageEnabled,
  voiceEnabled,
}: {
  date: string;
  isToday: boolean;
  items: ScratchItemView[];
  /** from /scratch?new=sketch (command palette): add one item of this kind on arrival */
  autoAdd: ScratchKind | null;
  /** Supabase Storage is set up: photos, files and voice memos can be saved */
  storageEnabled: boolean;
  /** Deepgram is set up: voice memos get a transcript */
  voiceEnabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<Record<number, number>>({});
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const stamp = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  };

  /** Uploads files one after another; each shows up at once with a progress bar. */
  const uploadFiles = async (files: File[], kind: "file" | "voice" = "file", extra?: { duration?: number }) => {
    if (!storageEnabled) {
      toast("File storage is not set up yet: add SUPABASE_SERVICE_ROLE_KEY in Vercel.", "error");
      return [];
    }
    const done: { id: number; data: FileData }[] = [];
    for (const file of files) {
      let started: number | null = null;
      try {
        const r = await uploadToScratch(date, kind, file, {
          extra,
          onStart: (id, data) => {
            started = id;
            setItems((cur) => [{ id, kind, title: kind === "voice" ? "" : file.name.replace(/\.[^.]+$/, ""), data, timeLabel: stamp(), updatedLabel: stamp(), mediaUrl: null }, ...cur]);
            setProgress((p) => ({ ...p, [id]: 0 }));
          },
          onProgress: (id, f) => setProgress((p) => ({ ...p, [id]: Math.min(0.99, f) })),
        });
        setItems((cur) => cur.map((x) => (x.id === r.id ? { ...x, data: r.data, mediaUrl: r.url } : x)));
        setProgress((p) => ({ ...p, [r.id]: 1 }));
        done.push({ id: r.id, data: r.data });
      } catch (e) {
        toast(`${file.name}: ${(e as Error).message}`, "error");
        if (started !== null) {
          const id = started;
          setItems((cur) => cur.filter((x) => x.id !== id));
          void deleteScratchAction(id);
        }
      }
    }
    return done;
  };

  const saveVoiceMemo = async (file: File, seconds: number) => {
    setRecording(false);
    const [memo] = await uploadFiles([file], "voice", { duration: seconds });
    if (!memo || !voiceEnabled) return;
    try {
      const res = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": file.type || "audio/webm" }, body: file });
      const json = (await res.json()) as { ok: boolean; text?: string };
      if (!json.ok || !json.text) return;
      const data: FileData = { ...memo.data, transcript: json.text };
      setItems((cur) => cur.map((x) => (x.id === memo.id ? { ...x, data } : x)));
      await saveScratchAction(memo.id, { data });
    } catch {
      /* the memo itself is saved; a transcript is a bonus */
    }
  };

  // paste a screenshot or a file anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length || target?.closest("textarea, input:not([type=file])")) return;
      e.preventDefault();
      void uploadFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const add = (kind: ScratchKind) =>
    start(async () => {
      const r = await createScratchAction(date, kind);
      if (!r.ok) return toast(r.error);
      const now = new Date();
      const label = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      setItems((cur) => [{ id: r.id, kind, title: "", data: emptyData(kind), timeLabel: label, updatedLabel: label, mediaUrl: null }, ...cur]);
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

  const mediaBtn = "flex items-center gap-2 rounded-2xl border border-dashed border-border bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:border-accent/50 hover:bg-muted disabled:opacity-50";

  return (
    <div
      className={cn("relative space-y-4", dragging && "rounded-2xl ring-2 ring-accent ring-offset-4 ring-offset-bg")}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void uploadFiles([...e.dataTransfer.files]);
      }}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-accent-muted/80">
          <p className="flex items-center gap-2 text-sm font-semibold text-accent"><UploadCloud className="h-5 w-5" /> Drop to add to the scratchpad</p>
        </div>
      ) : null}
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void uploadFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <input ref={cameraInput} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { void uploadFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <div className="grid grid-cols-3 gap-2">
        <button className={mediaBtn} onClick={() => cameraInput.current?.click()} disabled={!storageEnabled} title="Take a photo or video (phone), or pick one">
          <Camera className="h-4 w-4 shrink-0 text-accent" /> Photo / video
        </button>
        <button className={mediaBtn} onClick={() => fileInput.current?.click()} disabled={!storageEnabled} title="Any file: PDF, Word, Excel, images, text…">
          <FileUp className="h-4 w-4 shrink-0 text-accent" /> Files
        </button>
        <button className={mediaBtn} onClick={() => setRecording(true)} disabled={!storageEnabled || recording}>
          <Mic className="h-4 w-4 shrink-0 text-accent" /> Voice memo
        </button>
      </div>
      <p className="-mt-2 text-xs text-subtle">
        {storageEnabled
          ? "Or drag files here, or paste a screenshot. Up to 50 MB each."
          : "Photos, files and voice memos need file storage: add SUPABASE_SERVICE_ROLE_KEY in Vercel."}
      </p>
      {recording ? <VoiceRecorder onDone={saveVoiceMemo} onCancel={() => setRecording(false)} /> : null}
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
          Rough work lives here, filed by day: a note or a checklist, a sketch, numbers in a table, a curve, photos, PDFs and documents, or a voice memo. Everything saves as you go.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              isToday={isToday}
              fresh={fresh === it.id}
              progress={progress[it.id]}
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
