// Applies db/migrations/*.sql in order, once each. Usage: node --env-file=.env scripts/migrate.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const dir = path.join(root, "db", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: url,
  ssl: /supabase\.(co|com)|pooler\.supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
await client.query(
  "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
);
const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));

for (const f of files) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  console.log("applying", f);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into schema_migrations (name) values ($1)", [f]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    console.error(`Migration ${f} failed:`, e.message);
    process.exit(1);
  }
}
console.log("migrations up to date");
await client.end();
