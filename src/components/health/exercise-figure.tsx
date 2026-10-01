"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { GROUND, TOP, poseAt, solve, type Prop, type Pt, type Rig } from "@/lib/exercise-catalog";

const W = 120;
const H = GROUND + 6 - TOP;

function PropShape({ prop }: { prop: Prop }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (prop.kind === "wall") return <line x1={prop.x} y1={TOP + 4} x2={prop.x} y2={GROUND + 1.6} {...common} strokeWidth={2.4} />;
  if (prop.kind === "step") return <rect x={prop.x} y={prop.y + 1.6} width={prop.w} height={GROUND + 1.6 - prop.y - 1.6} rx={1.5} {...common} />;
  if (prop.kind === "desk") {
    return (
      <g {...common}>
        <line x1={prop.x} y1={prop.y + 1.6} x2={prop.x + prop.w} y2={prop.y + 1.6} strokeWidth={2.4} />
        <line x1={prop.x + 3} y1={prop.y + 1.6} x2={prop.x + 3} y2={GROUND + 1.6} />
        <line x1={prop.x + prop.w - 3} y1={prop.y + 1.6} x2={prop.x + prop.w - 3} y2={GROUND + 1.6} />
      </g>
    );
  }
  // chair: seat, legs and a back on the left
  return (
    <g {...common}>
      <line x1={prop.x} y1={prop.y + 1.6} x2={prop.x + prop.w} y2={prop.y + 1.6} strokeWidth={2.4} />
      <line x1={prop.x + 2} y1={prop.y + 1.6} x2={prop.x + 2} y2={GROUND + 1.6} />
      <line x1={prop.x + prop.w - 2} y1={prop.y + 1.6} x2={prop.x + prop.w - 2} y2={GROUND + 1.6} />
      <line x1={prop.x + 1} y1={prop.y + 1.6} x2={prop.x - 1} y2={prop.y - 22} />
    </g>
  );
}

const line = (a: Pt, b: Pt, key: string) => <line key={key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;

/**
 * An animated stick figure doing the exercise. `playing` runs the loop; when paused it shows the key pose that best
 * explains the move. Honours reduced motion.
 */
export function ExerciseFigure({
  rig,
  playing = true,
  className,
  label,
}: {
  rig: Rig;
  playing?: boolean;
  className?: string;
  label?: string;
}) {
  // the second key pose is the "working" position for every rig, so a still frame still teaches something
  const still = 1 / rig.frames.length;
  const [phase, setPhase] = useState(still);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!playing || reduce) {
      setPhase(still);
      return;
    }
    const start = performance.now() - still * rig.ms;
    const loop = (now: number) => {
      setPhase(((now - start) % rig.ms) / rig.ms);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [playing, rig, still]);

  const s = solve(rig, poseAt(rig, phase));
  const limb = (pts: (Pt | null)[], key: string) => {
    const p = pts.filter((x): x is Pt => x !== null);
    return <g key={key}>{p.slice(1).map((b, i) => line(p[i], b, `${key}${i}`))}</g>;
  };

  return (
    <svg viewBox={`0 ${TOP} ${W} ${H}`} className={cn("block text-fg", className)} role="img" aria-label={label ?? "Exercise demonstration"}>
      <line x1={2} y1={GROUND + 2} x2={W - 2} y2={GROUND + 2} stroke="currentColor" strokeWidth={1} className="opacity-25" />
      {rig.prop ? <g className="text-subtle opacity-70"><PropShape prop={rig.prop} /></g> : null}
      {/* far side first, faint */}
      <g stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" fill="none" className="opacity-35">
        {limb(s.arms[1], "af")}
        {limb(s.legs[1], "lf")}
      </g>
      <g stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {line(s.hip, s.neck, "torso")}
        {limb(s.legs[0], "ln")}
        {limb(s.arms[0], "an")}
      </g>
      <circle cx={s.head[0]} cy={s.head[1]} r={5.4} className="fill-accent" />
    </svg>
  );
}
