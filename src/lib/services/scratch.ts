/**
 * Scratchpad: rough notes, sketches, calculator tapes and graphs, filed under the logical day they were made.
 */
import { getPool, one, q, UserError, type Db } from "../db";
import {
  emptyData, MAX_DATA_BYTES, normalizeData, SCRATCH_KINDS, type ScratchData, type ScratchKind,
} from "../scratch";
import type { DateStr } from "../time";

export interface ScratchRow {
  id: number;
  date: DateStr;
  kind: ScratchKind;
  title: string;
  data: ScratchData;
  created_at: Date;
  updated_at: Date;
}

// Migrations run on cold start; this guards the first request after a deploy that skipped them.
let ensured: Promise<void> | null = null;
function ensureTables(db: Db = getPool()): Promise<void> {
  ensured ??= (async () => {
    await db.query(`
      create table if not exists scratch_items (
        id serial primary key,
        date date not null,
        kind text not null check (kind in ('note','sketch','calc','graph')),
        title text not null default '' check (length(title) <= 120),
        data jsonb not null default '{}',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists scratch_items_date_idx on scratch_items (date);`);
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

function checkKind(kind: string): ScratchKind {
  if (!SCRATCH_KINDS.includes(kind as ScratchKind)) throw new UserError("Unknown scratchpad item.");
  return kind as ScratchKind;
}

function cleanData(kind: ScratchKind, raw: unknown): ScratchData {
  const data = normalizeData(kind, raw);
  if (!data) throw new UserError("That could not be saved.");
  if (JSON.stringify(data).length > MAX_DATA_BYTES) {
    throw new UserError("This is too big to save. Start a new sketch for the rest.");
  }
  return data;
}

const cleanTitle = (t: unknown) => (typeof t === "string" ? t.trim().slice(0, 120) : "");

export async function listItems(date: DateStr, db: Db = getPool()): Promise<ScratchRow[]> {
  await ensureTables(db);
  return q<ScratchRow>("select * from scratch_items where date = $1 order by created_at desc, id desc", [date], db);
}

/** How many items each day in the range has, for the day strip. */
export async function itemCountsInRange(from: DateStr, to: DateStr, db: Db = getPool()): Promise<Map<DateStr, Record<ScratchKind, number>>> {
  await ensureTables(db);
  const rows = await q<{ date: DateStr; kind: ScratchKind; n: number }>(
    "select date, kind, count(*)::int as n from scratch_items where date between $1 and $2 group by date, kind",
    [from, to],
    db,
  );
  const out = new Map<DateStr, Record<ScratchKind, number>>();
  for (const r of rows) {
    const m = out.get(r.date) ?? { note: 0, sketch: 0, calc: 0, graph: 0 };
    m[r.kind] = r.n;
    out.set(r.date, m);
  }
  return out;
}

export async function createItem(date: DateStr, kind: string, title?: unknown, data?: unknown, db: Db = getPool()): Promise<ScratchRow> {
  const k = checkKind(kind);
  await ensureTables(db);
  return (await one<ScratchRow>(
    "insert into scratch_items (date, kind, title, data) values ($1, $2, $3, $4) returning *",
    [date, k, cleanTitle(title), JSON.stringify(data === undefined ? emptyData(k) : cleanData(k, data))],
    db,
  ))!;
}

export async function updateItem(id: number, patch: { title?: unknown; data?: unknown }, db: Db = getPool()): Promise<ScratchRow> {
  await ensureTables(db);
  const cur = await one<ScratchRow>("select * from scratch_items where id = $1", [id], db);
  if (!cur) throw new UserError("That scratchpad item no longer exists.");
  const title = patch.title === undefined ? cur.title : cleanTitle(patch.title);
  const data = patch.data === undefined ? cur.data : cleanData(cur.kind, patch.data);
  return (await one<ScratchRow>(
    "update scratch_items set title = $2, data = $3, updated_at = now() where id = $1 returning *",
    [id, title, JSON.stringify(data)],
    db,
  ))!;
}

export async function deleteItem(id: number, db: Db = getPool()): Promise<void> {
  await ensureTables(db);
  await q("delete from scratch_items where id = $1", [id], db);
}

/** Copies an item (from any day) onto `date`, e.g. to carry yesterday's working into today. */
export async function copyItem(id: number, date: DateStr, db: Db = getPool()): Promise<ScratchRow> {
  await ensureTables(db);
  const cur = await one<ScratchRow>("select * from scratch_items where id = $1", [id], db);
  if (!cur) throw new UserError("That scratchpad item no longer exists.");
  return createItem(date, cur.kind, cur.title, cur.data, db);
}
