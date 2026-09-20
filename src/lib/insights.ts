import { isoDow, type DateStr } from "./time";

/**
 * Rule-based insights (PRD section 11): simple group comparisons over the selected range, at most 3,
 * and only when every compared group has at least MIN_DAYS days of data. Pure and unit-tested.
 */
export const MIN_DAYS = 5;

export interface DayFacts {
  date: DateStr;
  score: number | null;
  mustDoCount: number;
  workedMin: number;
  unaccountedPct: number | null;
}

export interface SlotFacts {
  /** local hour of the exercise slot, 0-23 */
  hour: number;
  /** distinct days that have a logged outcome for this hour */
  days: number;
  /** days where the slot was skipped or missed */
  notDone: number;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const WEEKDAY = ["", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

export function computeInsights(days: DayFacts[], slots: SlotFacts[]): string[] {
  const out: string[] = [];

  // 1. Score against the number of must-dos
  const scored = days.filter((d) => d.score !== null && d.mustDoCount > 0);
  const few = scored.filter((d) => d.mustDoCount <= 3);
  const many = scored.filter((d) => d.mustDoCount > 3);
  if (few.length >= MIN_DAYS && many.length >= MIN_DAYS) {
    const a = avg(few.map((d) => d.score!));
    const b = avg(many.map((d) => d.score!));
    if (Math.abs(a - b) >= 0.5) {
      out.push(`Days with 3 or fewer must-dos averaged score ${r1(a)} vs ${r1(b)} on days with more.`);
    }
  }

  // 2. Most skipped exercise slot
  const eligible = slots.filter((s) => s.days >= MIN_DAYS && s.notDone > 0);
  if (eligible.length >= 2) {
    const worst = [...eligible].sort((x, y) => y.notDone / y.days - x.notDone / x.days)[0];
    const ratio = worst.notDone / worst.days;
    if (ratio >= 0.5) {
      const h = String(worst.hour).padStart(2, "0");
      const h2 = String((worst.hour + 1) % 24).padStart(2, "0");
      out.push(`Most skipped exercise slot: ${h}:00 to ${h2}:00 (not done on ${worst.notDone} of ${worst.days} days).`);
    }
  }

  // 3. Weekday with the most unaccounted time
  const byDow = new Map<number, number[]>();
  for (const d of days) {
    if (d.workedMin <= 0 || d.unaccountedPct === null) continue;
    const k = isoDow(d.date);
    byDow.set(k, [...(byDow.get(k) ?? []), d.unaccountedPct]);
  }
  const groups = [...byDow.entries()];
  if (groups.length >= 2 && groups.every(([, v]) => v.length >= MIN_DAYS)) {
    const ranked = groups.map(([k, v]) => ({ k, mean: avg(v) })).sort((x, y) => y.mean - x.mean);
    if (ranked[0].mean - ranked[ranked.length - 1].mean >= 10) {
      out.push(`Unaccounted time is highest on ${WEEKDAY[ranked[0].k]} (${Math.round(ranked[0].mean)}% on average).`);
    }
  }

  return out.slice(0, 3);
}
