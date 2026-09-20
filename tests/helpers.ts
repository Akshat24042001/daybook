import { getPool, q } from "@/lib/db";
import { makeCtx, type Ctx } from "@/lib/settings";
import { parseQuickAdd } from "@/lib/parser";
import { createFromParsed } from "@/lib/services/tasks";

export const TZ = "Asia/Kolkata";

/** IST wall-clock "2026-09-19 14:00" -> instant */
export const ist = (s: string): Date => new Date(new Date(s.replace(" ", "T") + ":00Z").getTime() - 330 * 60_000);

export async function resetDb(): Promise<void> {
  await q(`truncate tasks, projects, people, day_entries, time_logs, work_segments, days,
           exercise_types, exercise_logs, notifications, pending_adds, tg_updates restart identity cascade`);
  await q("delete from settings");
  await q("insert into settings (id) values (1)");
}

export function ctxAt(istTime: string): Promise<Ctx> {
  return makeCtx(ist(istTime));
}

/** Runs a quick-add line exactly the way the web and the bot do. */
export async function add(ctx: Ctx, line: string, opts: Parameters<typeof createFromParsed>[2] = {}) {
  const parsed = parseQuickAdd(line, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin });
  return createFromParsed(ctx, parsed, opts);
}

export async function seedExercises(): Promise<void> {
  await q(`insert into exercise_types (name, default_amount, unit, sort) values
    ('Squats', 20, 'reps', 1), ('Push-ups', 15, 'reps', 2), ('Plank', 30, 'seconds', 3)`);
}

export { getPool };
