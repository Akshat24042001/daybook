"use client";

import {
  ArrowUpRight, Circle, Download, Eraser, Grid3x3, Highlighter, Minus, MoveVertical, Pencil, Redo2, Square, Trash2, Type, Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { BOARD_H_MAX, BOARD_W, INKS, type Ink, type SketchData, type Stroke, type StrokeTool } from "@/lib/scratch";
import { useCanvasTheme, useElementSize, type CanvasTheme } from "./canvas-theme";

type Tool = StrokeTool | "eraser";

const TOOLS: { tool: Tool; label: string; Icon: typeof Pencil }[] = [
  { tool: "pen", label: "Pen", Icon: Pencil },
  { tool: "hl", label: "Highlighter", Icon: Highlighter },
  { tool: "line", label: "Line", Icon: Minus },
  { tool: "arrow", label: "Arrow", Icon: ArrowUpRight },
  { tool: "rect", label: "Box", Icon: Square },
  { tool: "ellipse", label: "Circle", Icon: Circle },
  { tool: "text", label: "Text", Icon: Type },
  { tool: "eraser", label: "Eraser (removes whole strokes)", Icon: Eraser },
];

const SIZES = [
  { label: "Fine", pen: 3, text: 20 },
  { label: "Medium", pen: 6, text: 28 },
  { label: "Bold", pen: 12, text: 42 },
];

// --------------------------------------------------------------- drawing

function strokeColor(s: Stroke, th: CanvasTheme): string {
  if (s.t === "hl" && s.c === "ink") return th.dark ? "#facc15" : "#fde047";
  return th.ink[s.c];
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, th: CanvasTheme) {
  const color = strokeColor(s, th);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = s.t === "hl" ? s.w * 3 : s.w;
  if (s.t === "hl") {
    ctx.globalAlpha = th.dark ? 0.35 : 0.45;
    ctx.globalCompositeOperation = th.dark ? "lighter" : "multiply";
  }
  const p = s.p;
  switch (s.t) {
    case "pen":
    case "hl": {
      ctx.beginPath();
      if (p.length === 2) {
        ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      ctx.moveTo(p[0], p[1]);
      // smooth: curve through the midpoints of successive points
      for (let i = 2; i < p.length - 2; i += 2) {
        const mx = (p[i] + p[i + 2]) / 2;
        const my = (p[i + 1] + p[i + 3]) / 2;
        ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
      }
      ctx.lineTo(p[p.length - 2], p[p.length - 1]);
      ctx.stroke();
      break;
    }
    case "line":
    case "arrow": {
      const [x1, y1, x2, y2] = p;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (s.t === "arrow") {
        const a = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.max(12, s.w * 4);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(a - 0.45), y2 - len * Math.sin(a - 0.45));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(a + 0.45), y2 - len * Math.sin(a + 0.45));
        ctx.stroke();
      }
      break;
    }
    case "rect": {
      const [x1, y1, x2, y2] = p;
      ctx.beginPath();
      ctx.roundRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), 4);
      ctx.stroke();
      break;
    }
    case "ellipse": {
      const [x1, y1, x2, y2] = p;
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "text": {
      ctx.font = `500 ${s.w}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      (s.x ?? "").split("\n").forEach((line, i) => ctx.fillText(line, p[0], p[1] + i * s.w * 1.25));
      break;
    }
  }
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, bg: SketchData["bg"], h: number, th: CanvasTheme) {
  ctx.fillStyle = th.surface;
  ctx.fillRect(0, 0, BOARD_W, h);
  if (bg === "plain") return;
  const step = 40;
  ctx.save();
  if (bg === "grid") {
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let x = step; x < BOARD_W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(BOARD_W, y); }
    ctx.stroke();
  } else {
    ctx.fillStyle = th.subtle;
    ctx.globalAlpha = 0.45;
    for (let x = step; x < BOARD_W; x += step) for (let y = step; y < h; y += step) ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  ctx.restore();
}

// --------------------------------------------------------------- hit testing (eraser)

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hits(s: Stroke, x: number, y: number, r: number): boolean {
  const p = s.p;
  const reach = r + (s.t === "hl" ? s.w * 1.5 : s.w / 2);
  switch (s.t) {
    case "pen":
    case "hl":
      if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
      for (let i = 0; i < p.length - 2; i += 2) if (distToSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
      return false;
    case "line":
    case "arrow":
      return distToSeg(x, y, p[0], p[1], p[2], p[3]) <= reach;
    case "rect": {
      const [x1, y1, x2, y2] = p;
      return [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]].some(([a, b, c, d]) => distToSeg(x, y, a, b, c, d) <= reach);
    }
    case "ellipse": {
      const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2, rx = Math.abs(p[2] - p[0]) / 2, ry = Math.abs(p[3] - p[1]) / 2;
      let prev: [number, number] | null = null;
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const pt: [number, number] = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
        if (prev && distToSeg(x, y, prev[0], prev[1], pt[0], pt[1]) <= reach) return true;
        prev = pt;
      }
      return false;
    }
    case "text": {
      const lines = (s.x ?? "").split("\n");
      const w = Math.max(...lines.map((l) => l.length)) * s.w * 0.6;
      const h = lines.length * s.w * 1.25;
      return x >= p[0] - r && x <= p[0] + w + r && y >= p[1] - r && y <= p[1] + h + r;
    }
  }
}

// --------------------------------------------------------------- board

export function SketchBoard({
  data,
  onChange,
  fullscreen,
}: {
  data: SketchData;
  onChange: (d: SketchData) => void;
  fullscreen: boolean;
}) {
  const theme = useCanvasTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const cssW = useElementSize(wrapRef).w;

  const [strokes, setStrokes] = useState<Stroke[]>(data.strokes);
  const [h, setH] = useState(data.h);
  const [bg, setBg] = useState<SketchData["bg"]>(data.bg);
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [ink, setInk] = useState<Ink>("ink");
  const [size, setSize] = useState(0);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textVal, setTextVal] = useState("");

  const scale = cssW ? cssW / BOARD_W : 1;
  const drawing = useRef<{ stroke: Stroke; erased: boolean; before: Stroke[] } | null>(null);

  // commit a new set of strokes as one undo step and save
  const commit = useCallback(
    (next: Stroke[], before: Stroke[], nextH = h, nextBg = bg) => {
      setPast((p) => [...p.slice(-99), before]);
      setFuture([]);
      setStrokes(next);
      onChange({ h: nextH, bg: nextBg, strokes: next });
    },
    [h, bg, onChange],
  );

  // redraw committed strokes
  useEffect(() => {
    const c = baseRef.current;
    if (!c || !theme || !cssW) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(h * scale * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    drawBackground(ctx, bg, h, theme);
    for (const s of strokes) drawStroke(ctx, s, theme);
    const live = liveRef.current!;
    live.width = c.width;
    live.height = c.height;
  }, [strokes, theme, cssW, h, bg, scale]);

  const toBoard = (e: React.PointerEvent) => {
    const r = liveRef.current!.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) / scale), y: Math.round((e.clientY - r.top) / scale) };
  };

  const drawLive = () => {
    const c = liveRef.current;
    if (!c || !theme) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    if (drawing.current && !drawing.current.erased) drawStroke(ctx, drawing.current.stroke, theme);
  };

  // blur and a click on the board can both try to place the same text: only the first one does
  const textOpen = useRef(false);
  useEffect(() => { textOpen.current = !!textAt; }, [textAt]);
  const commitText = () => {
    if (!textOpen.current) return;
    textOpen.current = false;
    if (textAt && textVal.trim()) {
      commit([...strokes, { t: "text", c: ink, w: SIZES[size].text, p: [textAt.x, textAt.y], x: textVal.trimEnd() }], strokes);
    }
    setTextAt(null);
    setTextVal("");
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const { x, y } = toBoard(e);
    if (tool === "text") {
      if (textAt) commitText();
      else { textOpen.current = true; setTextAt({ x, y }); setTextVal(""); }
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === "eraser") {
      drawing.current = { stroke: { t: "pen", c: "ink", w: 1, p: [] }, erased: true, before: strokes };
      const r = 10 / scale;
      const left = strokes.filter((s) => !hits(s, x, y, r));
      if (left.length !== strokes.length) setStrokes(left);
      return;
    }
    const w = SIZES[size].pen;
    const p = tool === "pen" || tool === "hl" ? [x, y] : [x, y, x, y];
    drawing.current = { stroke: { t: tool, c: ink, w, p }, erased: false, before: strokes };
    drawLive();
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d) return;
    const { x, y } = toBoard(e);
    if (d.erased) {
      const r = 10 / scale;
      setStrokes((cur) => {
        const left = cur.filter((s) => !hits(s, x, y, r));
        return left.length === cur.length ? cur : left;
      });
      return;
    }
    const p = d.stroke.p;
    if (d.stroke.t === "pen" || d.stroke.t === "hl") {
      const events = "getCoalescedEvents" in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [];
      const pts = events.length ? events.map((ev) => {
        const r = liveRef.current!.getBoundingClientRect();
        return { x: Math.round((ev.clientX - r.left) / scale), y: Math.round((ev.clientY - r.top) / scale) };
      }) : [{ x, y }];
      for (const pt of pts) {
        const lx = p[p.length - 2], ly = p[p.length - 1];
        if (Math.hypot(pt.x - lx, pt.y - ly) >= 1.5) p.push(pt.x, pt.y);
      }
    } else {
      p[2] = x;
      p[3] = y;
    }
    drawLive();
  };

  const onUp = () => {
    const d = drawing.current;
    drawing.current = null;
    if (!d) return;
    if (d.erased) {
      if (strokes.length !== d.before.length) commit(strokes, d.before);
      return;
    }
    const s = d.stroke;
    const tiny = s.p.length === 4 && Math.hypot(s.p[2] - s.p[0], s.p[3] - s.p[1]) < 3 && s.t !== "pen" && s.t !== "hl";
    // the live layer clears after the base redraws with the new stroke (effect below), so nothing flickers
    if (!tiny) commit([...strokes, s], strokes);
    else drawLive();
    // grow the board when drawing near the bottom
    const maxY = Math.max(...s.p.filter((_, i) => i % 2 === 1));
    if (maxY > h - 60 && h < BOARD_H_MAX) {
      const nh = Math.min(BOARD_H_MAX, h + 300);
      setH(nh);
      onChange({ h: nh, bg, strokes: tiny ? strokes : [...strokes, s] });
    }
  };

  // clear the live layer once the base has redrawn with the new stroke
  useEffect(() => {
    if (!drawing.current) drawLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  const undo = () => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((f) => [strokes, ...f]);
    setStrokes(prev);
    onChange({ h, bg, strokes: prev });
  };
  const redo = () => {
    if (!future.length) return;
    const [next, ...rest] = future;
    setFuture(rest);
    setPast((p) => [...p, strokes]);
    setStrokes(next);
    onChange({ h, bg, strokes: next });
  };

  // Ctrl/⌘ Z and Shift+Ctrl/⌘ Z while the pointer is over this board
  const hover = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hover.current || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportPng = () => {
    const c = baseRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "sketch.png";
    a.click();
  };

  const btn = "flex h-8 w-8 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-fg disabled:opacity-30";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex items-center rounded-xl border border-border p-0.5">
          {TOOLS.map(({ tool: t, label, Icon }) => (
            <button
              key={t}
              title={label}
              aria-label={label}
              aria-pressed={tool === t}
              onClick={() => { if (textAt) commitText(); setTool(t); }}
              className={cn(btn, "h-7 w-7", tool === t && "bg-accent-muted text-accent hover:bg-accent-muted hover:text-accent")}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border px-1.5 py-1">
          {INKS.map((c) => (
            <button
              key={c}
              title={c === "ink" ? "Ink (follows the theme)" : c}
              aria-label={`Colour ${c}`}
              aria-pressed={ink === c}
              onClick={() => setInk(c)}
              className={cn("h-5 w-5 rounded-full border-2 transition-transform", ink === c ? "scale-110 border-accent" : "border-transparent")}
              style={{ background: theme ? theme.ink[c] : undefined }}
            />
          ))}
        </div>
        <div className="flex items-center rounded-xl border border-border p-0.5">
          {SIZES.map((s, i) => (
            <button
              key={s.label}
              title={s.label}
              aria-label={`${s.label} size`}
              aria-pressed={size === i}
              onClick={() => setSize(i)}
              className={cn(btn, "h-7 w-7", size === i && "bg-muted text-fg")}
            >
              <span className="rounded-full bg-current" style={{ width: 3 + i * 3, height: 3 + i * 3 }} />
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center">
          <button className={btn} title="Undo (Ctrl Z)" aria-label="Undo" onClick={undo} disabled={!past.length}><Undo2 className="h-4 w-4" /></button>
          <button className={btn} title="Redo (Ctrl Shift Z)" aria-label="Redo" onClick={redo} disabled={!future.length}><Redo2 className="h-4 w-4" /></button>
          <button
            className={btn}
            title={`Background: ${bg}. Click to change.`}
            aria-label="Change background"
            onClick={() => {
              const nb = bg === "grid" ? "dots" : bg === "dots" ? "plain" : "grid";
              setBg(nb);
              onChange({ h, bg: nb, strokes });
            }}
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
          <button
            className={btn}
            title="Make the board taller"
            aria-label="Make the board taller"
            disabled={h >= BOARD_H_MAX}
            onClick={() => { const nh = Math.min(BOARD_H_MAX, h + 300); setH(nh); onChange({ h: nh, bg, strokes }); }}
          >
            <MoveVertical className="h-4 w-4" />
          </button>
          <button className={btn} title="Download as PNG" aria-label="Download as PNG" onClick={exportPng}><Download className="h-4 w-4" /></button>
          <button
            className={cn(btn, "hover:text-bad")}
            title="Clear the board (undo brings it back)"
            aria-label="Clear the board"
            disabled={!strokes.length}
            onClick={() => commit([], strokes)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className={cn("relative overflow-hidden rounded-xl border border-border", fullscreen && "max-h-none")}
        onPointerEnter={() => (hover.current = true)}
        onPointerLeave={() => (hover.current = false)}
      >
        {/* the board's height comes from CSS (aspect ratio), never from measured state */}
        <canvas ref={baseRef} className="block w-full" style={{ aspectRatio: `${BOARD_W} / ${h}` }} />
        <canvas
          ref={liveRef}
          className={cn("absolute inset-0 block h-full w-full", tool === "text" ? "cursor-text" : tool === "eraser" ? "cursor-cell" : "cursor-crosshair")}
          style={{ touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {textAt ? (
          <textarea
            autoFocus
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
              if (e.key === "Escape") { setTextAt(null); setTextVal(""); }
            }}
            onBlur={commitText}
            placeholder="Type, Enter to place"
            rows={1}
            className="absolute min-w-[8rem] resize-none rounded-md border border-accent/60 bg-surface/90 px-1 py-0 font-medium outline-none"
            style={{
              left: textAt.x * scale,
              top: textAt.y * scale,
              fontSize: Math.max(12, SIZES[size].text * scale),
              color: theme ? theme.ink[ink] : undefined,
              lineHeight: 1.25,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
