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
  surface: string;
  heat: string[];
}

const LIGHT: Palette = {
  accent: "#15705a",
  accentSoft: "#9fd4c1",
  ink: "#2a231c",
  subtle: "#6b6259",
  grid: "#e4ddcf",
  amber: "#c96a05",
  red: "#c62828",
  blue: "#2f5fd0",
  surface: "#ffffff",
  heat: ["#efe9dc", "#f6d9c4", "#f3b98c", "#c7dd9b", "#8fc987", "#3d9d6b", "#15705a"],
};
const DARK: Palette = {
  accent: "#5fd0a4",
  accentSoft: "#2f6b57",
  ink: "#efe9dd",
  subtle: "#a89f93",
  grid: "#3a352f",
  amber: "#f5a623",
  red: "#ff7a7a",
  blue: "#8aa9ff",
  surface: "#1c1915",
  heat: ["#2a2620", "#5b3a2a", "#7a4d2a", "#4a6a3c", "#3f8a5a", "#3fae7c", "#5fd0a4"],
};

/** Chart colours that follow the system theme (SVG attributes cannot use CSS variables). */
export function usePalette(): { p: Palette; ready: boolean } {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setDark(mq.matches);
    apply();
    setReady(true);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return { p: dark ? DARK : LIGHT, ready };
}
