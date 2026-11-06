import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

// Return DATE columns as plain "YYYY-MM-DD" strings (never as JS Dates in local time),
// numerics and bigints as numbers.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1700, (v: string) => parseFloat(v));
pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));

export type Db = Pick<pg.Pool, "query">;

const g = globalThis as unknown as { __daybookPool?: pg.Pool };

/** The undoable action the current request is running (see lib/undo.ts). Writes made inside it are journaled. */
export const actionStore = new AsyncLocalStorage<{ id: number }>();

/**
 * Inside an action, a write runs as its own tiny transaction that first tells the journal triggers which action it
 * belongs to. (A transaction rather than a plain session setting, so it also works behind a transaction-mode pooler.)
 * Reads and writes outside an action are untouched.
 */
function journalWrites(pool: pg.Pool): pg.Pool {
  const raw = pool.query.bind(pool) as (...a: unknown[]) => unknown;
  (pool as unknown as { query: (...a: unknown[]) => unknown }).query = (text: unknown, values?: unknown, cb?: unknown) => {
    const act = actionStore.getStore();
    if (!act || typeof text !== "string" || /^\s*(select|show)\b/i.test(text) || cb) return raw(text, values, cb);
    return (async () => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.action', $1, true)", [String(act.id)]);
        const res = await client.query(text, values as unknown[]);
        await client.query("commit");
        return res;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    })();
  };
  return pool;
}

function needsSsl(url: string): boolean {
  return /supabase\.(co|com)|pooler\.supabase/.test(url);
}

/**
 * Development and tests must never touch real data. Outside Vercel and outside `next start`, a database that is not
 * on this machine is refused unless ALLOW_REMOTE_DB=1 is set on purpose.
 */
export function assertSafeDatabase(url: string): void {
  if (process.env.VERCEL || process.env.NODE_ENV === "production" || process.env.ALLOW_REMOTE_DB === "1") return;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `Refusing to use the remote database ${host} in development. Point DATABASE_URL at the local one ` +
        "(npm run db:start) or set ALLOW_REMOTE_DB=1 if you really mean it.",
    );
  }
}

export function getPool(): pg.Pool {
  if (!g.__daybookPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    assertSafeDatabase(url);
    g.__daybookPool = journalWrites(new pg.Pool({
      connectionString: url,
      max: process.env.VERCEL ? 3 : 8,
      ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 5_000,
    }));
  }
  return g.__daybookPool;
}

export async function closePool(): Promise<void> {
  if (g.__daybookPool) {
    await g.__daybookPool.end();
    g.__daybookPool = undefined;
  }
}

export async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T[]> {
  const res = await db.query(sql, params as unknown[]);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T | null> {
  const rows = await q<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const act = actionStore.getStore();
    if (act) await client.query("select set_config('app.action', $1, true)", [String(act.id)]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** An error whose message is safe and useful to show to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
