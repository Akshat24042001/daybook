// Copies every Daybook table (and the Supabase Cron tick job) from one Postgres database to another, e.g. when moving
// the Supabase project to a new region. The copy runs in a single transaction on the target: it either lands
// completely, with row counts verified against the source, or nothing changes.
//
// Usage (PowerShell):
//   $env:OLD_DATABASE_URL="postgresql://postgres.<old-ref>:<password>@<old-host>.pooler.supabase.com:6543/postgres"
//   $env:NEW_DATABASE_URL="postgresql://postgres.<new-ref>:<password>@<new-host>.pooler.supabase.com:6543/postgres"
//   node scripts/move-db.mjs            # dry run: shows what would be copied
//   node scripts/move-db.mjs --go       # does it
//
// Anything already in the target's tables is replaced. The source is only read, except that with --go the old
// project's 'daybook-tick' cron job is unscheduled after the copy so the app is not ticked twice a minute.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const go = process.argv.includes("--go");
const BATCH = 500;

// The transaction pooler (6543) is fine for the app; a long migration is safer on the session pooler (5432).
const session = (url) => url.replace(/(pooler\.supabase\.com):6543\//, "$1:5432/");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set. See the usage notes at the top of scripts/move-db.mjs.`);
    process.exit(1);
  }
  if (v.includes("[YOUR-PASSWORD]") || v.includes("<password>")) {
    console.error(`${name} still has the password placeholder in it.`);
    process.exit(1);
  }
  return session(v);
}

const oldUrl = need("OLD_DATABASE_URL");
const newUrl = need("NEW_DATABASE_URL");
const dbKey = (url) => {
  const u = new URL(url);
  return `${u.username}@${u.hostname}${u.pathname}`;
};
if (dbKey(oldUrl) === dbKey(newUrl)) {
  console.error("OLD_DATABASE_URL and NEW_DATABASE_URL point at the same database.");
  process.exit(1);
}

const client = (url) =>
  new pg.Client({
    connectionString: url,
    ssl: /supabase\.(co|com)|pooler\.supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15_000,
  });
const src = client(oldUrl);
const dst = client(newUrl);
const label = (url) => `${new URL(url).username}@${new URL(url).hostname}`;

try {
  await src.connect();
  console.log(`source: ${label(oldUrl)}  ok`);
} catch (e) {
  console.error(`Could not connect to the OLD database: ${e.message}`);
  process.exit(1);
}
try {
  await dst.connect();
  console.log(`target: ${label(newUrl)}  ok`);
} catch (e) {
  console.error(`Could not connect to the NEW database: ${e.message}`);
  process.exit(1);
}

// 1. Schema: bring the target up to date with db/migrations (idempotent).
if (go) {
  console.log("\n1) applying migrations to the new database");
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "migrate.mjs"), newUrl], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("Migrations failed on the new database; nothing was copied.");
    process.exit(1);
  }
}

// 2. Work out what to copy.
const tablesOf = async (c) =>
  (
    await c.query(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    )
  ).rows.map((r) => r.name);

const columnsOf = async (c, table) =>
  (
    await c.query(
      `select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped
       and attgenerated = '' order by attnum`,
      [`public."${table}"`],
    )
  ).rows.map((r) => r.attname);

const srcTables = (await tablesOf(src)).filter((t) => t !== "schema_migrations");
const dstTables = new Set(await tablesOf(dst));
const counts = {};
for (const t of srcTables) counts[t] = (await src.query(`select count(*)::int as n from public."${t}"`)).rows[0].n;

const missing = srcTables.filter((t) => !dstTables.has(t) && counts[t] > 0);
if (go && missing.length) {
  console.error(`These old tables have data but do not exist in the new database: ${missing.join(", ")}`);
  process.exit(1);
}

