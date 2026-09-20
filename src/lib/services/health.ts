import { one, q, UserError, type Db, getPool } from "../db";
import { type Ctx, isWorkingDay } from "../settings";
import { type DateStr, atLogical, logicalDate, parseHM } from "../time";

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

/** Slot instants for a logical day, from the exercise window and interval in settings. */
export function exerciseSlots(ctx: Ctx, date: DateStr): Date[] {
  const start = parseHM(ctx.s.exercise_start);
  const end = parseHM(ctx.s.exercise_end);
  const step = ctx.s.exercise_interval_min;
  const out: Date[] = [];
  for (let m = start; m <= end; m += step) out.push(atLogical(date, m, ctx.tz, ctx.boundaryMin));
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
  const row = await one<ExerciseLog>(
    `insert into exercise_logs (date, slot_at, exercise_type_id, amount, status, telegram_message_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (slot_at) do update
       set exercise_type_id = excluded.exercise_type_id, amount = excluded.amount, status = excluded.status,
           telegram_message_id = coalesce(excluded.telegram_message_id, exercise_logs.telegram_message_id)
       where exercise_logs.status <> 'done' or excluded.status = 'done'
     returning *`,
    [logicalDate(slotAt, ctx.tz, ctx.boundaryMin), slotAt, typeId, amount, status, messageId],
    db,
  );
  if (!row) {
    return (await one<ExerciseLog>("select * from exercise_logs where slot_at = $1", [slotAt], db))!;
  }
  return row;
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
};

export async function exerciseGrid(ctx: Ctx, date: DateStr): Promise<SlotCell[]> {
  const slots = exerciseSlots(ctx, date);
  const logs = await q<ExerciseLog & { name: string | null; unit: "reps" | "seconds" | null }>(
    `select l.*, t.name, t.unit from exercise_logs l
     left join exercise_types t on t.id = l.exercise_type_id where l.date = $1`,
    [date],
  );
  const byTime = new Map(logs.map((l) => [l.slot_at.getTime(), l]));
  return slots.map((slot) => {
    const l = byTime.get(slot.getTime());
    if (l) return { slot, status: l.status, typeName: l.name, unit: l.unit, amount: l.amount };
    return {
      slot,
      status: slot.getTime() > ctx.now.getTime() ? "upcoming" : "pending",
      typeName: null,
      unit: null,
      amount: null,
    };
  });
}
