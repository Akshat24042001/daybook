/**
 * Scratchpad item shapes, shared by the server (validation) and the client (editors). No database code here.
 *
 * Sketches are stored as vector strokes on a fixed 1000-unit-wide board, so they redraw crisply at any size and
 * stay small (a busy page is tens of KB, not a multi-MB PNG).
 */

export const SCRATCH_KINDS = ["note", "sketch", "calc", "graph", "checklist", "table", "link", "code", "voice", "file"] as const;
export type ScratchKind = (typeof SCRATCH_KINDS)[number];

export const BOARD_W = 1000;
export const BOARD_H_MIN = 300;
export const BOARD_H_MAX = 4000;

export const INKS = ["ink", "red", "blue", "green", "orange", "purple"] as const;
export type Ink = (typeof INKS)[number];

export const STROKE_TOOLS = ["pen", "hl", "line", "arrow", "rect", "ellipse", "text"] as const;
export type StrokeTool = (typeof STROKE_TOOLS)[number];

export interface Stroke {
  t: StrokeTool;
  c: Ink;
  w: number;
  /** pen / hl: x,y,x,y…; shapes: x1,y1,x2,y2; text: x,y */
  p: number[];
  /** text only */
  x?: string;
}

export interface NoteData { text: string }
export interface SketchData { h: number; bg: "plain" | "grid" | "dots"; strokes: Stroke[] }
export interface CalcData { lines: string[] }
export interface GraphView { x0: number; x1: number; y0: number; y1: number }
export interface GraphData { fns: string[]; view: GraphView }

export interface ChecklistItem { id: string; text: string; done: boolean }
export interface ChecklistData { items: ChecklistItem[] }
/** A small sheet: rows of cells; a cell starting with "=" is a formula (=A1+B2, =SUM(A1:A5)). */
export interface TableData { rows: string[][] }
export interface LinkData { url: string; note: string }
export interface CodeData { lang: string; code: string }
/** A stored file (photo, video, audio, PDF, document…) or a recorded voice memo. */
export interface FileData {
  path: string;
  name: string;
  mime: string;
  size: number;
  status: "uploading" | "ready";
  width?: number;
  height?: number;
  /** seconds, for audio and video */
  duration?: number;
  /** voice memos: what was said */
  transcript?: string;
}

export type ScratchData = NoteData | SketchData | CalcData | GraphData | ChecklistData | TableData | LinkData | CodeData | FileData;

export interface ScratchItemView {
  id: number;
  kind: ScratchKind;
  title: string;
  data: ScratchData;
  timeLabel: string;
  updatedLabel: string;
  /** files and voice memos: a short-lived link to the stored file */
  mediaUrl?: string | null;
}

export const TABLE_MAX_ROWS = 100;
export const TABLE_MAX_COLS = 26;
export const CODE_LANGS = ["text", "js", "ts", "python", "sql", "json", "bash", "html", "css", "markdown", "go", "java", "other"] as const;

export const DEFAULT_VIEW: GraphView = { x0: -10, x1: 10, y0: -6, y1: 6 };

export function emptyData(kind: ScratchKind): ScratchData {
  switch (kind) {
    case "note": return { text: "" };
    case "sketch": return { h: 560, bg: "grid", strokes: [] };
    case "calc": return { lines: [""] };
    case "graph": return { fns: ["sin(x)", ""], view: { ...DEFAULT_VIEW } };
    case "checklist": return { items: [] };
    case "table": return { rows: Array.from({ length: 5 }, () => ["", "", "", ""]) };
    case "link": return { url: "", note: "" };
    case "code": return { lang: "text", code: "" };
    case "voice":
    case "file": return { path: "", name: "", mime: "", size: 0, status: "uploading" };
  }
}

