/**
 * Look and feel: light, dark ("Dusk") or follow the device, and a pastel palette. "Candy" colours each page in its own
 * pastel (see lib/hue.ts); the others paint every page in one pastel. Both choices live in localStorage and are
 * applied before first paint by the inline script in app/layout.tsx.
 */
import type { Hue } from "./hue";

export type ThemePref = "system" | "light" | "dark";
export type PaletteId = "candy" | Hue;

export const PALETTES: { id: PaletteId; label: string; hint: string; swatch: string[] }[] = [
  { id: "candy", label: "Candy", hint: "Every page in its own pastel", swatch: ["#9DB5F5", "#C1A4F2", "#8FDDB9", "#F5A8CF"] },
  { id: "lilac", label: "Lavender", hint: "Soft purple everywhere", swatch: ["#C1A4F2", "#DCCBFA", "#F5A8CF", "#9CCBF5"] },
  { id: "sky", label: "Sky", hint: "Cloudy blue everywhere", swatch: ["#8FC7F2", "#B8DEF8", "#C1A4F2", "#8FDDB9"] },
  { id: "mint", label: "Mint", hint: "Fresh green everywhere", swatch: ["#8FDDB9", "#BDEFD6", "#9CCBF5", "#F7DC6F"] },
  { id: "peach", label: "Peach", hint: "Warm apricot everywhere", swatch: ["#F5B98C", "#F9D5B3", "#F7DC6F", "#F5A8B8"] },
  { id: "pink", label: "Blossom", hint: "Cherry-blossom pink everywhere", swatch: ["#F5A8CF", "#F9CCE4", "#C1A4F2", "#F5B98C"] },
  { id: "teal", label: "Lagoon", hint: "Aqua everywhere", swatch: ["#8CD9D1", "#BDEDE8", "#9CCBF5", "#C1A4F2"] },
  { id: "butter", label: "Butter", hint: "Sunny yellow everywhere", swatch: ["#F5D34F", "#FAE89A", "#F5B98C", "#8FDDB9"] },
  { id: "rose", label: "Rose", hint: "Rosy pink-red everywhere", swatch: ["#F5A0B3", "#F9CBD5", "#F5B98C", "#C1A4F2"] },
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
