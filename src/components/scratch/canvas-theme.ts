"use client";

import { useEffect, useState } from "react";
import type { Ink } from "@/lib/scratch";

export interface CanvasTheme {
  dark: boolean;
  fg: string;
  subtle: string;
  border: string;
  surface: string;
  muted: string;
  accent: string;
  ink: Record<Ink, string>;
  /** graph series, in order */
  series: string[];
}

function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(`--${name}`).trim();
  if (!v) return fallback;
  const [h, s, l] = v.split(/\s+/);
  return `hsl(${h}, ${s}, ${l})`;
}

function read(): CanvasTheme {
  const style = getComputedStyle(document.documentElement);
  const surface = token(style, "surface", "#fff");
  // dark when the surface lightness is low, whatever set it (auto or the theme switch)
  const l = parseFloat(style.getPropertyValue("--surface").trim().split(/\s+/)[2] ?? "100");
  const dark = l < 50;
  const fg = token(style, "fg", "#111");
  return {
    dark,
    fg,
    subtle: token(style, "subtle", "#888"),
    border: token(style, "border", "#ddd"),
    surface,
    muted: token(style, "muted", "#eee"),
    accent: token(style, "accent", "#4f46e5"),
    ink: dark
      ? { ink: fg, red: "#f87171", blue: "#60a5fa", green: "#4ade80", orange: "#fb923c", purple: "#c084fc" }
      : { ink: fg, red: "#dc2626", blue: "#2563eb", green: "#16a34a", orange: "#ea580c", purple: "#7c3aed" },
    series: dark
      ? ["#818cf8", "#f87171", "#4ade80", "#fbbf24", "#c084fc", "#22d3ee", "#fb923c", "#f472b6"]
      : ["#4f46e5", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#ea580c", "#db2777"],
  };
}

/** Theme colours for canvas drawing, re-read when the app theme or the OS scheme changes. */
export function useCanvasTheme(): CanvasTheme | null {
  const [theme, setTheme] = useState<CanvasTheme | null>(null);
  useEffect(() => {
    const update = () => setTheme(read());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);
  return theme;
}

/**
 * The CSS size of an element, for sizing a canvas's backing store. Only read it: the element's own size must come
 * from CSS (width 100%, aspect-ratio or a fixed height), never from this value, or a scrollbar appearing and
 * disappearing can make layout and state chase each other forever.
 */
export function useElementSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const next = { w: Math.round(r.width), h: Math.round(r.height) };
        setSize((cur) => (cur.w === next.w && cur.h === next.h ? cur : next));
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [ref]);
  return size;
}
