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

// Mirrors the tokens in globals.css (teal accent, navy ink, pastel tints).
const LIGHT: Palette = {
  accent: "#0E7C7B",
  accentSoft: "#9FD9D3",
  ink: "#2B2F36",
  subtle: "#5A6472",
  grid: "#E3E9F0",
  amber: "#cb7a0b",
  red: "#c52828",
  blue: "#2a78d6",
  good: "#127256",
  surface: "#ffffff",
  heat: ["#EEF3F8", "#E0F4F3", "#BFE6E2", "#94D2CB", "#5FB8B0", "#2E9893", "#0E7C7B"],
};
const DARK: Palette = {
  accent: "#6FD3CB",
  accentSoft: "#1E4A4A",
  ink: "#E6ECF3",
  subtle: "#9AA5B1",
  grid: "#26364A",
  amber: "#f2b04a",
  red: "#e97a7a",
  blue: "#3987e5",
  good: "#5ec9a3",
  surface: "#152030",
  heat: ["#1B283B", "#173638", "#1E4A4A", "#2A6563", "#3D8984", "#56AFA8", "#6FD3CB"],
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
