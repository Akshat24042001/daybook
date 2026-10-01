"use client";

import { Move3d, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { poseAt, propBoxes, solve, toBody3, type P3, type Rig } from "@/lib/exercise-catalog";

// ---------------------------------------------------------------- one clock for every figure on the page

const subs = new Set<(now: number) => void>();
let raf = 0;
function frame(now: number) {
  for (const f of subs) f(now);
  raf = subs.size ? requestAnimationFrame(frame) : 0;
}
function onFrame(f: (now: number) => void) {
  subs.add(f);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => void subs.delete(f);
}

// ---------------------------------------------------------------- camera

const CY = 40; // the height the camera orbits around
const FOCAL = 240;

interface View { yaw: number; pitch: number }
const defaultView = (rig: Rig): View => ({ yaw: rig.view === "front" ? -Math.PI / 2 + 0.45 : -0.42, pitch: 0.28 });
export const VIEWS = {
  front: { yaw: -Math.PI / 2, pitch: 0.08 },
  side: { yaw: 0, pitch: 0.08 },
  top: { yaw: -0.6, pitch: 1.15 },
} as const;

interface Proj { x: number; y: number; d: number; s: number }
function project([X, Y0, Z]: P3, v: View): Proj {
  const Y = Y0 - CY;
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const x1 = X * cy + Z * sy;
  const d0 = -X * sy + Z * cy; // towards the camera
  const y1 = Y * cp - d0 * sp;
  const d = d0 * cp + Y * sp;
  const s = FOCAL / (FOCAL - d);
  return { x: x1 * s, y: -y1 * s, d, s };
}

type Item =
  | { k: "seg"; a: Proj; b: Proj; w: number; d: number }
  | { k: "head"; c: Proj; d: number };

/**
 * A 3D stick figure doing the exercise, drawn in SVG: perspective, limbs sorted back to front and shaded by depth,
 * a floor grid with a shadow, props as boxes. Drag to turn it around; the dialog adds view buttons and a spin.
 * Always animates while on screen (a still pose with reduced motion).
 */
export function ExerciseFigure({
  rig, className, label, controls = false, fps = 30,
}: {
  rig: Rig;
  className?: string;
  label?: string;
  /** view buttons, spin and pause (the big dialog figure) */
  controls?: boolean;
  fps?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [phase, setPhase] = useState(1 / rig.frames.length);
  const [view, setView] = useState<View>(() => defaultView(rig));
  const [spin, setSpin] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const moved = useRef(false);

  useEffect(() => setView(defaultView(rig)), [rig]);

  // animate only while on screen
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!visible || reduce || (paused && !spin)) return;
    let last = 0;
    let prev = performance.now();
    const start = performance.now() - phase * rig.ms;
    return onFrame((now) => {
      if (now - last < 1000 / fps) return;
      const dt = (now - prev) / 1000;
      prev = now;
      last = now;
      if (!paused) setPhase(((now - start) % rig.ms) / rig.ms);
      if (spin) setView((v) => ({ ...v, yaw: v.yaw + dt * 0.7 }));
    });
    // phase is read once to resume where it stopped
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, paused, spin, rig, fps]);

  const body = toBody3(rig, solve(rig, poseAt(rig, phase)));

  // ---- the scene
  const items: Item[] = [];
  const seg = (a: P3, b: P3, w: number) => {
    const pa = project(a, view), pb = project(b, view);
    items.push({ k: "seg", a: pa, b: pb, w, d: (pa.d + pb.d) / 2 });
  };
  seg(body.hip, body.neck, 4.4);
  seg(body.arms[0][0], body.arms[1][0], 3.6);
  seg(body.legs[0][0], body.legs[1][0], 3.6);
  for (const a of body.arms) { seg(a[0], a[1], 3.3); seg(a[1], a[2], 3); }
  for (const l of body.legs) { seg(l[0], l[1], 3.8); seg(l[1], l[2], 3.3); if (l[3]) seg(l[2], l[3], 2.6); }
  const head = project(body.head, view);
  items.push({ k: "head", c: head, d: head.d });
  items.sort((a, b) => a.d - b.d);
  const ds = items.map((i) => i.d);
  const dMin = Math.min(...ds), dMax = Math.max(...ds);
  const shade = (d: number) => 0.42 + 0.58 * (dMax - dMin < 0.5 ? 1 : (d - dMin) / (dMax - dMin));

  // floor grid and shadow
  const grid: [Proj, Proj][] = [];
  for (let x = -42; x <= 42; x += 12) grid.push([project([x, 0, -24], view), project([x, 0, 24], view)]);
  for (let z = -24; z <= 24; z += 12) grid.push([project([-42, 0, z], view), project([42, 0, z], view)]);
  const hipX = body.hip[0];
  const shadow = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    const p = project([hipX + Math.cos(a) * 20, 0, Math.sin(a) * 9], view);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");

  // props
  const boxes = propBoxes(rig).map(([x0, x1, y0, y1, z0, z1]) => {
    const c = [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => project([x, y, z], view))));
    // corner index = xi*4 + yi*2 + zi
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const top = [2, 3, 7, 6].map((i) => `${c[i].x.toFixed(1)},${c[i].y.toFixed(1)}`).join(" ");
    return { c, edges, top };
  });

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
    moved.current = false;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { g.moved = true; moved.current = true; }
    if (!g.moved) return;
    setSpin(false);
    setView({ yaw: g.v.yaw + dx * 0.012, pitch: Math.max(-0.2, Math.min(1.35, g.v.pitch + dy * 0.008)) });
  }
  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div className={cn("relative", className)}>
      <svg
        ref={ref}
        viewBox="-50 -52 100 94"
        className="block h-full w-full cursor-grab touch-none select-none text-fg active:cursor-grabbing"
        role="img"
        aria-label={`${label ?? "Exercise demonstration"}. Drag to turn it around.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // a drag is not a click on whatever holds the figure
        onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } }}
        onDoubleClick={() => { setSpin(false); setView(defaultView(rig)); }}
      >
        <defs>
          <radialGradient id="fig-head" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.55" />
            <stop offset="100%" stopColor="hsl(var(--accent))" />
          </radialGradient>
        </defs>
        <g stroke="currentColor" strokeWidth={0.35} strokeOpacity={0.16}>
          {grid.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)}
        </g>
        <polygon points={shadow} fill="currentColor" fillOpacity={0.12} />
        {boxes.map((b, i) => (
          <g key={i} className="text-subtle">
            <polygon points={b.top} fill="currentColor" className="opacity-[0.12]" />
            <g stroke="currentColor" strokeWidth={0.7} className="opacity-60">
              {b.edges.map(([p, q], j) => <line key={j} x1={b.c[p].x} y1={b.c[p].y} x2={b.c[q].x} y2={b.c[q].y} />)}
            </g>
          </g>
        ))}
        <g strokeLinecap="round" fill="none">
          {items.map((it, i) =>
            it.k === "seg" ? (
              <line
                key={i}
                x1={it.a.x} y1={it.a.y} x2={it.b.x} y2={it.b.y}
                stroke="currentColor"
                strokeOpacity={shade(it.d)}
                strokeWidth={it.w * ((it.a.s + it.b.s) / 2)}
              />
            ) : (
              <circle key={i} cx={it.c.x} cy={it.c.y} r={5.6 * it.c.s} fill="url(#fig-head)" />
            ),
          )}
        </g>
      </svg>
      {controls ? (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-1 p-1.5">
          {(["front", "side", "top"] as const).map((k) => (
            <button key={k} type="button" onClick={() => { setSpin(false); setView(VIEWS[k]); }} className="rounded-lg bg-surface/90 px-2 py-1 text-[11px] font-semibold capitalize text-subtle shadow-sm hover:text-fg">
              {k}
            </button>
          ))}
          <button type="button" onClick={() => { setSpin(false); setView(defaultView(rig)); }} className="rounded-lg bg-surface/90 px-2 py-1 text-[11px] font-semibold text-subtle shadow-sm hover:text-fg" aria-label="Reset the view">
            <RotateCcw className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => setSpin((v) => !v)} aria-pressed={spin} className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold shadow-sm", spin ? "bg-accent text-accent-fg" : "bg-surface/90 text-subtle hover:text-fg")}>
            <Move3d className="h-3 w-3" /> Spin
          </button>
          <button type="button" onClick={() => setPaused((v) => !v)} className="rounded-lg bg-surface/90 px-2 py-1 text-[11px] font-semibold text-subtle shadow-sm hover:text-fg" aria-label={paused ? "Play" : "Pause"}>
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </button>
        </div>
      ) : null}
    </div>
  );
}
