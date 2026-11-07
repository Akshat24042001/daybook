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

// Mirrors the tokens in globals.css: one blue for data; green / amber / red only for good / watch / bad.
const LIGHT: Palette = {
  accent: "#2563EB",
  accentSoft: "#BFD3FB",
  ink: "#111827",
  subtle: "#5F6673",
  grid: "#E4E7EC",
  amber: "#E89B0C",
  red: "#DC3B3B",
  blue: "#2563EB",
  good: "#16A06A",
  surface: "#ffffff",
  heat: ["#EEF1F5", "#DBE6FD", "#BCD0FB", "#93B3F7", "#6492F1", "#3B73E8", "#1D57D1"],
};
const DARK: Palette = {
  accent: "#6EA2FF",
  accentSoft: "#1E2B47",
  ink: "#E8EAEE",
  subtle: "#9AA0AB",
  grid: "#272A31",
  amber: "#F0B44C",
  red: "#F07575",
  blue: "#6EA2FF",
  good: "#4CC38A",
  surface: "#16181D",
  heat: ["#1B1E24", "#1C2A47", "#21396A", "#28508F", "#3369B8", "#4A86DF", "#77A6FF"],
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
