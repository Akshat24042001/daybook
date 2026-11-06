/**
 * Look and feel: light, dark ("Dusk") or follow the device, and a pastel palette. "Candy" colours each page in its own
 * pastel (see lib/hue.ts); the others paint every page in one pastel. Both choices live in localStorage and are
 * applied before first paint by the inline script in app/layout.tsx.
 */
import type { Hue } from "./hue";

export type ThemePref = "system" | "light" | "dark";
export type PaletteId = "candy" | Hue;

export const PALETTES: { id: PaletteId; label: string; hint: string; swatch: string[] }[] = [
  { id: "candy", label: "Candy", hint: "Every page in its own pastel", swatch: ["#BFD2FF", "#D9C7FF", "#BDF2D8", "#FFC7E3"] },
  { id: "lilac", label: "Lavender", hint: "Soft purple everywhere", swatch: ["#D9C7FF", "#EBDDFF", "#FFC7E3", "#C7E6FF"] },
  { id: "sky", label: "Sky", hint: "Cloudy blue everywhere", swatch: ["#B5DDFF", "#CFE9FF", "#D9C7FF", "#BDF2D8"] },
  { id: "mint", label: "Mint", hint: "Fresh green everywhere", swatch: ["#B5F0D3", "#D4F7E5", "#C7E6FF", "#FFF0A8"] },
  { id: "peach", label: "Peach", hint: "Warm apricot everywhere", swatch: ["#FFD0B0", "#FFE6C7", "#FFF0A8", "#FFC7D2"] },
  { id: "pink", label: "Blossom", hint: "Cherry-blossom pink everywhere", swatch: ["#FFC4E0", "#FFDDEE", "#D9C7FF", "#FFD0B0"] },
  { id: "teal", label: "Lagoon", hint: "Aqua everywhere", swatch: ["#A8EDE6", "#CFF6F1", "#C7E6FF", "#D9C7FF"] },
  { id: "butter", label: "Butter", hint: "Sunny yellow everywhere", swatch: ["#FFE88A", "#FFF3BF", "#FFD0B0", "#BDF2D8"] },
  { id: "rose", label: "Rose", hint: "Rosy pink-red everywhere", swatch: ["#FFB8C6", "#FFD9E0", "#FFD0B0", "#D9C7FF"] },
];

const THEME_KEY = "daybook-theme";
const PALETTE_KEY = "daybook-palette";

export function getThemePref(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Sets data-theme to the resolved value ("light" or "dark") so the CSS only ever has to know those two. */
export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode: the choice just will not stick */
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent("daybook:theme", { detail: pref }));
}

export function getPalette(): PaletteId {
  try {
    const p = localStorage.getItem(PALETTE_KEY) as PaletteId | null;
    return PALETTES.some((x) => x.id === p) ? (p as PaletteId) : "candy";
  } catch {
    return "candy";
  }
}

export function setPalette(id: PaletteId): void {
  try {
    localStorage.setItem(PALETTE_KEY, id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("daybook:palette-change", { detail: id }));
}
