/**
 * Universal undo. See db/migrations/031_undo_journal.sql for how changes are recorded. This file starts an "action",
 * names it in plain words, lists the history, and undoes (or redoes) an action by replaying its rows backwards.
 */
import { actionStore, one, q, tx, UserError } from "./db";

export interface UndoInfo {
  id: number;
  label: string;
}

interface LogRow {
  id: number;
  tbl: string;
  op: "I" | "U" | "D";
  pk: Record<string, unknown>;
  old: Record<string, unknown> | null;
  chg: Record<string, [unknown, unknown]> | null;
  nm: string | null;
}

/** Runs `fn` as one undoable action. Everything it writes is recorded; if it writes nothing the action vanishes. */
export async function journaled<T>(source: string, fn: () => Promise<T>): Promise<{ value: T; undo: UndoInfo | null }> {
  if (actionStore.getStore()) return { value: await fn(), undo: null }; // nested: part of the outer action
  const row = await one<{ id: number }>("insert into change_actions (source) values ($1) returning id", [source]);
  const id = row!.id;
  let value: T;
  try {
    value = await actionStore.run({ id }, fn);
  } catch (e) {
    await finishAction(id).catch(() => {}); // a half-finished action can still be undone
    throw e;
  }
  return { value, undo: await finishAction(id) };
}

async function finishAction(id: number): Promise<UndoInfo | null> {
  const rows = await q<LogRow>("select id, tbl, op, pk, old, chg, nm from change_log where action_id = $1 order by id", [id]);
  if (!rows.length) {
    await q("delete from change_actions where id = $1", [id]);
    return null;
  }
  const label = await labelFor(rows);
  await q("update change_actions set label = $2 where id = $1", [id, label]);
  return { id, label };
}

// ------------------------------------------------------------------ naming an action

const NOUN: Record<string, string> = {
  tasks: "task", day_entries: "task entry", projects: "project", people: "person", contacts: "contact", contact_touches: "contact log",
  time_logs: "time log", work_segments: "time block", days: "day", exercise_types: "exercise", exercise_logs: "exercise log",
  diary_entries: "diary note", scratch_items: "scratchpad item", task_remarks: "task note", refs: "reference", reviews: "review",
  settings: "settings", sales_deals: "deal", sales_moves: "sales move", sales_companies: "company", sales_people: "sales contact",
  sales_interactions: "interaction", sales_payments: "payment", sales_docs: "document", sales_quote_revisions: "quote revision",
  sales_radar_items: "radar lead", sales_radar_sources: "radar source", sales_hunts: "hunt", sales_hunt_runs: "hunt run",
  sales_commitments: "promise", sales_stages: "stage", sales_transitions: "stage rule", sales_meetings: "meeting",
  sales_deal_people: "deal contact", sales_identities: "identity", sales_deal_events: "deal event",
};
const noun = (t: string) => NOUN[t] ?? t.replace(/^sales_/, "").replace(/_/g, " ");
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`}`;
const STATUS_WORD: Record<string, string> = { done: "done", progressed: "progressed", attempted: "attempted", skipped: "skipped", dropped: "dropped", waiting: "waiting", open: "open again" };
const FIELD_WORD: Record<string, string> = { sleep_minutes: "sleep", sleep_quality: "sleep quality", steps: "steps", score: "the day's score", instagram_minutes: "Instagram time", worked_minutes_override: "worked hours" };
const PRIORITY = ["contact_touches", "day_entries", "tasks", "days", "sales_deals", "sales_moves", "sales_radar_items", "sales_hunts", "contacts"];

/** What a row looked like after the change (an insert's values, an update's new values, a delete's old row). */
function after(r: LogRow): Record<string, unknown> {
  const v: Record<string, unknown> = { ...(r.old ?? {}) };
  for (const [k, pair] of Object.entries(r.chg ?? {})) v[k] = pair[1];
  return v;
}
const changed = (r: LogRow) => Object.keys(r.chg ?? {}).filter((k) => !["sort", "updated_at", "applied_at"].includes(k));

async function taskTitle(taskId: unknown): Promise<string | null> {
  if (!Number.isInteger(taskId)) return null;
  return (await one<{ title: string }>("select title from tasks where id = $1", [taskId]))?.title ?? null;
}