export const KIND_META: Record<ScratchKind, { label: string; noun: string }> = {
  note: { label: "Note", noun: "note" },
  sketch: { label: "Sketch", noun: "sketch" },
  calc: { label: "Calculator", noun: "calculation" },
  graph: { label: "Graph", noun: "graph" },
  checklist: { label: "Checklist", noun: "checklist" },
  table: { label: "Table", noun: "table" },
  link: { label: "Link", noun: "link" },
  code: { label: "Code", noun: "snippet" },
  voice: { label: "Voice memo", noun: "voice memo" },
  file: { label: "File", noun: "file" },
};

/** What kind of preview a stored file gets. */
export type FileView = "image" | "video" | "audio" | "pdf" | "text" | "csv" | "markdown" | "office" | "other";
const TEXT_EXT = /\.(txt|log|json|xml|yaml|yml|ini|conf|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|cs|php|sql|sh|bat|ps1|html|css|scss|env\.example)$/i;
export function fileView(name: string, mime: string): FileView {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (m === "text/csv" || /\.(csv|tsv)$/i.test(name)) return "csv";
  if (m === "text/markdown" || /\.(md|markdown)$/i.test(name)) return "markdown";
  if (m.startsWith("text/") || m === "application/json" || TEXT_EXT.test(name)) return "text";
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i.test(name) || /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(m)) return "office";
  return "other";
}

/** Payload ceiling per item. Sketch points are rounded to whole units, so this is a lot of drawing. */
export const MAX_DATA_BYTES = 1_500_000;

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Coerces untrusted input into the item's shape: unknown fields dropped, numbers clamped, strings capped.
 * Returns null if it cannot be made valid.
 */
export function normalizeData(kind: ScratchKind, raw: unknown): ScratchData | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case "note":
      return { text: typeof o.text === "string" ? o.text.slice(0, 50_000) : "" };
    case "calc": {
      const lines = Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === "string") : [];
      return { lines: (lines.length ? lines : [""]).slice(0, 500).map((l) => l.slice(0, 500)) };
    }
    case "graph": {
      const fns = Array.isArray(o.fns) ? o.fns.filter((l): l is string => typeof l === "string") : [];
      const v = (o.view && typeof o.view === "object" ? o.view : {}) as Record<string, unknown>;
      let view: GraphView = {
        x0: finite(v.x0, DEFAULT_VIEW.x0), x1: finite(v.x1, DEFAULT_VIEW.x1),
        y0: finite(v.y0, DEFAULT_VIEW.y0), y1: finite(v.y1, DEFAULT_VIEW.y1),
      };
      if (!(view.x1 > view.x0) || !(view.y1 > view.y0) || Math.abs(view.x1 - view.x0) > 1e9) view = { ...DEFAULT_VIEW };
      return { fns: (fns.length ? fns : [""]).slice(0, 8).map((f) => f.slice(0, 200)), view };
    }
    case "checklist": {
      const items: ChecklistItem[] = [];
      for (const it of Array.isArray(o.items) ? o.items.slice(0, 500) : []) {
        if (!it || typeof it !== "object") continue;
        const r = it as Record<string, unknown>;
        items.push({
          id: typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : Math.random().toString(36).slice(2, 10),
          text: typeof r.text === "string" ? r.text.slice(0, 500) : "",
          done: r.done === true,
        });
      }
      return { items };
    }
    case "table": {
      const rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, TABLE_MAX_ROWS).map((row) =>
        (Array.isArray(row) ? row : []).slice(0, TABLE_MAX_COLS).map((c) => (typeof c === "string" ? c.slice(0, 500) : typeof c === "number" ? String(c) : "")),
      );
      const width = Math.max(1, ...rows.map((r) => r.length));
      return { rows: (rows.length ? rows : [[""]]).map((r) => [...r, ...Array(width - r.length).fill("")]) };
    }
    case "link": {
      const url = typeof o.url === "string" ? o.url.trim().slice(0, 2000) : "";
      return { url: url && !/^https?:\/\//i.test(url) ? `https://${url}` : url, note: typeof o.note === "string" ? o.note.slice(0, 5000) : "" };
    }
    case "code":
      return {
        lang: CODE_LANGS.includes(o.lang as (typeof CODE_LANGS)[number]) ? (o.lang as string) : "text",
        code: typeof o.code === "string" ? o.code.slice(0, 100_000) : "",
      };
    case "voice":
    case "file": {
      // the file itself lives in storage; only its description is kept here, and the path is never taken from input
      // once set (see services/scratch)
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
      const out: FileData = {
        path: typeof o.path === "string" ? o.path.slice(0, 300) : "",
        name: typeof o.name === "string" ? o.name.slice(0, 200) : "",
        mime: typeof o.mime === "string" ? o.mime.slice(0, 100) : "",
        size: num(o.size) ?? 0,
        status: o.status === "ready" ? "ready" : "uploading",
      };
      const w = num(o.width), h = num(o.height), d = num(o.duration);
      if (w) out.width = Math.round(w);
      if (h) out.height = Math.round(h);
      if (d) out.duration = Math.round(d * 10) / 10;
      if (typeof o.transcript === "string" && o.transcript.trim()) out.transcript = o.transcript.slice(0, 50_000);
      return out;
    }
    case "sketch": {
      const h = clamp(Math.round(finite(o.h, 560)), BOARD_H_MIN, BOARD_H_MAX);
      const bg = o.bg === "plain" || o.bg === "dots" ? o.bg : "grid";
      const strokes: Stroke[] = [];
      for (const s of Array.isArray(o.strokes) ? o.strokes.slice(0, 5000) : []) {
        if (!s || typeof s !== "object") continue;
        const r = s as Record<string, unknown>;
        const t = STROKE_TOOLS.includes(r.t as StrokeTool) ? (r.t as StrokeTool) : null;
        if (!t || !Array.isArray(r.p)) continue;
        const p = r.p.slice(0, 20_000).map((n) => Math.round(finite(n, 0)));
        const need = t === "text" ? 2 : t === "pen" || t === "hl" ? 2 : 4;
        if (p.length < need || p.length % 2) continue;
        const stroke: Stroke = {
          t,
          c: INKS.includes(r.c as Ink) ? (r.c as Ink) : "ink",
          w: clamp(Math.round(finite(r.w, 3)), 1, 60),
          p,
        };
        if (t === "text") {
          const x = typeof r.x === "string" ? r.x.slice(0, 300) : "";
          if (!x.trim()) continue;
          stroke.x = x;
        }
        strokes.push(stroke);
      }
      return { h, bg, strokes };
    }
  }
  return null;
}

