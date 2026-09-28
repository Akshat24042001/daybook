/**
 * Scratchpad item shapes, shared by the server (validation) and the client (editors). No database code here.
 *
 * Sketches are stored as vector strokes on a fixed 1000-unit-wide board, so they redraw crisply at any size and
 * stay small (a busy page is tens of KB, not a multi-MB PNG).
 */

export const SCRATCH_KINDS = ["note", "sketch", "calc", "graph"] as const;
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

export type ScratchData = NoteData | SketchData | CalcData | GraphData;

export interface ScratchItemView {
  id: number;
  kind: ScratchKind;
  title: string;
  data: ScratchData;
  timeLabel: string;
  updatedLabel: string;
}

export const DEFAULT_VIEW: GraphView = { x0: -10, x1: 10, y0: -6, y1: 6 };

export function emptyData(kind: ScratchKind): ScratchData {
  switch (kind) {
    case "note": return { text: "" };
    case "sketch": return { h: 560, bg: "grid", strokes: [] };
    case "calc": return { lines: [""] };
    case "graph": return { fns: ["sin(x)", ""], view: { ...DEFAULT_VIEW } };
  }
}

export const KIND_META: Record<ScratchKind, { label: string; noun: string }> = {
  note: { label: "Note", noun: "note" },
  sketch: { label: "Sketch", noun: "sketch" },
  calc: { label: "Calculator", noun: "calculation" },
  graph: { label: "Graph", noun: "graph" },
};

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
  }
}