async function phrase(r: LogRow): Promise<string> {
  const v = after(r);
  const name = r.nm ? `“${r.nm.slice(0, 60)}”` : "";
  switch (r.tbl) {
    case "day_entries": {
      const title = (await taskTitle(v.task_id)) ?? "a task";
      if (r.op === "I") return `Added “${title}” to ${String(v.date ?? "a day")}`;
      if (r.op === "D") return `Removed “${title}” from the day`;
      if (r.chg?.status) return `Marked “${title}” ${STATUS_WORD[String(r.chg.status[1])] ?? String(r.chg.status[1])}`;
      if (r.chg?.must_do) return `${r.chg.must_do[1] ? "Starred" : "Unstarred"} “${title}”`;
      if (r.chg?.date) return `Moved “${title}” to ${String(r.chg.date[1])}`;
      return `Changed “${title}” for the day`;
    }
    case "tasks":
      if (r.op === "I") return `Created task ${name}`;
      if (r.op === "D") return `Deleted task ${name}`;
      if (r.chg?.state) return `Marked task ${name} ${String(r.chg.state[1])}`;
      return `Edited task ${name}`;
    case "contact_touches": {
      const c = await one<{ name: string }>("select name from contacts where id = $1", [v.contact_id]);
      return r.op === "D" ? `Removed a ${String(v.kind)} log for ${c?.name ?? "a contact"}` : `Logged ${String(v.kind ?? "touch")} with ${c?.name ?? "a contact"}`;
    }
    case "contacts":
      if (r.op === "I") return `Added contact ${name}`;
      if (r.op === "D") return `Deleted contact ${name}`;
      if (r.chg?.touch_snoozed_until) return `${r.chg.touch_snoozed_until[1] ? "Snoozed" : "Un-snoozed"} ${name}`;
      if (r.chg?.touch_every_days) return `Changed the reminder interval for ${name}`;
      return `Edited contact ${name}`;
    case "days": {
      const f = changed(r).find((k) => FIELD_WORD[k]);
      return f ? `${r.chg![f][1] === null ? "Cleared" : "Logged"} ${FIELD_WORD[f]} for ${String(v.date)}` : `Changed the day ${String(v.date)}`;
    }
    case "time_logs":
      return `${r.op === "D" ? "Removed" : "Logged"} time on “${(await taskTitle(v.task_id)) ?? "a task"}”`;
  }
  const verb = r.op === "I" ? "Added" : r.op === "D" ? "Removed" : "Changed";
  const keys = changed(r).slice(0, 3).map((k) => k.replace(/_/g, " "));
  return `${verb} ${noun(r.tbl)}${name ? ` ${name}` : ""}${r.op === "U" && keys.length ? ` (${keys.join(", ")})` : ""}`;
}

export async function labelFor(rows: LogRow[]): Promise<string> {
  const rank = (t: string) => { const i = PRIORITY.indexOf(t); return i < 0 ? 99 : i; };
  // creating or deleting a task is the headline even though its day entries changed too
  const root = rows.find((r) => r.tbl === "tasks" && r.op !== "U");
  const primary = root ?? [...rows].sort((a, b) => rank(a.tbl) - rank(b.tbl) || a.id - b.id)[0];
  const tables = new Set(rows.map((r) => r.tbl));
  const ops = new Set(rows.map((r) => r.op));
  // many rows of one kind ("Added 12 radar leads") read better than the first row's name
  if (rows.length > 3 && tables.size === 1 && ops.size === 1) {
    const verb = primary.op === "I" ? "Added" : primary.op === "D" ? "Removed" : "Changed";
    return `${verb} ${plural(rows.length, noun(primary.tbl))}`;
  }
  // the History page lists every row; the label stays one short sentence
  return (await phrase(primary)).slice(0, 200);
}

// ------------------------------------------------------------------ history

export interface ActionItem {
  id: number;
  label: string;
  source: string;
  created_at: string;
  undone_at: string | null;
  undo_of: number | null;
  changes: number;
  /** why it cannot be undone right now: the newer action that touched the same rows */
  blocked_by: string | null;
}

const BLOCKER = `
  select a2.label from change_log mine join change_log l on l.tbl = mine.tbl and l.pk = mine.pk and l.id > mine.id and l.action_id <> mine.action_id
  join change_actions a2 on a2.id = l.action_id
  where mine.action_id = a.id and a2.undone_at is null
    and not exists (select 1 from change_actions t where t.id = a2.undo_of and t.undone_by = a2.id)
  order by l.id desc limit 1`;

export async function listActions(limit = 120): Promise<ActionItem[]> {
  return q<ActionItem>(
    `select a.id, coalesce(a.label, 'Changed something') as label, a.source, a.created_at, a.undone_at, a.undo_of,
            (select count(*)::int from change_log where action_id = a.id) as changes,
            case when a.undone_at is null then (${BLOCKER}) end as blocked_by
     from change_actions a where a.created_at > now() - interval '30 days' and a.label is not null
     order by a.id desc limit $1`,
    [limit],
  );
}

export async function actionRows(id: number): Promise<{ tbl: string; noun: string; op: string; nm: string | null; chg: Record<string, [unknown, unknown]> | null }[]> {
  const rows = await q<LogRow>("select id, tbl, op, pk, old, chg, nm from change_log where action_id = $1 order by id limit 60", [id]);
  return rows.map((r) => ({ tbl: r.tbl, noun: noun(r.tbl), op: r.op, nm: r.nm, chg: r.chg }));
}

