import pg from "pg";

// Return DATE columns as plain "YYYY-MM-DD" strings (never as JS Dates in local time),
// numerics and bigints as numbers.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1700, (v: string) => parseFloat(v));
pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));

export type Db = Pick<pg.Pool, "query">;

const g = globalThis as unknown as { __daybookPool?: pg.Pool };

function needsSsl(url: string): boolean {
  return /supabase\.(co|com)|pooler\.supabase/.test(url);
}

export function getPool(): pg.Pool {
  if (!g.__daybookPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__daybookPool = new pg.Pool({
      connectionString: url,
      max: process.env.VERCEL ? 3 : 8,
      ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 5_000,
    });
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
