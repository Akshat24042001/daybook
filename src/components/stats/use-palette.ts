"use client";

import { useEffect, useState } from "react";

export interface Palette {
  accent: string;
  accentSoft: string;
  ink: string;
  subtle: string;
  grid: string;
  amber: string;
  red: string;
  blue: string;
  good: string;
  surface: string;
  /** sequential ramp for the score heatmap, index 0 = no data */
  heat: string[];
}

// Mirrors the pastel tokens in globals.css: periwinkle for data, mint / butter / rose only for good / watch / bad.
const LIGHT: Palette = {
  accent: "#7C98F0",
  accentSoft: "#C9D6FF",
  ink: "#241F3A",
  subtle: "#5E5A78",
  grid: "#D9D0F0",
  amber: "#EBB93A",
  red: "#EE7F9A",
  blue: "#7C98F0",
  good: "#4FC08F",
  surface: "#ffffff",
  heat: ["#EDE6FA", "#DDD0F8", "#C9B5F4", "#B398EE", "#9C7BE6", "#865FDB", "#6F45C9"],
};
const DARK: Palette = {
  accent: "#A9BCFF",
  accentSoft: "#33385E",
  ink: "#EDE9FA",
  subtle: "#A9A3C4",
  grid: "#352F4F",
  amber: "#F2D57E",
  red: "#F2A0B3",
  blue: "#A9BCFF",
  good: "#8DDBB8",
  surface: "#241F36",
  heat: ["#2A2440", "#33385E", "#434A7E", "#5C66A6", "#7C88CC", "#9DAAEE", "#BFC9FF"],
};

function isDark() {
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Chart colours that follow the app theme, including the in-app Light/Dark toggle (SVG attributes cannot use CSS variables). */
export function usePalette(): { p: Palette; ready: boolean } {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setDark(isDark());
    apply();
    setReady(true);
    mq.addEventListener("change", apply);
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", apply);
      mo.disconnect();
    };
  }, []);
  return { p: dark ? DARK : LIGHT, ready };
}