/** The newest action from the last `seconds` that has not been undone: what the Undo pill offers. */
export async function recentAction(seconds = 90): Promise<{ id: number; label: string; redo: boolean; blocked: boolean } | null> {
  const a = await one<{ id: number; label: string; undo_of: number | null; blocked_by: string | null }>(
    `select a.id, a.label, a.undo_of, (${BLOCKER}) as blocked_by from change_actions a
     where a.label is not null and a.undone_at is null and a.created_at > now() - ($1 || ' seconds')::interval
     order by a.id desc limit 1`,
    [String(seconds)],
  );
  if (!a) return null;
  return { id: a.id, label: a.label.replace(/^(Undid|Redid): /, ""), redo: a.undo_of !== null, blocked: !!a.blocked_by };
}

// ------------------------------------------------------------------ undo and redo

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => {
  if (!IDENT.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};
const pkWhere = (pk: Record<string, unknown>, start: number, alias: string) => {
  const keys = Object.keys(pk);
  return { sql: keys.map((k, i) => `${alias}${ident(k)}::text = ($${start}::jsonb ->> '${k.replace(/[^a-z0-9_]/g, "")}')`).join(" and "), n: keys.length };
};

async function restoreRow(db: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, r: LogRow): Promise<void> {
  const t = ident(r.tbl);
  if (r.op === "I") {
    const w = pkWhere(r.pk, 1, "t.");
    await db.query(`delete from ${t} t where ${w.sql}`, [JSON.stringify(r.pk)]);
  } else if (r.op === "U" && r.old) {
    const cols = Object.keys(r.old).map(ident);
    const w = pkWhere(r.pk, 2, "t.");
    await db.query(
      `update ${t} t set ${cols.map((c) => `${c} = r.${c}`).join(", ")} from jsonb_populate_record(null::${t}, $1::jsonb) r where ${w.sql}`,
      [JSON.stringify(r.old), JSON.stringify(r.pk)],
    );
  } else if (r.op === "D" && r.old) {
    const cols = Object.keys(r.old).map(ident).join(", ");
    await db.query(`insert into ${t} (${cols}) select ${cols} from jsonb_populate_record(null::${t}, $1::jsonb) on conflict do nothing`, [JSON.stringify(r.old)]);
  }
}

/** Puts back everything an action changed. Refuses when newer actions touched the same rows (undo those first). */
export async function undoAction(id: number): Promise<UndoInfo> {
  const a = await one<{ id: number; label: string | null; undone_at: string | null; undo_of: number | null }>("select * from change_actions where id = $1", [id]);
  if (!a) throw new UserError("That change is too old to undo.");
  if (a.undone_at) throw new UserError("That change was already undone.");
  const blocker = await one<{ label: string }>(`select (${BLOCKER}) as label from change_actions a where a.id = $1`, [id]);
  if (blocker?.label) throw new UserError(`Newer changes touched the same thing (“${blocker.label}”). Undo that first.`);
  const rows = await q<LogRow>("select id, tbl, op, pk, old, chg, nm from change_log where action_id = $1 order by id desc", [id]);
  if (!rows.length) throw new UserError("Nothing to undo.");
  const redo = a.undo_of !== null;
  const target = redo ? await one<{ label: string | null }>("select label from change_actions where id = $1", [a.undo_of]) : null;
  const base = (redo ? target?.label : a.label) ?? "a change";
  const label = `${redo ? "Redid" : "Undid"}: ${base.replace(/^(Undid|Redid): /, "")}`;
  const row = await one<{ id: number }>("insert into change_actions (source, label, undo_of) values ('undo', $1, $2) returning id", [label, id]);
  const undoId = row!.id;
  await actionStore.run({ id: undoId }, () =>
    tx(async (db) => {
      // Rows go back newest first. A row that needs a parent which is still missing (a cascade logged its children
      // before the parent) waits for the next pass instead of failing, so the order the database logged never matters.
      let pending = rows;
      for (let pass = 0; pending.length && pass < 8; pass++) {
        const waiting: LogRow[] = [];
        for (const r of pending) {
          await db.query("savepoint s");
          try {
            await restoreRow(db, r);
            await db.query("release savepoint s");
          } catch (e) {
            await db.query("rollback to savepoint s");
            if ((e as { code?: string }).code !== "23503") throw e;
            waiting.push(r);
          }
        }
        if (waiting.length === pending.length) break;
        pending = waiting;
      }
      if (pending.length) throw new UserError("Some of that could not be put back because something it belonged to is gone.");
      await db.query("update change_actions set undone_at = now(), undone_by = $2 where id = $1", [id, undoId]);
      // undoing an undo brings the original action back to life
      if (redo) await db.query("update change_actions set undone_at = null, undone_by = null where id = $1", [a.undo_of]);
    }),
  );
  return { id: undoId, label };
}

/** Old history is dropped after 30 days. */
export async function purgeJournal(): Promise<void> {
  await q("delete from change_actions where created_at < now() - interval '30 days'");
}
