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

// Mirrors the tokens in globals.css (Aivaura blue accent, warm neutrals).
const LIGHT: Palette = {
  accent: "#2F55E4",
  accentSoft: "#B7C5F6",
  ink: "#14161A",
  subtle: "#5E665F",
  grid: "#E3E6E1",
  amber: "#cb7a0b",
  red: "#c52828",
  blue: "#2a78d6",
  good: "#127256",
  surface: "#ffffff",
  heat: ["#ECEEEA", "#DBE3FB", "#B7C6F6", "#8EA6F0", "#6585EA", "#3E63E5", "#2447C6"],
};
const DARK: Palette = {
  accent: "#5A7BEE",
  accentSoft: "#22336B",
  ink: "#EEF2EF",
  subtle: "#8D968F",
  grid: "#232723",
  amber: "#f2b04a",
  red: "#e97a7a",
  blue: "#3987e5",
  good: "#5ec9a3",
  surface: "#131513",
  heat: ["#1A1D1A", "#1C2541", "#22336B", "#2B4396", "#3A57C2", "#5A7BEE", "#8EA6F4"],
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
