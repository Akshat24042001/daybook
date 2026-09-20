// Writes db/cron.generated.sql: paste it into the Supabase SQL editor to create the every-minute tick job.
// The file contains your CRON_SECRET, so it is git-ignored. Usage: node --env-file=.env scripts/print-cron-sql.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!/^https:\/\//.test(base)) throw new Error(`APP_BASE_URL must be your deployed https address first (currently "${base}").`);
if (!secret) throw new Error("CRON_SECRET is not set.");

const sql = `-- Daybook scheduler: POST /api/cron/tick every minute (Supabase Cron = pg_cron + pg_net).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running this file is safe: it replaces the job.
select cron.unschedule('daybook-tick') where exists (select 1 from cron.job where jobname = 'daybook-tick');

select cron.schedule(
  'daybook-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := '${base}/api/cron/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '${secret}'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Check it is running:  select * from cron.job_run_details order by start_time desc limit 5;
`;
const out = path.join(root, "db", "cron.generated.sql");
fs.writeFileSync(out, sql);
console.log(`Wrote ${out}`);
