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

export const HUE: Record<Hue, { tint: string; ink: string; fill: string; ring: string; wash: string }> = {
  sky:    { tint: "bg-p-sky",    ink: "text-p-sky-fg",    fill: "bg-accent",     ring: "ring-p-sky-fg/30",    wash: "--p-sky" },
  mint:   { tint: "bg-p-mint",   ink: "text-p-mint-fg",   fill: "bg-good",       ring: "ring-p-mint-fg/30",   wash: "--p-mint" },
  butter: { tint: "bg-p-butter", ink: "text-p-butter-fg", fill: "bg-warn",       ring: "ring-p-butter-fg/30", wash: "--p-butter" },
  rose:   { tint: "bg-p-rose",   ink: "text-p-rose-fg",   fill: "bg-bad",        ring: "ring-p-rose-fg/30",   wash: "--p-rose" },
  lilac:  { tint: "bg-p-lilac",  ink: "text-p-lilac-fg",  fill: "bg-lilac-fill", ring: "ring-p-lilac-fg/30",  wash: "--p-lilac" },
  peach:  { tint: "bg-p-peach",  ink: "text-p-peach-fg",  fill: "bg-peach-fill", ring: "ring-p-peach-fg/30",  wash: "--p-peach" },
  teal:   { tint: "bg-p-teal",   ink: "text-p-teal-fg",   fill: "bg-teal-fill",  ring: "ring-p-teal-fg/30",   wash: "--p-teal" },
  pink:   { tint: "bg-p-pink",   ink: "text-p-pink-fg",   fill: "bg-pink-fill",  ring: "ring-p-pink-fg/30",   wash: "--p-pink" },
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
