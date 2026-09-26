import { one, q, tx, UserError, type Db, getPool } from "../db";
import { ACTIVITIES } from "../activity";
import { findOverlap, isWorkKind, unaccounted, workedMinutes, type Segment, type SegmentKind } from "../hours";
import { type Ctx, windowOf } from "../settings";
import { type DateStr, fmtHM, logicalDate } from "../time";

const MINUTE_MS = 60_000;

export interface SegmentRow {
  id: number;
  date: DateStr;
  kind: SegmentKind;
  start_at: Date;
  end_at: Date | null;
}

export type StateKind = SegmentKind | "off";

export const KIND_LABEL: Record<StateKind, string> = {
  ...(Object.fromEntries(ACTIVITIES.map((a) => [a.kind, a.label])) as Record<SegmentKind, string>),
  off: "Off",
};

const toSeg = (r: SegmentRow): Segment => ({ kind: r.kind, start: r.start_at, end: r.end_at });

export async function openSegment(db: Db = getPool()): Promise<SegmentRow | null> {
  return one<SegmentRow>("select * from work_segments where end_at is null order by start_at desc limit 1", [], db);
}

/** Segments that touch the logical day (a segment may run past the boundary into the next day). */
export async function segmentsForDate(ctx: Ctx, date: DateStr, db: Db = getPool()): Promise<SegmentRow[]> {
  const w = windowOf(ctx, date);
  return q<SegmentRow>(
    `select * from work_segments where start_at < $2 and (end_at is null or end_at > $1) order by start_at`,
    [w.start, w.end],
    db,
  );
}

export async function workedForDate(ctx: Ctx, date: DateStr, db: Db = getPool()): Promise<number> {
  const segs = await segmentsForDate(ctx, date, db);
  return workedMinutes(segs.map(toSeg), windowOf(ctx, date), ctx.now);
}

export async function loggedWorkMinutes(date: DateStr, db: Db = getPool()): Promise<number> {
  const row = await one<{ m: number }>(
    `select coalesce(sum(l.minutes), 0)::int as m
     from time_logs l join tasks t on t.id = l.task_id
     where l.date = $1 and not t.is_personal`,
    [date],
    db,
  );
  return row!.m;
}

export async function dayTimeSummary(ctx: Ctx, date: DateStr, db: Db = getPool()) {
  const worked = await workedForDate(ctx, date, db);
  const logged = await loggedWorkMinutes(date, db);
  return { worked, logged, ...unaccounted(worked, logged) };
}

async function upsertDayClosed(date: DateStr, closedAt: Date | null, db: Db) {
  await db.query(
    `insert into days (date, closed_at) values ($1, $2)
     on conflict (date) do update set closed_at = excluded.closed_at`,
    [date, closedAt],
  );
}

export interface SwitchResult {
  changed: boolean;
  kind: StateKind;
  since: Date;
  workedMin: number;
  date: DateStr;
}

/**
 * Tapping a state closes the current segment and opens a new one (PRD 8).
 * "off" (Day end) closes the current segment and closes the day.
 */
export async function switchState(ctx: Ctx, kind: StateKind): Promise<SwitchResult> {
  return tx(async (db) => {
    const open = await one<SegmentRow>(
      "select * from work_segments where end_at is null order by start_at desc limit 1 for update",
      [],
      db,
    );
    const date = logicalDate(ctx.now, ctx.tz, ctx.boundaryMin);

    if (open && open.kind === kind) {
      return { changed: false, kind, since: open.start_at, workedMin: await workedForDate(ctx, date, db), date };
    }
    if (open) {
      if (ctx.now.getTime() <= open.start_at.getTime()) {
        await db.query("delete from work_segments where id = $1", [open.id]);
      } else {
        await db.query("update work_segments set end_at = $2 where id = $1", [open.id, ctx.now]);
      }
    }
    if (kind === "off") {
      await upsertDayClosed(date, ctx.now, db);
      return { changed: !!open, kind, since: ctx.now, workedMin: await workedForDate(ctx, date, db), date };
    }
    await db.query(
      "insert into work_segments (date, kind, start_at) values ($1, $2, $3)",
      [date, kind, ctx.now],
    );
    // starting work again reopens an ended day; a break, meal or errand after Day end does not
    if (isWorkKind(kind)) await upsertDayClosed(date, null, db);
    return { changed: true, kind, since: ctx.now, workedMin: await workedForDate(ctx, date, db), date };
  });
}

/** Current state for the header chip: open segment kind, or "off". */
export async function currentState(db: Db = getPool()): Promise<{ kind: StateKind; since: Date | null }> {
  const open = await openSegment(db);
  return open ? { kind: open.kind, since: open.start_at } : { kind: "off", since: null };
}

export interface SegmentInput {
  kind: SegmentKind;
  start: Date;
  end: Date | null;
}

/**
 * Validates a segment against its neighbours and returns it, possibly nudged.
 * Taps are stored to the second, but forms work in minutes: "15:43" typed next to a segment that ended at 15:43:27
 * is meant to touch it, not overlap it. So a boundary that lands inside a neighbour by less than a minute snaps to
 * the neighbour's exact edge. Anything bigger is a real overlap and names the segment in the way.
 */