/** A line of plain text that stands for the item in lists and search. */
export function itemPreview(kind: ScratchKind, data: ScratchData): string {
  switch (kind) {
    case "note": return (data as NoteData).text.trim().split("\n")[0]?.slice(0, 140) ?? "";
    case "calc": return (data as CalcData).lines.filter((l) => l.trim()).slice(0, 3).join(" · ").slice(0, 140);
    case "graph": return (data as GraphData).fns.filter((f) => f.trim()).map((f) => `y = ${f.replace(/^\s*y\s*=\s*/, "")}`).join(", ").slice(0, 140);
    case "sketch": return (data as SketchData).strokes.filter((s) => s.t === "text").map((s) => s.x).join(" ").slice(0, 140);
    case "checklist": {
      const items = (data as ChecklistData).items.filter((i) => i.text.trim());
      return items.length ? `${items.filter((i) => i.done).length}/${items.length} · ${items.map((i) => i.text).join(", ")}`.slice(0, 140) : "";
    }
    case "table": return (data as TableData).rows.flat().filter((c) => c.trim() && !c.startsWith("=")).join(" · ").slice(0, 140);
    case "link": return ((data as LinkData).note.trim().split("\n")[0] || (data as LinkData).url).slice(0, 140);
    case "code": return (data as CodeData).code.trim().split("\n")[0]?.slice(0, 140) ?? "";
    case "voice": return ((data as FileData).transcript ?? "").slice(0, 140);
    case "file": return (data as FileData).name.slice(0, 140);
  }
}
