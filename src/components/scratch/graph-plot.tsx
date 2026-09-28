"use client";

import { Maximize, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { compileFn, fmtNum } from "@/lib/calc";
import { cn } from "@/lib/cn";
import { DEFAULT_VIEW, type GraphData, type GraphView } from "@/lib/scratch";
import { useCanvasTheme, useElementSize } from "./canvas-theme";

const MAX_FNS = 8;

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

function tickLabel(v: number, step: number): string {
  if (Math.abs(v) < step / 1e6) return "0";
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4 ? v.toExponential(1) : v.toFixed(digits);
}

export function GraphPlot({ data, onChange, fullscreen }: { data: GraphData; onChange: (d: GraphData) => void; fullscreen: boolean }) {
  const theme = useCanvasTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // the plot's size comes from CSS; this only reads it for the canvas backing store
  const { w: cssW, h: cssH } = useElementSize(wrapRef);

  const [view, setView] = useState<GraphView>(data.view);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const fns = data.fns;
  const compiled = useMemo(() => fns.map((f) => (f.trim() ? compileFn(f) : null)), [fns]);

  // panning fires many views a second: save the last one once the gesture settles, with the latest functions
  const saveView = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnsRef = useRef(fns);
  fnsRef.current = fns;
  const commitView = (v: GraphView) => {
    setView(v);
    if (saveView.current) clearTimeout(saveView.current);
    saveView.current = setTimeout(() => onChange({ fns: fnsRef.current, view: v }), 400);
  };

  const px = (x: number) => ((x - view.x0) / (view.x1 - view.x0)) * cssW;
  const py = (y: number) => cssH - ((y - view.y0) / (view.y1 - view.y0)) * cssH;
  const ux = (p: number) => view.x0 + (p / cssW) * (view.x1 - view.x0);
  const uy = (p: number) => view.y0 + ((cssH - p) / cssH) * (view.y1 - view.y0);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !theme || !cssW || !cssH) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, cssW, cssH);

    // grid
    const sx = niceStep(view.x1 - view.x0, Math.max(4, cssW / 90));
    const sy = niceStep(view.y1 - view.y0, Math.max(4, cssH / 70));
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.border;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let x = Math.ceil(view.x0 / (sx / 5)) * (sx / 5); x <= view.x1; x += sx / 5) { const X = Math.round(px(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, cssH); }
    for (let y = Math.ceil(view.y0 / (sy / 5)) * (sy / 5); y <= view.y1; y += sy / 5) { const Y = Math.round(py(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(cssW, Y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let x = Math.ceil(view.x0 / sx) * sx; x <= view.x1; x += sx) { const X = Math.round(px(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, cssH); }
    for (let y = Math.ceil(view.y0 / sy) * sy; y <= view.y1; y += sy) { const Y = Math.round(py(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(cssW, Y); }
    ctx.stroke();

    // axes, pinned to the edge when off screen so the labels stay readable
    const ax = Math.min(cssW - 1, Math.max(0, px(0)));
    const ay = Math.min(cssH - 1, Math.max(0, py(0)));
    ctx.strokeStyle = theme.subtle;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(ay) + 0.5); ctx.lineTo(cssW, Math.round(ay) + 0.5);
    ctx.moveTo(Math.round(ax) + 0.5, 0); ctx.lineTo(Math.round(ax) + 0.5, cssH);
    ctx.stroke();

    // tick labels
    ctx.fillStyle = theme.subtle;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const labelY = ay > cssH - 18 ? ay - 15 : ay + 3;
    for (let x = Math.ceil(view.x0 / sx) * sx; x <= view.x1; x += sx) {
      if (Math.abs(x) < sx / 1e6) continue;
      ctx.fillText(tickLabel(x, sx), px(x), labelY);
    }
    ctx.textAlign = ax > cssW - 40 ? "right" : "left";
    ctx.textBaseline = "middle";
    const labelX = ax > cssW - 40 ? ax - 4 : ax + 4;
    for (let y = Math.ceil(view.y0 / sy) * sy; y <= view.y1; y += sy) {
      if (Math.abs(y) < sy / 1e6) continue;
      ctx.fillText(tickLabel(y, sy), labelX, py(y));
    }

    // curves
    const n = Math.max(200, Math.round(cssW * 2));
    const span = view.y1 - view.y0;
    compiled.forEach((cf, i) => {
      if (!cf || !("fn" in cf)) return;
      ctx.strokeStyle = theme.series[i % theme.series.length];
      ctx.lineWidth = 2.25;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let pen = false;
      let prevY = NaN;
      for (let k = 0; k <= n; k++) {
        const x = view.x0 + (k / n) * (view.x1 - view.x0);
        let y: number;
        try { y = cf.fn(x); } catch { y = NaN; }
        // break at gaps and asymptotes (tan, 1/x) instead of drawing a vertical wall
        if (!Number.isFinite(y) || (pen && Math.abs(y - prevY) > span * 4)) { pen = false; prevY = y; continue; }
        const Y = Math.max(-cssH, Math.min(cssH * 2, py(y)));
        if (pen) ctx.lineTo(px(x), Y);
        else { ctx.moveTo(px(x), Y); pen = true; }
        prevY = y;
      }
      ctx.stroke();
    });

    // hover readout
    if (hoverX !== null) {
      const X = px(hoverX);
      ctx.strokeStyle = theme.subtle;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, cssH); ctx.stroke();
      ctx.setLineDash([]);
      compiled.forEach((cf, i) => {
        if (!cf || !("fn" in cf)) return;
        let y: number;
        try { y = cf.fn(hoverX); } catch { return; }
        if (!Number.isFinite(y) || y < view.y0 || y > view.y1) return;
        ctx.fillStyle = theme.series[i % theme.series.length];
        ctx.beginPath(); ctx.arc(X, py(y), 4, 0, Math.PI * 2); ctx.fill();
      });
    }
  });

  // ---------------------------------------------------------------- pan and zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: GraphView; x: number; y: number; dist?: number } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const zoomAt = (v: GraphView, cx: number, cy: number, f: number): GraphView => {
    const X = v.x0 + (cx / cssW) * (v.x1 - v.x0);
    const Y = v.y0 + ((cssH - cy) / cssH) * (v.y1 - v.y0);
    const nv = { x0: X - (X - v.x0) * f, x1: X + (v.x1 - X) * f, y0: Y - (Y - v.y0) * f, y1: Y + (v.y1 - Y) * f };
    return nv.x1 - nv.x0 < 1e-9 || nv.x1 - nv.x0 > 1e9 ? v : nv;
  };

  // wheel must be non-passive to stop the page scrolling while zooming
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      commitView(zoomAt(view, p.x, p.y, Math.exp(e.deltaY * 0.0015)));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  });

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    gesture.current = pts.length === 2
      ? { view, x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) }
      : { view, x: pts[0].x, y: pts[0].y };
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") setHoverX(ux(p.x));
      return;
    }
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    const v0 = g.view;
    const w = v0.x1 - v0.x0, h = v0.y1 - v0.y0;
    if (pts.length === 2 && g.dist) {
      const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const zoomed = zoomAt(v0, g.x, g.y, g.dist / d);
      const zw = zoomed.x1 - zoomed.x0, zh = zoomed.y1 - zoomed.y0;
      const dx = ((mx - g.x) / cssW) * zw, dy = ((my - g.y) / cssH) * zh;
      commitView({ x0: zoomed.x0 - dx, x1: zoomed.x1 - dx, y0: zoomed.y0 + dy, y1: zoomed.y1 + dy });
    } else {
      const dx = ((p.x - g.x) / cssW) * w, dy = ((p.y - g.y) / cssH) * h;
      commitView({ x0: v0.x0 - dx, x1: v0.x1 - dx, y0: v0.y0 + dy, y1: v0.y1 + dy });
      setHoverX(ux(p.x));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const pts = [...pointers.current.values()];
    gesture.current = pts.length ? { view, x: pts[0].x, y: pts[0].y } : null;
  };

  /** Fit y to what the visible curves actually do, ignoring spikes. */
  const fitY = () => {
    const ys: number[] = [];
    for (const cf of compiled) {
      if (!cf || !("fn" in cf)) continue;
      for (let k = 0; k <= 400; k++) {
        const x = view.x0 + (k / 400) * (view.x1 - view.x0);
        try { const y = cf.fn(x); if (Number.isFinite(y)) ys.push(y); } catch { /* skip */ }
      }
    }
    if (!ys.length) return;
    ys.sort((a, b) => a - b);
    const lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.ceil(ys.length * 0.98) - 1];
    const pad = (hi - lo || 2) * 0.1;
    commitView({ ...view, y0: lo - pad, y1: hi + pad });
  };

  const setFn = (i: number, v: string) => onChange({ fns: fns.map((f, j) => (j === i ? v : f)), view });
  const readout = hoverX !== null ? compiled.map((cf) => {
    if (!cf || !("fn" in cf)) return null;
    try { return cf.fn(hoverX); } catch { return null; }
  }) : null;

  const btn = "flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-muted hover:text-fg";

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {fns.map((f, i) => {
          const cf = compiled[i];
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: theme?.series[i % 8] }} aria-hidden />
              <span className="shrink-0 font-mono text-sm text-subtle">y =</span>
              <input
                value={f.replace(/^\s*y\s*=\s*/, "")}
                onChange={(e) => setFn(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && i === fns.length - 1 && f.trim() && fns.length < MAX_FNS) onChange({ fns: [...fns, ""], view });
                }}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                placeholder={i === 0 ? "e.g. x^2 - 3,  sin(x),  2x + 1" : "another function"}
                aria-label={`Function ${i + 1}`}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 font-mono text-sm outline-none focus:border-accent/60"
              />
              {cf && "error" in cf ? <span className="max-w-[35%] shrink-0 truncate text-xs text-bad/80" title={cf.error}>{cf.error}</span> : null}
              {fns.length > 1 ? (
                <button className={btn} aria-label={`Remove function ${i + 1}`} onClick={() => onChange({ fns: fns.filter((_, j) => j !== i), view })}>
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          );
        })}
        {fns.length < MAX_FNS ? (
          <button className="text-xs font-medium text-accent hover:underline" onClick={() => onChange({ fns: [...fns, ""], view })}>
            + Add a function
          </button>
        ) : null}
      </div>

      <div ref={wrapRef} className="relative overflow-hidden rounded-xl border border-border">
        <canvas
          ref={canvasRef}
          className={cn("block w-full cursor-grab active:cursor-grabbing", fullscreen ? "h-[calc(100dvh-15rem)] min-h-[20rem]" : "h-72 sm:h-96")}
          style={{ touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => { if (!pointers.current.size) setHoverX(null); }}
        />
        <div className="absolute right-1.5 top-1.5 flex items-center rounded-xl border border-border bg-surface/90 shadow-[var(--shadow-sm)] backdrop-blur">
          <button className={btn} title="Zoom in" aria-label="Zoom in" onClick={() => commitView(zoomAt(view, cssW / 2, cssH / 2, 0.6))}><Plus className="h-4 w-4" /></button>
          <button className={btn} title="Zoom out" aria-label="Zoom out" onClick={() => commitView(zoomAt(view, cssW / 2, cssH / 2, 1 / 0.6))}><Minus className="h-4 w-4" /></button>
          <button className={btn} title="Fit y to the curves" aria-label="Fit y to the curves" onClick={fitY}><Maximize className="h-4 w-4" /></button>
          <button className={btn} title="Reset view" aria-label="Reset view" onClick={() => commitView({ ...DEFAULT_VIEW })}><RotateCcw className="h-4 w-4" /></button>
        </div>
        {readout && hoverX !== null ? (
          <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-lg border border-border bg-surface/90 px-2 py-1 font-mono text-[11px] shadow-[var(--shadow-sm)]">
            <div className="text-subtle">x = {fmtNum(Number(hoverX.toPrecision(4)))}</div>
            {readout.map((y, i) =>
              y !== null ? (
                <div key={i} className={cn(!Number.isFinite(y) && "opacity-50")} style={{ color: theme?.series[i % 8] }}>
                  y{fns.filter((f) => f.trim()).length > 1 ? i + 1 : ""} = {fmtNum(Number(y.toPrecision(6)))}
                </div>
              ) : null,
            )}
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-subtle">Drag to move, scroll or pinch to zoom. Uses the calculator&apos;s maths: <code>x^2</code>, <code>sqrt(x)</code>, <code>abs(x)</code>, <code>2sin(x)</code>, <code>e^(-x^2)</code>.</p>
    </div>
  );
}
