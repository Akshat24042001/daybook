/**
 * Choosing where the radar looks, from results. Pure, so it is tested directly.
 *
 * Each country (weekly) and industry (daily) on your lists earns points from the last 120 days:
 *   1 per qualified radar lead from it, 3 per conversation (a deal from it where they replied), 10 per deal won.
 * Points are divided by how often it was already the focus (plus one), so a market that was targeted ten times and
 * produced the same as one targeted once ranks lower: it is results per turn, not results in total.
 *
 * Then, with a fixed share of periods kept for exploring (default 20%), the period goes to:
 *   - explore: the entry that was the focus least often (ties: least recently), so nothing on your list is ignored;
 *   - exploit: a weighted pick where each entry's chance is (1 + its score), so leaders win most turns but not all.
 * With no results at all yet, it rotates evenly like before ("fixed").
 * The pick is seeded by the period, so the same period always gives the same answer.
 */

export interface Stat {
  value: string;
  qualified: number;
  conversations: number;
  won: number;
  /** periods this was already the focus */
  turns: number;
  /** period key of the last time it was the focus, if any */
  last: string | null;
}

export interface Weighted extends Stat {
  points: number;
  score: number;
}

export interface Choice {
  value: string;
  mode: "exploit" | "explore" | "fixed";
  reason: string;
  weights: Weighted[];
}

const COUNTRY_ALIASES: Record<string, string> = {
  us: "united states", usa: "united states", "united states of america": "united states", america: "united states",
  uk: "united kingdom", england: "united kingdom", britain: "united kingdom", "great britain": "united kingdom", scotland: "united kingdom",
  uae: "united arab emirates", dubai: "united arab emirates", "abu dhabi": "united arab emirates", sharjah: "united arab emirates",
  ksa: "saudi arabia", riyadh: "saudi arabia", jeddah: "saudi arabia", holland: "netherlands", "the netherlands": "netherlands",
  prc: "china", "mainland china": "china", sg: "singapore", aus: "australia", deutschland: "germany",
};
const STOP = new Set(["and", "the", "for", "with", "services", "service", "firms", "companies", "business", "businesses", "industry"]);

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Does a free-text country from the AI or a deal ("USA", "Dubai, UAE") mean this list entry? */
export function sameCountry(free: string | null | undefined, entry: string): boolean {
  if (!free) return false;
  const e = norm(entry);
  const parts = norm(free).split(/ (?:and|or) |,/).flatMap((p) => [p.trim(), ...p.trim().split(" ")]);
  return [norm(free), ...parts].some((p) => p && (COUNTRY_ALIASES[p] ?? p) === e) || ` ${norm(free)} `.includes(` ${e} `);
}

/** Does a free-text industry ("Healthcare", "dental clinic") overlap this list entry ("healthcare clinics")? */
export function sameIndustry(free: string | null | undefined, entry: string): boolean {
  if (!free) return false;
  const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/s$/, "");
  const a = new Set(norm(free).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)).map(stem));
  return norm(entry).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)).map(stem).some((w) => a.has(w));
}

export function points(s: Pick<Stat, "qualified" | "conversations" | "won">): number {
  return s.qualified + 3 * s.conversations + 10 * s.won;
}

export function weigh(stats: Stat[]): Weighted[] {
  return stats
    .map((s) => ({ ...s, points: points(s), score: Math.round((points(s) / (s.turns + 1)) * 10) / 10 }))
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
}

/** A small deterministic random number in [0, 1) from a string. */
export function seeded(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function explain(w: Weighted): string {
  const bits = [w.qualified ? `${w.qualified} qualified lead${w.qualified === 1 ? "" : "s"}` : "", w.conversations ? `${w.conversations} conversation${w.conversations === 1 ? "" : "s"}` : "", w.won ? `${w.won} won` : ""].filter(Boolean);
  return `${bits.join(", ") || "no results yet"} in 120 days, from ${w.turns} turn${w.turns === 1 ? "" : "s"} as the focus`;
}

/**
 * @param period   the key of the period being decided ("c:2026-W45", "i:2026-11-07")
 * @param rotateIndex  the old rotation's index for this period, used when there are no results at all
 */
export function choose(stats: Stat[], period: string, explorePct: number, rotateIndex: number): Choice {
  const weights = weigh(stats);
  if (!weights.length) throw new Error("Nothing to choose from");
  const total = weights.reduce((a, w) => a + w.points, 0);
  if (total === 0) {
    const value = stats[rotateIndex % stats.length].value;
    return { value, mode: "fixed", reason: "No results to learn from yet, so the list rotates evenly.", weights };
  }
  if (seeded(`${period}:explore`) < explorePct / 100) {
    const pick = [...weights].sort((a, b) => a.turns - b.turns || (a.last ?? "").localeCompare(b.last ?? "") || a.value.localeCompare(b.value))[0];
    return { value: pick.value, mode: "explore", reason: `Exploring: ${pick.value} has had the fewest turns (${pick.turns}). ${explorePct}% of turns try the least-tested option so nothing is written off too early.`, weights };
  }
  const sum = weights.reduce((a, w) => a + 1 + w.score, 0);
  let r = seeded(`${period}:pick`) * sum;
  let pick = weights[weights.length - 1];
  for (const w of weights) {
    r -= 1 + w.score;
    if (r < 0) {
      pick = w;
      break;
    }
  }
  const leader = weights[0];
  const chance = Math.round(((1 + pick.score) / sum) * 100);
  return {
    value: pick.value,
    mode: "exploit",
    reason: pick.value === leader.value
      ? `${pick.value} gives the best results per turn: ${explain(pick)}. Chance this turn: ${chance}%.`
      : `${pick.value}: ${explain(pick)}. Picked by weight (chance ${chance}%); the leader is ${leader.value} (${explain(leader)}).`,
    weights,
  };
}
