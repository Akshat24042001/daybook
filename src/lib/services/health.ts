import { one, q, UserError, type Db, getPool } from "../db";
import { type Ctx, isWorkingDay } from "../settings";
import { type DateStr, addDays, atLogical, dateRange, logicalDate, parseHM } from "../time";

export interface ExerciseType {
  id: number;
  name: string;
  default_amount: number;
  unit: "reps" | "seconds";
  active: boolean;
  sort: number;
}

export interface ExerciseLog {
  id: number;
  date: DateStr;
  slot_at: Date;
  exercise_type_id: number | null;
  amount: number | null;
  status: "done" | "skipped" | "missed";
  telegram_message_id: number | null;
}

export async function listExerciseTypes(activeOnly = false, db: Db = getPool()): Promise<ExerciseType[]> {
  return q<ExerciseType>(
    `select * from exercise_types ${activeOnly ? "where active" : ""} order by sort, id`,
    [],
    db,
  );
}

export async function getExerciseType(id: number, db: Db = getPool()): Promise<ExerciseType | null> {
  return one<ExerciseType>("select * from exercise_types where id = $1", [id], db);
}

export interface ExerciseTypeInput {
  name: string;
  default_amount: number;
  unit: "reps" | "seconds";
}

function validateType(input: ExerciseTypeInput): ExerciseTypeInput {
  const name = input.name.trim();
  if (!name) throw new UserError("Exercise name is required.");
  if (!Number.isInteger(input.default_amount) || input.default_amount < 1 || input.default_amount > 10000) {
    throw new UserError("Default amount must be a whole number of at least 1.");
  }
  if (input.unit !== "reps" && input.unit !== "seconds") throw new UserError("Unit must be reps or seconds.");
  return { name, default_amount: input.default_amount, unit: input.unit };
}

export async function createExerciseType(input: ExerciseTypeInput): Promise<ExerciseType> {
  const v = validateType(input);
  const row = await one<ExerciseType>(
    `insert into exercise_types (name, default_amount, unit, sort)
     values ($1, $2, $3, coalesce((select max(sort) from exercise_types), 0) + 1) returning *`,
    [v.name, v.default_amount, v.unit],
  );
  return row!;
}

export async function updateExerciseType(id: number, input: ExerciseTypeInput & { active?: boolean }): Promise<void> {
  const v = validateType(input);
  await q(
    "update exercise_types set name = $2, default_amount = $3, unit = $4, active = coalesce($5, active) where id = $1",
    [id, v.name, v.default_amount, v.unit, input.active ?? null],
  );
}

/** Slot instants for a logical day, from the exercise window and interval in settings.
 *  Slots that fall within the lunch break window (inclusive start, exclusive end) are skipped. */
export function exerciseSlots(ctx: Ctx, date: DateStr): Date[] {
  const start = parseHM(ctx.s.exercise_start);
  const end = parseHM(ctx.s.exercise_end);
  const step = ctx.s.exercise_interval_min;
  const lunchStart = ctx.s.lunch_start ? parseHM(ctx.s.lunch_start) : null;
  const lunchEnd = ctx.s.lunch_end ? parseHM(ctx.s.lunch_end) : null;
  const out: Date[] = [];
  for (let m = start; m <= end; m += step) {
    if (lunchStart !== null && lunchEnd !== null && m >= lunchStart && m < lunchEnd) continue;
    out.push(atLogical(date, m, ctx.tz, ctx.boundaryMin));
  }
  return out;
}

export function exerciseActiveOn(ctx: Ctx, date: DateStr): boolean {
  return !ctx.s.exercise_paused && isWorkingDay(ctx, date);
}

export async function logsForDate(date: DateStr, db: Db = getPool()): Promise<ExerciseLog[]> {
  return q<ExerciseLog>("select * from exercise_logs where date = $1 order by slot_at", [date], db);
}

export async function logExercise(
  ctx: Ctx,
  slotAt: Date,
  status: "done" | "skipped" | "missed",
  typeId: number | null,
  amount: number | null,
  messageId: number | null = null,
  db: Db = getPool(),
): Promise<ExerciseLog> {
  if (status === "done" && (typeId === null || amount === null || amount < 1)) {
    throw new UserError("Pick an exercise and an amount.");
  }
  const date = logicalDate(slotAt, ctx.tz, ctx.boundaryMin);

  // Step 1: update an existing row that matches this slot + type (handles re-logging).
  // IS NOT DISTINCT FROM treats NULL = NULL correctly.
  const upd = await q<ExerciseLog>(
    `update exercise_logs
     set amount = $3, status = $4,
         telegram_message_id = coalesce($5, telegram_message_id)
     where slot_at = $1
       and exercise_type_id is not distinct from $2
       and (status <> 'done' or $4 = 'done')
     returning *`,
    [slotAt, typeId, amount, status, messageId],
    db,
  );
  if (upd.length > 0) return upd[0];

  // Step 2: no existing row matched; insert a new one.
  // ON CONFLICT DO NOTHING avoids errors on either schema (old unique(slot_at) or
  // new unique(slot_at, exercise_type_id)) when a different conflict fires.
  const ins = await q<ExerciseLog>(
    `insert into exercise_logs (date, slot_at, exercise_type_id, amount, status, telegram_message_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict do nothing
     returning *`,
    [date, slotAt, typeId, amount, status, messageId],
    db,
  );
  if (ins.length > 0) return ins[0];

  // Row already exists but the WHERE clause blocked the update (e.g. can't downgrade 'done').
  return (await one<ExerciseLog>(
    `select * from exercise_logs where slot_at = $1 and exercise_type_id is not distinct from $2 limit 1`,
    [slotAt, typeId],
    db,
  ))!;
}

