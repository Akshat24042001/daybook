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

// Mirrors the tokens in globals.css: pastel blue for data, green / yellow / red only for good / watch / bad.
const LIGHT: Palette = {
  accent: "#7C9EDB",
  accentSoft: "#C9D9F5",
  ink: "#2E3440",
  subtle: "#667085",
  grid: "#E6E9EF",
  amber: "#D9B45A",
  red: "#D98C8C",
  blue: "#7C9EDB",
  good: "#6FB892",
  surface: "#ffffff",
  heat: ["#EFF1F5", "#E4ECFA", "#C9D9F5", "#AFC6F0", "#93B1E8", "#7C9EDB", "#5E83C8"],
};
const DARK: Palette = {
  accent: "#9DB8E8",
  accentSoft: "#2C3D5C",
  ink: "#E6E8EC",
  subtle: "#9AA1AD",
  grid: "#2C313B",
  amber: "#E9CD7E",
  red: "#E59E9E",
  blue: "#9DB8E8",
  good: "#8FCFAB",
  surface: "#1E2128",
  heat: ["#262A33", "#232D40", "#2C3D5C", "#3B5280", "#5671A6", "#7894CC", "#9DB8E8"],
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