async function fitToNeighbours(ctx: Ctx, input: SegmentInput, ignoreId: number | null, db: Db): Promise<SegmentInput> {
  if (input.end && input.end.getTime() <= input.start.getTime()) {
    throw new UserError("The end time must be after the start time.");
  }
  const around = await q<SegmentRow>(
    `select * from work_segments
     where ($1::int is null or id <> $1)
       and start_at < coalesce($3::timestamptz, 'infinity') and (end_at is null or end_at > $2)`,
    [ignoreId, input.start, input.end],
    db,
  );
  const fitted: SegmentInput = { ...input };
  for (const r of around) {
    const s = r.start_at.getTime();
    const e = r.end_at ? r.end_at.getTime() : Infinity;
    // neighbour ends a few seconds after our start (same minute): start where it ends
    if (s < fitted.start.getTime() && e > fitted.start.getTime() && e - fitted.start.getTime() < MINUTE_MS) {
      fitted.start = new Date(e);
    }
    // neighbour starts a few seconds before our end (same minute): end where it starts
    if (fitted.end && s < fitted.end.getTime() && s > fitted.start.getTime() && fitted.end.getTime() - s < MINUTE_MS) {
      fitted.end = new Date(s);
    }
  }
  if (fitted.end && fitted.end.getTime() <= fitted.start.getTime()) {
    throw new UserError("The end time must be after the start time.");
  }
  const hit = findOverlap(around.map(toSeg), { start: fitted.start, end: fitted.end });
  if (hit) {
    const other = around.find((r) => r.start_at.getTime() === hit.start.getTime())!;
    const span = `${fmtHM(other.start_at, ctx.tz)}–${other.end_at ? fmtHM(other.end_at, ctx.tz) : "now"}`;
    throw new UserError(
      `That overlaps ${KIND_LABEL[other.kind]} ${span}. Shorten or move that segment first, then save this one.`,
    );
  }
  return fitted;
}

export async function createSegment(ctx: Ctx, raw: SegmentInput): Promise<SegmentRow> {
  return tx(async (db) => {
    const input = await fitToNeighbours(ctx, raw, null, db);
    const row = await one<SegmentRow>(
      "insert into work_segments (date, kind, start_at, end_at) values ($1,$2,$3,$4) returning *",
      [logicalDate(input.start, ctx.tz, ctx.boundaryMin), input.kind, input.start, input.end],
      db,
    );
    return row!;
  });
}

/** Saves several segments atomically (manual time entry): all of them, or none if any overlaps. */
export async function createSegments(ctx: Ctx, inputs: SegmentInput[]): Promise<SegmentRow[]> {
  if (inputs.length === 0) throw new UserError("Nothing to save.");
  return tx(async (db) => {
    const rows: SegmentRow[] = [];
    for (const raw of inputs) {
      const input = await fitToNeighbours(ctx, raw, null, db);
      const row = await one<SegmentRow>(
        "insert into work_segments (date, kind, start_at, end_at) values ($1,$2,$3,$4) returning *",
        [logicalDate(input.start, ctx.tz, ctx.boundaryMin), input.kind, input.start, input.end],
        db,
      );
      rows.push(row!);
    }
    return rows;
  });
}

export async function updateSegment(ctx: Ctx, id: number, raw: SegmentInput): Promise<SegmentRow> {
  return tx(async (db) => {
    const input = await fitToNeighbours(ctx, raw, id, db);
    const row = await one<SegmentRow>(
      "update work_segments set date = $2, kind = $3, start_at = $4, end_at = $5 where id = $1 returning *",
      [id, logicalDate(input.start, ctx.tz, ctx.boundaryMin), input.kind, input.start, input.end],
      db,
    );
    if (!row) throw new UserError("Segment not found.");
    return row;
  });
}

export async function deleteSegment(id: number): Promise<void> {
  await q("delete from work_segments where id = $1", [id]);
}

/**
 * Forgotten close (PRD 8): end the open segment `minutesAgo` minutes before now
 * (never before it started) and close the day.
 */
export async function endOpenSegment(ctx: Ctx, minutesAgo: number): Promise<{ ended: boolean; endedAt: Date | null; workedMin: number; date: DateStr }> {
  return tx(async (db) => {
    const open = await one<SegmentRow>(
      "select * from work_segments where end_at is null order by start_at desc limit 1 for update",
      [],
      db,
    );
    if (!open) {
      const date = logicalDate(ctx.now, ctx.tz, ctx.boundaryMin);
      return { ended: false, endedAt: null, workedMin: await workedForDate(ctx, date, db), date };
    }
    let endAt = new Date(ctx.now.getTime() - minutesAgo * 60_000);
    if (endAt.getTime() <= open.start_at.getTime()) endAt = new Date(open.start_at.getTime() + 60_000);
    if (endAt.getTime() > ctx.now.getTime()) endAt = ctx.now;
    await db.query("update work_segments set end_at = $2 where id = $1", [open.id, endAt]);
    const date = open.date;
    await upsertDayClosed(date, ctx.now, db);
    return { ended: true, endedAt: endAt, workedMin: await workedForDate(ctx, date, db), date };
  });
}
