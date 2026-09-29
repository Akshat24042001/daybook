/**
 * Scratchpad: rough notes, sketches, calculator tapes and graphs, filed under the logical day they were made.
 */
import { getPool, one, q, UserError, type Db } from "../db";
import {
  emptyData, MAX_DATA_BYTES, normalizeData, SCRATCH_KINDS, type FileData, type ScratchData, type ScratchKind,
} from "../scratch";
import { fileStore, MAX_FILE_BYTES, newPath, storageConfigured } from "../storage";
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
        kind text not null check (kind in ('note','sketch','calc','graph','checklist','table','link','code','voice','file')),
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
    const m = out.get(r.date) ?? (Object.fromEntries(SCRATCH_KINDS.map((k) => [k, 0])) as Record<ScratchKind, number>);
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
  let data = patch.data === undefined ? cur.data : cleanData(cur.kind, patch.data);
  if (isFile(cur.kind) && patch.data !== undefined) {
    // where the file is and what it is are set by the upload, never by an edit; only the extras can change
    const was = cur.data as FileData;
    const next = data as FileData;
    data = { ...was, width: next.width ?? was.width, height: next.height ?? was.height, duration: next.duration ?? was.duration, transcript: next.transcript ?? was.transcript };
  }
  return (await one<ScratchRow>(
    "update scratch_items set title = $2, data = $3, updated_at = now() where id = $1 returning *",
    [id, title, JSON.stringify(data)],
    db,
  ))!;
}

export async function deleteItem(id: number, db: Db = getPool()): Promise<void> {
  await ensureTables(db);
  const row = await one<ScratchRow>("delete from scratch_items where id = $1 returning *", [id], db);
  const path = row && isFile(row.kind) ? (row.data as FileData).path : "";
  // the stored file goes too, unless a copy on another day still points at it
  if (path && storageConfigured()) {
    const still = await one("select 1 from scratch_items where data->>'path' = $1", [path], db);
    if (!still) await fileStore().remove([path]).catch((e) => console.error("[scratch] file delete failed:", (e as Error).message));
  }
}

/** Copies an item (from any day) onto `date`, e.g. to carry yesterday's working into today. */
export async function copyItem(id: number, date: DateStr, db: Db = getPool()): Promise<ScratchRow> {
  await ensureTables(db);
  const cur = await one<ScratchRow>("select * from scratch_items where id = $1", [id], db);
  if (!cur) throw new UserError("That scratchpad item no longer exists.");
  if (isFile(cur.kind)) {
    const f = cur.data as FileData;
    if (f.status !== "ready") throw new UserError("That file has not finished uploading.");
    const path = newPath(date, f.name);
    await fileStore().copy(f.path, path);
    return insertRaw(date, cur.kind, cur.title, { ...f, path }, db);
  }
  return createItem(date, cur.kind, cur.title, cur.data, db);
}

// ---------------------------------------------------------------- files

const isFile = (k: ScratchKind) => k === "file" || k === "voice";

async function insertRaw(date: DateStr, kind: ScratchKind, title: string, data: ScratchData, db: Db): Promise<ScratchRow> {
  return (await one<ScratchRow>(
    "insert into scratch_items (date, kind, title, data) values ($1, $2, $3, $4) returning *",
    [date, kind, cleanTitle(title), JSON.stringify(data)],
    db,
  ))!;
}

/**
 * Step 1 of an upload: the item is created as "uploading" with a server-chosen storage path, and the browser gets a
 * short-lived link to put the file straight into storage.
 */
export async function startUpload(
  date: DateStr,
  kind: "file" | "voice",
  file: { name: string; mime: string; size: number },
  db: Db = getPool(),
): Promise<{ row: ScratchRow; uploadUrl: string }> {
  if (!storageConfigured()) throw new UserError("File storage is not set up yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  const name = (file.name || (kind === "voice" ? "voice-memo.webm" : "file")).slice(0, 200);
  if (!(file.size > 0)) throw new UserError(`"${name}" is empty.`);
  if (file.size > MAX_FILE_BYTES) throw new UserError(`"${name}" is ${Math.round(file.size / 1048576)} MB. The limit is ${MAX_FILE_BYTES / 1048576} MB per file.`);
  await ensureTables(db);
  const path = newPath(date, name);
  const { url } = await fileStore().signUpload(path);
  const data: FileData = { path, name, mime: (file.mime || "application/octet-stream").slice(0, 100), size: file.size, status: "uploading" };
  const row = await insertRaw(date, kind, kind === "voice" ? "" : name.replace(/\.[^.]+$/, ""), data, db);
  return { row, uploadUrl: url };
}

/** Step 2: once the browser says the upload is done, check the file is really there and mark the item ready. */
export async function finishUpload(id: number, extra: { width?: number; height?: number; duration?: number; transcript?: string } = {}, db: Db = getPool()): Promise<ScratchRow> {
  const cur = await one<ScratchRow>("select * from scratch_items where id = $1", [id], db);
  if (!cur || !isFile(cur.kind)) throw new UserError("That upload no longer exists.");
  const f = cur.data as FileData;
  const stored = await fileStore().info(f.path);
  if (!stored) throw new UserError("The file did not arrive. Try uploading it again.");
  const clean = normalizeData(cur.kind, { ...f, ...extra, size: stored.size || f.size, mime: stored.mime || f.mime, status: "ready" }) as FileData;
  return (await one<ScratchRow>(
    "update scratch_items set data = $2, updated_at = now() where id = $1 returning *",
    [id, JSON.stringify({ ...clean, path: f.path })],
    db,
  ))!;
}

/** Short-lived links for the files among these rows (one storage call for all of them). */
export async function mediaUrls(rows: ScratchRow[], expiresSec = 3600): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const files = rows.filter((r) => isFile(r.kind) && (r.data as FileData).status === "ready" && (r.data as FileData).path);
  if (!files.length || !storageConfigured()) return out;
  try {
    const urls = await fileStore().signDownloads(files.map((r) => (r.data as FileData).path), expiresSec);
    for (const r of files) {
      const u = urls.get((r.data as FileData).path);
      if (u) out.set(r.id, u);
    }
  } catch (e) {
    console.error("[scratch] could not sign file links:", (e as Error).message);
  }
  return out;
}

/** Items still "uploading" after a day were abandoned (tab closed mid-upload): remove them and anything that landed. */
export async function sweepAbandonedUploads(db: Db = getPool()): Promise<number> {
  const rows = await q<ScratchRow>(
    "delete from scratch_items where kind in ('file','voice') and data->>'status' = 'uploading' and created_at < now() - interval '1 day' returning *",
    [],
    db,
  );
  const paths = rows.map((r) => (r.data as FileData).path).filter(Boolean);
  if (paths.length && storageConfigured()) await fileStore().remove(paths).catch(() => undefined);
  return rows.length;
}
