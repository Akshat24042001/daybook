/**
 * Colour with a job. Each hue stands for one kind of thing, so a colour tells you what you are looking at
 * before you read it. Full rationale in DECISIONS.md ("Colour").
 *
 *   sky    action: today, tasks, projects         mint   success and money: pipeline, health, wins
 *   butter attention: must-dos, unfinished        rose   urgent or negative: overdue, over a limit, lost
 *   lilac  thinking and rest: plan, review, diary teal   measuring: stats, goals, radar, time
 *   peach  people: contacts, accounts, follow-ups pink   leisure and social: Instagram, personal time
 *
 * Class names are written out in full so Tailwind can see them.
 */
export type Hue = "sky" | "mint" | "butter" | "rose" | "lilac" | "peach" | "teal" | "pink";

export const HUE: Record<Hue, { tint: string; ink: string; fill: string; ring: string; wash: string; pill: string; soft: string; edge: string }> = {
  sky:    { tint: "bg-p-sky",    ink: "text-p-sky-fg",    fill: "bg-accent",     ring: "ring-p-sky-fg/30",    wash: "--p-sky", pill: "bg-[linear-gradient(135deg,hsl(var(--p-sky)),hsl(var(--sky-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-sky)),hsl(var(--surface)))]", edge: "border-[hsl(var(--sky-fill)/0.6)]" },
  mint:   { tint: "bg-p-mint",   ink: "text-p-mint-fg",   fill: "bg-good",       ring: "ring-p-mint-fg/30",   wash: "--p-mint", pill: "bg-[linear-gradient(135deg,hsl(var(--p-mint)),hsl(var(--mint-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-mint)),hsl(var(--surface)))]", edge: "border-[hsl(var(--mint-fill)/0.6)]" },
  butter: { tint: "bg-p-butter", ink: "text-p-butter-fg", fill: "bg-warn",       ring: "ring-p-butter-fg/30", wash: "--p-butter", pill: "bg-[linear-gradient(135deg,hsl(var(--p-butter)),hsl(var(--butter-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-butter)),hsl(var(--surface)))]", edge: "border-[hsl(var(--butter-fill)/0.6)]" },
  rose:   { tint: "bg-p-rose",   ink: "text-p-rose-fg",   fill: "bg-bad",        ring: "ring-p-rose-fg/30",   wash: "--p-rose", pill: "bg-[linear-gradient(135deg,hsl(var(--p-rose)),hsl(var(--rose-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-rose)),hsl(var(--surface)))]", edge: "border-[hsl(var(--rose-fill)/0.6)]" },
  lilac:  { tint: "bg-p-lilac",  ink: "text-p-lilac-fg",  fill: "bg-lilac-fill", ring: "ring-p-lilac-fg/30",  wash: "--p-lilac", pill: "bg-[linear-gradient(135deg,hsl(var(--p-lilac)),hsl(var(--lilac-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-lilac)),hsl(var(--surface)))]", edge: "border-[hsl(var(--lilac-fill)/0.6)]" },
  peach:  { tint: "bg-p-peach",  ink: "text-p-peach-fg",  fill: "bg-peach-fill", ring: "ring-p-peach-fg/30",  wash: "--p-peach", pill: "bg-[linear-gradient(135deg,hsl(var(--p-peach)),hsl(var(--peach-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-peach)),hsl(var(--surface)))]", edge: "border-[hsl(var(--peach-fill)/0.6)]" },
  teal:   { tint: "bg-p-teal",   ink: "text-p-teal-fg",   fill: "bg-teal-fill",  ring: "ring-p-teal-fg/30",   wash: "--p-teal", pill: "bg-[linear-gradient(135deg,hsl(var(--p-teal)),hsl(var(--teal-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-teal)),hsl(var(--surface)))]", edge: "border-[hsl(var(--teal-fill)/0.6)]" },
  pink:   { tint: "bg-p-pink",   ink: "text-p-pink-fg",   fill: "bg-pink-fill",  ring: "ring-p-pink-fg/30",   wash: "--p-pink", pill: "bg-[linear-gradient(135deg,hsl(var(--p-pink)),hsl(var(--pink-fill)/0.75))]", soft: "bg-[linear-gradient(160deg,hsl(var(--p-pink)),hsl(var(--surface)))]", edge: "border-[hsl(var(--pink-fill)/0.6)]" },
};

/** The hue of each page, by path prefix (longest match wins). */
const PAGE_HUE: [string, Hue][] = [
  ["/today", "sky"], ["/task", "sky"], ["/tasks", "sky"], ["/history", "lilac"], ["/projects", "sky"],
  ["/plan", "lilac"], ["/diary", "lilac"], ["/review", "lilac"], ["/assistant", "lilac"], ["/scratch", "lilac"], ["/refs", "lilac"],
  ["/unfinished", "butter"],
  ["/sales/pipeline", "mint"], ["/sales/radar", "teal"], ["/sales/accounts", "peach"], ["/sales", "sky"],
  ["/health", "mint"],
  ["/stats", "teal"], ["/goals", "teal"],
  ["/contacts", "peach"],
  ["/settings", "sky"],
];

export function hueForPath(pathname: string): Hue {
  let best: [string, Hue] | null = null;
  for (const e of PAGE_HUE) {
    if ((pathname === e[0] || pathname.startsWith(`${e[0]}/`)) && (!best || e[0].length > best[0].length)) best = e;
  }
  return best ? best[1] : "sky";
}
