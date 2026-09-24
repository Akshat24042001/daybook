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

// Mirrors the tokens in globals.css (indigo accent, cool neutrals).
const LIGHT: Palette = {
  accent: "#4337e6",
  accentSoft: "#b9b4f6",
  ink: "#121826",
  subtle: "#67707f",
  grid: "#e6e8ec",
  amber: "#cb7a0b",
  red: "#c52828",
  blue: "#2a78d6",
  good: "#127256",
  surface: "#ffffff",
  heat: ["#eceef2", "#e0defc", "#c3befa", "#a39bf5", "#8076ee", "#5d51e8", "#3f32d4"],
};
const DARK: Palette = {
  accent: "#7a73e8",
  accentSoft: "#3f3a7a",
  ink: "#eceef3",
  subtle: "#8f95a0",
  grid: "#2a2e37",
  amber: "#f2b04a",
  red: "#e97a7a",
  blue: "#3987e5",
  good: "#5ec9a3",
  surface: "#171a21",
  heat: ["#22252d", "#2c2a52", "#3a3570", "#4b4491", "#5f57b5", "#7a73e8", "#a09bf2"],
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