export async function exerciseCounts(date: DateStr, db: Db = getPool()) {
  const rows = await q<{ status: string; n: number }>(
    "select status, count(*)::int as n from exercise_logs where date = $1 group by status",
    [date],
    db,
  );
  const c = { done: 0, skipped: 0, missed: 0 };
  for (const r of rows) c[r.status as keyof typeof c] = r.n;
  return c;
}

export interface HealthWeekDay {
  date: DateStr;
  sets: number;
  steps: number | null;
  sleepMin: number | null;
}

/**
 * The last `days` days (oldest first), today's totals per exercise, and the active-day streak.
 * An active day has at least one exercise set or reached the step goal. Today only extends the streak once it is
 * active, so the streak never "breaks" in the morning before you have moved.
 */
export async function healthOverview(today: DateStr, stepGoal: number, days = 7, db: Db = getPool()) {
  const from = addDays(today, -(days - 1));
  const streakFrom = addDays(today, -365);
  const [sets, dayRows, totals, activeRows] = await Promise.all([
    q<{ date: DateStr; n: number }>(
      "select date, count(*)::int as n from exercise_logs where status = 'done' and date between $1 and $2 group by date",
      [from, today],
      db,
    ),
    q<{ date: DateStr; steps: number | null; sleep_minutes: number | null }>(
      "select date, steps, sleep_minutes from days where date between $1 and $2",
      [from, today],
      db,
    ).catch(() => q<{ date: DateStr; steps: number | null; sleep_minutes: number | null }>(
      "select date, steps, null::int as sleep_minutes from days where date between $1 and $2",
      [from, today],
      db,
    )),
    q<{ name: string; unit: "reps" | "seconds"; amount: number; sets: number }>(
      `select t.name, t.unit, coalesce(sum(l.amount), 0)::int as amount, count(*)::int as sets
       from exercise_logs l join exercise_types t on t.id = l.exercise_type_id
       where l.date = $1 and l.status = 'done' group by t.name, t.unit order by 4 desc`,
      [today],
      db,
    ),
    q<{ date: DateStr }>(
      `select date from exercise_logs where status = 'done' and date between $1 and $2
       union select date from days where steps >= $3 and date between $1 and $2`,
      [streakFrom, today, stepGoal],
      db,
    ),
  ]);
  const setMap = new Map(sets.map((r) => [r.date, r.n]));
  const dayMap = new Map(dayRows.map((r) => [r.date, r]));
  const week: HealthWeekDay[] = dateRange(from, today).map((d) => ({
    date: d,
    sets: setMap.get(d) ?? 0,
    steps: dayMap.get(d)?.steps ?? null,
    sleepMin: dayMap.get(d)?.sleep_minutes ?? null,
  }));
  const active = new Set(activeRows.map((r) => r.date));
  let streak = 0;
  let d = active.has(today) ? today : addDays(today, -1);
  while (active.has(d)) {
    streak++;
    d = addDays(d, -1);
  }
  return { week, totals, streak, activeToday: active.has(today) };
}

/** The exercise and amount to pre-select: whatever was logged last (PRD 9.3). */
export async function lastExercise(db: Db = getPool()): Promise<{ type: ExerciseType; amount: number } | null> {
  const row = await one<{ exercise_type_id: number; amount: number }>(
    `select l.exercise_type_id, l.amount from exercise_logs l
     join exercise_types t on t.id = l.exercise_type_id and t.active
     where l.status = 'done' order by l.slot_at desc limit 1`,
    [],
    db,
  );
  if (row) {
    const type = await getExerciseType(row.exercise_type_id, db);
    if (type) return { type, amount: row.amount };
  }
  const first = (await listExerciseTypes(true, db))[0];
  return first ? { type: first, amount: first.default_amount } : null;
}

export type SlotCell = {
  slot: Date;
  status: "done" | "skipped" | "missed" | "pending" | "upcoming";
  typeName: string | null;
  unit: "reps" | "seconds" | null;
  amount: number | null;
  extraNames?: string[]; // additional exercise names logged at the same slot
};

export async function exerciseGrid(ctx: Ctx, date: DateStr): Promise<SlotCell[]> {
  const slots = exerciseSlots(ctx, date);
  const logs = await q<ExerciseLog & { name: string | null; unit: "reps" | "seconds" | null }>(
    `select l.*, t.name, t.unit from exercise_logs l
     left join exercise_types t on t.id = l.exercise_type_id where l.date = $1 order by l.slot_at, l.id`,
    [date],
  );
  // Group all logs by slot time; a slot may have multiple "done" entries (one per exercise type)
  const byTime = new Map<number, typeof logs>();
  for (const l of logs) {
    const t = l.slot_at.getTime();
    const existing = byTime.get(t) ?? [];
    existing.push(l);
    byTime.set(t, existing);
  }
  return slots.map((slot) => {
    const slotLogs = byTime.get(slot.getTime()) ?? [];
    const skipped = slotLogs.find((l) => l.status === "skipped");
    const done = slotLogs.filter((l) => l.status === "done");
    if (skipped && !done.length) return { slot, status: "skipped", typeName: null, unit: null, amount: null };
    if (done.length > 0) {
      // Primary: last logged; summary line shows all
      const primary = done[done.length - 1];
      const extra = done.length > 1 ? done.slice(0, -1).map((d) => d.name ?? "exercise") : [];
      return {
        slot,
        status: "done",
        typeName: primary.name,
        unit: primary.unit,
        amount: primary.amount,
        extraNames: extra,
      };
    }
    return {
      slot,
      status: slot.getTime() > ctx.now.getTime() ? "upcoming" : "pending",
      typeName: null,
      unit: null,
      amount: null,
    };
  });
}
