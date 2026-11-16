/**
 * Deleted: nothing on the platform is ever thrown away. A trigger on every data table keeps a full copy of each row
 * before it is deleted (db/migrations/052_deleted_bin.sql), whoever deleted it: a button, the chat, Telegram, Claude,
 * a job, a cascade from its parent or an undo. This file lists those deletions and puts them back, for good, any time.
 */
import { journaled, nounFor } from "./undo";
import { one, q, tx, UserError } from "./db";

export interface DeletedGroup {
  grp: string;
  deleted_at: string;
  tbl: string;
  noun: string;
  names: string[];
  /** rows of the same kind as the headline (3 deals deleted together) */
  count: number;
  /** linked rows that went with them (its timeline, notes, payments...) */
  linked: number;
  source: string;
  restored: boolean;
  partly: boolean;
}

// what a deletion is called by: the thing you deleted, not the notes that went with it
const HEADLINE = [
  "sales_deals", "tasks", "projects", "contacts", "people", "sales_companies", "sales_people", "sales_radar_items", "sales_hunts",
  "sales_docs", "sales_meetings", "sales_offers", "sales_proofs", "sales_pipelines", "sales_stages", "sales_users", "sales_team",
  "assistant_chats", "diary_entries", "refs", "scratch_items", "exercise_types", "sales_interactions", "sales_payments",
  "sales_commitments", "sales_moves", "contact_touches", "day_entries",
];

const SOURCE: Record<string, string> = { web: "App", telegram: "Telegram", claude: "Claude", mcp: "Claude", undo: "Undo", team: "Team" };

/** Newest first. By default only what a person deleted; `auto` adds clean-ups made by the system and by undo. */
export async function listDeleted(o: { auto?: boolean; search?: string; limit?: number } = {}): Promise<DeletedGroup[]> {
  const rows = await q<{ grp: string; deleted_at: string; tbl: string; names: string[] | null; count: number; total: number; restored_n: number; source: string | null; action_id: string | null }>(
    `with g as (
       select grp,
              (array_agg(id order by array_position($4::text[], tbl) nulls last, id))[1] as first_id, max(deleted_at) as deleted_at, count(*)::int as total,
              count(*) filter (where restored_at is not null)::int as restored_n, max(action_id) as action_id
         from deleted_rows group by grp
     )
     select g.grp, g.deleted_at, f.tbl, g.total, g.restored_n, g.action_id, a.source,
            (select array_agg(coalesce(x.nm, '') order by x.id) from deleted_rows x where x.grp = g.grp and x.tbl = f.tbl) as names,
            (select count(*)::int from deleted_rows x where x.grp = g.grp and x.tbl = f.tbl) as count
       from g join deleted_rows f on f.id = g.first_id
       left join change_actions a on a.id = g.action_id
      where ($1::boolean or (g.action_id is not null and coalesce(a.source, '') <> 'undo'))
        and ($2::text = '' or exists (select 1 from deleted_rows x where x.grp = g.grp and x.nm ilike '%' || $2 || '%'))
      order by g.deleted_at desc
      limit $3`,
    [!!o.auto, (o.search ?? "").trim().slice(0, 80), Math.min(Math.max(o.limit ?? 150, 1), 500), HEADLINE],
  );
  return rows.map((r) => ({
    grp: r.grp,
    deleted_at: r.deleted_at,
    tbl: r.tbl,
    noun: nounFor(r.tbl),
    names: (r.names ?? []).filter(Boolean).slice(0, 6),
    count: r.count,
    linked: r.total - r.count,
    source: r.action_id === null ? "System" : SOURCE[r.source ?? ""] ?? "App",
    restored: r.restored_n === r.total,
    partly: r.restored_n > 0 && r.restored_n < r.total,
  }));
}

/** What a deletion holds, row by row, for the "what is in it" view. */
export async function deletedRows(grp: string): Promise<{ noun: string; nm: string | null; restored: boolean }[]> {
  const rows = await q<{ tbl: string; nm: string | null; restored_at: string | null }>(
    "select tbl, nm, restored_at from deleted_rows where grp = $1 order by id limit 200", [grp]);
  return rows.map((r) => ({ noun: nounFor(r.tbl), nm: r.nm, restored: r.restored_at !== null }));
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => {
  if (!IDENT.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

/**
 * Puts a deletion back: the row and everything that went with it, with the same ids, so links from elsewhere work
 * again. It is one action in History, so it can be undone too. Rows already back are skipped; a row whose parent is
 * still deleted waits for a later pass, and if that parent was deleted separately the message says what to restore.
 */
export async function restoreDeleted(grp: string, source = "web"): Promise<{ restored: number; skipped: number; label: string }> {
  const head = await one<{ tbl: string; nm: string | null }>(
    "select tbl, nm from deleted_rows where grp = $1 order by array_position($2::text[], tbl) nulls last, id limit 1", [grp, HEADLINE]);
  if (!head) throw new UserError("That deletion was not found.");
  const rows = await q<{ id: number; tbl: string; pk: Record<string, unknown>; row: Record<string, unknown> }>(
    "select id, tbl, pk, row from deleted_rows where grp = $1 and restored_at is null order by id", [grp]);
  if (!rows.length) throw new UserError("Everything in it is already back.");
  const cols = new Map<string, Set<string>>();
  for (const t of new Set(rows.map((r) => r.tbl))) {
    const c = await q<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'", [t]);
    if (!c.length) continue; // the table no longer exists
    cols.set(t, new Set(c.map((x) => x.column_name)));
  }
  let restored = 0;
  let skipped = 0;
  const { undo } = await journaled(source, () => tx(async (db) => {
    let pending = rows.filter((r) => cols.has(r.tbl));
    skipped += rows.length - pending.length;
    let missingParent = false;
    for (let pass = 0; pending.length && pass < 10; pass++) {
      const waiting: typeof pending = [];
      for (const r of pending) {
        const have = cols.get(r.tbl)!;
        const names = Object.keys(r.row).filter((k) => have.has(k)).map(ident).join(", ");
        await db.query("savepoint s");
        try {
          const res = await db.query(
            `insert into ${ident(r.tbl)} (${names}) select ${names} from jsonb_populate_record(null::${ident(r.tbl)}, $1::jsonb) on conflict do nothing`,
            [JSON.stringify(r.row)]);
          await db.query("release savepoint s");
          if (res.rowCount) restored++;
          else skipped++; // already there, or the same unique value is now used by another row
          await db.query("update deleted_rows set restored_at = now() where tbl = $1 and pk = $2::jsonb and restored_at is null", [r.tbl, JSON.stringify(r.pk)]);
        } catch (e) {
          await db.query("rollback to savepoint s");
          if ((e as { code?: string }).code !== "23503") throw e;
          waiting.push(r);
        }
      }
      if (waiting.length === pending.length) { missingParent = true; break; }
      pending = waiting;
    }
    if (missingParent && pending.length) {
      // something it belonged to was deleted on its own, in another deletion further down the list
      throw new UserError(`Some of it belongs to something that is also deleted. Restore that first (look further down this list), then this.`);
    }
  }));
  const what = `${nounFor(head.tbl)}${head.nm ? ` “${head.nm.slice(0, 60)}”` : ""}`;
  const label = `Restored ${what}`;
  if (undo) await q("update change_actions set label = $2 where id = $1", [undo.id, label]);
  return { restored, skipped, label };
}
