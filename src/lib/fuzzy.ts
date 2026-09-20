/**
 * Duplicate guard (PRD section 5): fuzzy-match a new title against active
 * tasks so that "add existing task to today" can be offered instead of a
 * second copy. Pure and dependency-free.
 */

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ba = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const v of ba.values()) total += v;
  for (const v of bb.values()) total += v;
  for (const [g, n] of ba) overlap += Math.min(n, bb.get(g) ?? 0);
  return (2 * overlap) / total;
}

function tokenContainment(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size < 2) return 0;
  let hit = 0;
  for (const t of small) if (big.has(t)) hit++;
  return hit === small.size ? 0.85 : 0;
}

export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  return Math.max(dice(na, nb), tokenContainment(na, nb));
}

export interface Candidate {
  id: number;
  title: string;
  projectName: string | null;
}

export interface Match extends Candidate {
  score: number;
}

/** Candidates whose title (with or without its project prefix) closely matches. */
export function findSimilar(
  title: string,
  project: string | null,
  candidates: Candidate[],
  threshold = 0.75,
): Match[] {
  const full = project ? `${project} ${title}` : title;
  const out: Match[] = [];
  for (const c of candidates) {
    // "Vector: Insights" and "DRAC: Insights" are different tasks.
    if (project && c.projectName && normalizeTitle(project) !== normalizeTitle(c.projectName)) continue;
    const cFull = c.projectName ? `${c.projectName} ${c.title}` : c.title;
    const score = Math.max(
      similarity(full, cFull),
      similarity(title, c.title),
      similarity(full, c.title),
      similarity(title, cFull),
    );
    if (score >= threshold) out.push({ ...c, score });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 3);
}
