/**
 * Hours calculation (PRD section 8).
 *
 * Worked time = sum of office + outside segments inside the logical day.
 * Segments are clipped to the day window, so a segment that runs past the day
 * boundary contributes to each day only for its own share. Open segments run
 * to `now`. Overlapping segments are merged so nothing is counted twice.
 */

export type SegmentKind = "office" | "outside" | "break";

export interface Segment {
  kind: SegmentKind;
  start: Date;
  end: Date | null;
}

export const WORK_KINDS: ReadonlySet<SegmentKind> = new Set<SegmentKind>(["office", "outside"]);

export function isWorkKind(kind: SegmentKind): boolean {
  return WORK_KINDS.has(kind);
}

export interface Window {
  start: Date;
  end: Date;
}

function clipped(seg: Segment, win: Window, now: Date): [number, number] | null {
  const segEnd = seg.end ? seg.end.getTime() : now.getTime();
  const start = Math.max(seg.start.getTime(), win.start.getTime());
  const end = Math.min(segEnd, win.end.getTime());
  return end > start ? [start, end] : null;
}

export function workedMinutes(segments: Segment[], win: Window, now: Date): number {
  const spans: [number, number][] = [];
  for (const seg of segments) {
    if (!isWorkKind(seg.kind)) continue;
    const c = clipped(seg, win, now);
    if (c) spans.push(c);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of spans) {
    if (curEnd < 0 || s > curEnd) {
      if (curEnd >= 0) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd >= 0) total += curEnd - curStart;
  return total / 60_000;
}

/** Minutes spent in a given kind within the window (used for break totals). */
export function minutesInKind(
  segments: Segment[],
  kind: SegmentKind,
  win: Window,
  now: Date,
): number {
  let total = 0;
  for (const seg of segments) {
    if (seg.kind !== kind) continue;
    const c = clipped(seg, win, now);
    if (c) total += c[1] - c[0];
  }
  return total / 60_000;
}

/** Unaccounted time = worked time minus minutes logged to work tasks (never negative). */
export function unaccounted(
  workedMin: number,
  loggedWorkMin: number,
): { minutes: number; pct: number } {
  const minutes = Math.max(0, workedMin - loggedWorkMin);
  const pct = workedMin > 0 ? (minutes / workedMin) * 100 : 0;
  return { minutes, pct };
}

/**
 * Segments cannot overlap. Returns the first existing segment that would
 * overlap the candidate, or null. A null end means "still open" (open-ended).
 */
export function findOverlap<T extends { start: Date; end: Date | null }>(
  existing: T[],
  candidate: { start: Date; end: Date | null },
): T | null {
  const cs = candidate.start.getTime();
  const ce = candidate.end ? candidate.end.getTime() : Infinity;
  for (const seg of existing) {
    const s = seg.start.getTime();
    const e = seg.end ? seg.end.getTime() : Infinity;
    if (cs < e && s < ce) return seg;
  }
  return null;
}