// Parents before children, following foreign keys inside public.
const deps = (
  await src.query(
    `select cl.relname as child, pr.relname as parent from pg_constraint k
     join pg_class cl on cl.oid = k.conrelid join pg_class pr on pr.oid = k.confrelid
     join pg_namespace n on n.oid = cl.relnamespace
     where k.contype = 'f' and n.nspname = 'public' and cl.relname <> pr.relname`,
  )
).rows;
const order = [];
const seen = new Set();
const visit = (t, stack = new Set()) => {
  if (seen.has(t) || stack.has(t)) return;
  stack.add(t);
  for (const d of deps) if (d.child === t && srcTables.includes(d.parent)) visit(d.parent, stack);
  seen.add(t);
  order.push(t);
};
srcTables.forEach((t) => visit(t));

console.log(`\n${go ? "2) copying" : "would copy"} ${order.length} tables:`);
for (const t of order) console.log(`   ${t.padEnd(28)} ${counts[t]} rows`);

if (!go) {
  console.log("\nDry run only. Re-run with --go to migrate.");
  await src.end();
  await dst.end();
  process.exit(0);
}

// 3. Copy everything in one transaction on the target.
try {
  await dst.query("begin");
  const targets = order.filter((t) => dstTables.has(t));
  if (targets.length) {
    await dst.query(`truncate ${targets.map((t) => `public."${t}"`).join(", ")} restart identity cascade`);
  }

  for (const t of targets) {
    const dstCols = new Set(await columnsOf(dst, t));
    const cols = (await columnsOf(src, t)).filter((c) => dstCols.has(c));
    const list = cols.map((c) => `"${c}"`).join(", ");
    const { rows } = await src.query(`select row_to_json(x) as r from (select ${list} from public."${t}") x`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => r.r);
      await dst.query(
        `insert into public."${t}" (${list}) overriding system value
         select ${list} from json_populate_recordset(null::public."${t}", $1::json)`,
        [JSON.stringify(chunk)],
      );
    }

    // Keep id sequences ahead of the copied rows.
    for (const c of cols) {
      const seq = (await dst.query("select pg_get_serial_sequence($1, $2) as s", [`public."${t}"`, c])).rows[0].s;
      if (seq) {
        await dst.query(
          `select setval($1, coalesce((select max("${c}") from public."${t}"), 0) + 1, false)`,
          [seq],
        );
      }
    }

    const n = (await dst.query(`select count(*)::int as n from public."${t}"`)).rows[0].n;
    if (n !== counts[t]) throw new Error(`${t}: copied ${n} rows but the source has ${counts[t]}`);
    console.log(`   ${t.padEnd(28)} ${n}/${counts[t]} ✓`);
  }
  await dst.query("commit");
} catch (e) {
  await dst.query("rollback").catch(() => {});
  console.error(`\nCopy failed and was rolled back; the new database is unchanged. ${e.message}`);
  process.exit(1);
}

// 4. Move the every-minute tick job (it carries the app URL and CRON_SECRET) from the old project to the new one.
console.log("\n3) scheduler");
try {
  const job = (
    await src.query("select schedule, command from cron.job where jobname = 'daybook-tick'").catch(() => ({ rows: [] }))
  ).rows[0];
  if (!job) {
    console.log("   no 'daybook-tick' job in the old project; create one with scripts/print-cron-sql.mjs");
  } else {
    await dst.query("create extension if not exists pg_cron");
    await dst.query("create extension if not exists pg_net");
    await dst.query(
      "select cron.unschedule('daybook-tick') where exists (select 1 from cron.job where jobname = 'daybook-tick')",
    );
    await dst.query("select cron.schedule('daybook-tick', $1, $2)", [job.schedule, job.command]);
    await src.query("select cron.unschedule('daybook-tick')");
    console.log("   'daybook-tick' now runs from the new project (and is removed from the old one) ✓");
  }
} catch (e) {
  console.error(`   Could not move the cron job (${e.message}). Data is copied; create the job with scripts/print-cron-sql.mjs.`);
}

await src.end();
await dst.end();
console.log("\nDone. Now update DATABASE_URL in Vercel and redeploy.");
