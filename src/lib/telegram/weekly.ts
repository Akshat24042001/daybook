import { q } from "../db";
import type { Ctx } from "../settings";
import { addDays, dateRange, fmtDateShort, fmtDuration, weekStart, weekdayName } from "../time";
import { planningStreak, wasPlannedInTime } from "../services/days";
import { computeStats } from "../services/stats";
import { esc } from "./api";
import { inline, urlBtn, type Msg } from "./ui";

/** Sunday review (PRD section 12). Facts, not praise. Covers Monday to today. */
export async function weeklyReviewMessage(ctx: Ctx): Promise<Msg> {
  const from = weekStart(ctx.today);
  const to = ctx.today;
  const stats = await computeStats(ctx, { from, to });
  const totalWorked = stats.series.reduce((a, d) => a + d.hours, 0);
  const scored = stats.series.filter((d) => d.score !== null);
  const best = [...scored].sort((a, b) => b.score! - a.score!)[0];
  const worst = [...scored].sort((a, b) => a.score! - b.score!)[0];
  const top = stats.hoursByProject[0];

  const targetsMet = await q<{ n: number }>(
    "select count(*)::int as n from tasks where type = 'target' and state = 'done' and closed_at >= $1",
    [new Date(new Date(`${from}T00:00:00Z`).getTime() - 24 * 3600_000)],
  );
  const days = await q<{ date: string; planned_at: Date | null }>("select date, planned_at from days where date between $1 and $2", [from, to]);
  const plannedDays = dateRange(from, to).filter((d) => wasPlannedInTime(ctx, d, days.find((x) => x.date === d)?.planned_at ?? null)).length;

  const sets = stats.health.setsPerDay.reduce((a, d) => a + d.sets, 0);
  const steps = stats.health.stepsPerDay.reduce((a, d) => a + (d.steps ?? 0), 0);

  const lines: string[] = [`🗓 <b>Weekly review · ${fmtDateShort(from)} to ${fmtDateShort(to)}</b>`];
  lines.push(`Hours worked: ${fmtDuration(totalWorked * 60)} · average score: ${stats.summary.current.avgScore !== null ? stats.summary.current.avgScore.toFixed(1) : "none entered"}`);
  if (best && worst) {
    lines.push(`Best day: ${weekdayName(best.date)} (${best.score}) · worst day: ${weekdayName(worst.date)} (${worst.score})`);
  }
  if (top) lines.push(`Top project: ${esc(top.name)} with ${fmtDuration(top.minutes)}`);
  lines.push(`Targets met this week: ${targetsMet[0].n}`);
  if (stats.rotting.length) {
    lines.push(`Rotting: ${stats.rotting.slice(0, 3).map((r) => `${esc(r.title)} (${r.carry}×)`).join(", ")}`);
  }
  const prevDone = stats.summary.previous.tasksDone;
  lines.push(`Tasks done: ${stats.summary.current.tasksDone} (previous week ${prevDone})`);
  lines.push(`Exercise: ${sets} sets · steps: ${steps.toLocaleString("en-US")}`);

  // One plain observation
  let obs: string;
  if (stats.summary.current.unaccountedPct !== null && stats.summary.current.unaccountedPct >= 20) {
    obs = `Unaccounted time was ${Math.round(stats.summary.current.unaccountedPct)}% of worked hours. The target is below 20%.`;
  } else if (plannedDays < 5) {
    obs = `You planned ahead on ${plannedDays} of ${dateRange(from, to).length} days.`;
  } else if (stats.summary.current.mustDoHitRate !== null) {
    obs = `Must-do hit rate was ${Math.round(stats.summary.current.mustDoHitRate * 100)}%.`;
  } else {
    obs = `Planning streak: ${await planningStreak(ctx)} days.`;
  }
  lines.push(`\n${obs}`);

  return {
    text: lines.join("\n"),
    markup: inline([[urlBtn("Open Stats", "/stats"), urlBtn("Set week targets", "/goals")]]),
  };
}

export { addDays };
