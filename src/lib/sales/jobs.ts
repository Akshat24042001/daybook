/**
 * A small job queue in Postgres. Slow work (AI extraction, enrichment, radar crawling) is queued and run by the minute
 * tick in the background, so webhooks answer instantly and nothing is lost when a free model is slow.
 */
import { one, q } from "../db";
import { asYou, inBackground, isAiUnavailable } from "../ai-quota";

/** Jobs that carry something you did yourself (a log from Telegram, email or the web): they may use the AI allowance
 * kept for you. Every other job is background work and stops before that part. */
const YOUR_JOBS = new Set(["process_capture"]);
const inLane = <T>(kind: string, fn: () => Promise<T>) => (YOUR_JOBS.has(kind) ? asYou(fn) : inBackground(fn));

/** A job that only failed because today's AI allowance is used up waits for it, without using up its tries. */
async function waitForAi(job: Job, e: Error & { until?: Date | null }): Promise<void> {
  const until = e.until && e.until.getTime() > Date.now() ? e.until : new Date(Date.now() + 30 * 60_000);
  await q(
    "update sales_jobs set status = 'queued', attempts = greatest(attempts - 1, 0), last_error = $2, run_after = $3 where id = $1",
    [job.id, e.message.slice(0, 500), new Date(until.getTime() + 2 * 60_000).toISOString()],
  );
}

export interface Job {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export async function enqueue(kind: string, payload: Record<string, unknown> = {}, o: { runAfter?: Date; dedupeKey?: string } = {}): Promise<number | null> {
  const row = await one<{ id: number }>(
    `insert into sales_jobs (kind, payload, run_after, dedupe_key) values ($1,$2,coalesce($3, now()),$4)
     on conflict (dedupe_key) do nothing returning id`,
    [kind, JSON.stringify(payload), o.runAfter ?? null, o.dedupeKey ?? null],
  );
  return row?.id ?? null;
}

async function claim(): Promise<Job | null> {
  return one<Job>(
    `update sales_jobs set status = 'running', attempts = attempts + 1, locked_until = now() + interval '3 minutes'
     where id = (
       select id from sales_jobs
       where (status = 'queued' and run_after <= now()) or (status = 'running' and locked_until < now())
       order by run_after limit 1 for update skip locked)
     returning id, kind, payload, attempts`,
  );
}

export type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/** Runs queued jobs until the time budget is spent. Returns how many ran. */
export async function runJobs(handlers: Record<string, Handler>, budgetMs: number): Promise<{ ran: number; failed: number }> {
  const deadline = Date.now() + budgetMs;
  let ran = 0;
  let failed = 0;
  while (Date.now() < deadline - 5_000) {
    const job = await claim();
    if (!job) break;
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      await inLane(job.kind, () => handler(job.payload, job));
      await q("update sales_jobs set status = 'done', done_at = now(), last_error = null, dedupe_key = null where id = $1", [job.id]);
      ran += 1;
    } catch (e) {
      if (isAiUnavailable(e)) {
        await waitForAi(job, e);
        continue;
      }
      failed += 1;
      const msg = (e as Error).message.slice(0, 500);
      console.warn(`[sales-job] ${job.kind}#${job.id} failed:`, msg);
      if (job.attempts >= 3) {
        await q("update sales_jobs set status = 'failed', last_error = $2, dedupe_key = null where id = $1", [job.id, msg]);
      } else {
        await q(`update sales_jobs set status = 'queued', last_error = $2, run_after = now() + ($3 || ' minutes')::interval where id = $1`, [job.id, msg, String(job.attempts * 3)]);
      }
    }
  }
  // keep the table small
  if (Math.random() < 0.02) {
    await q("delete from sales_jobs where status in ('done','failed') and created_at < now() - interval '14 days'");
    await q("delete from sales_search_log where at < now() - interval '30 days'");
    await q("delete from change_actions where created_at < now() - interval '30 days'"); // the undo history keeps 30 days
  }
  return { ran, failed };
}

export async function queueStats(): Promise<{ queued: number; failed: number; running: number }> {
  return (await one(
    "select count(*) filter (where status='queued')::int as queued, count(*) filter (where status='failed' and created_at > now() - interval '2 days')::int as failed, count(*) filter (where status='running')::int as running from sales_jobs",
  )) as { queued: number; failed: number; running: number };
}

/**
 * Runs one queued job now (right after a click, or chained from another job), so it does not wait for the next
 * minute's scheduler. If it is already taken or not due, nothing happens; the scheduler remains the safety net.
 */
export async function runJobNow(id: number | null, handlers: Record<string, Handler>): Promise<boolean> {
  if (!id) return false;
  const job = await one<Job>(
    `update sales_jobs set status = 'running', attempts = attempts + 1, locked_until = now() + interval '3 minutes'
      where id = $1 and status = 'queued' and run_after <= now() returning id, kind, payload, attempts`, [id]);
  if (!job) return false;
  const handler = handlers[job.kind];
  try {
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    await inLane(job.kind, () => handler(job.payload, job));
    await q("update sales_jobs set status = 'done', done_at = now(), last_error = null, dedupe_key = null where id = $1", [job.id]);
    return true;
  } catch (e) {
    if (isAiUnavailable(e)) {
      await waitForAi(job, e);
      return false;
    }
    const msg = (e as Error).message.slice(0, 500);
    console.warn(`[sales-job] ${job.kind}#${job.id} failed:`, msg);
    if (job.attempts >= 3) await q("update sales_jobs set status = 'failed', last_error = $2, dedupe_key = null where id = $1", [job.id, msg]);
    else await q(`update sales_jobs set status = 'queued', last_error = $2, run_after = now() + interval '1 minute' where id = $1`, [job.id, msg]);
    return false;
  }
}

/**
 * Starts a job in its own fresh server slot (a call to /api/sales/job), for a step that needs its own full minute.
 * Fire and forget: if the call cannot be made, the scheduler runs the job within a minute.
 */
export async function kickJob(id: number | null): Promise<void> {
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  const secret = process.env.CRON_SECRET;
  if (!id || !base || !secret) return;
  await fetch(`${base}/api/sales/job`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ id }), signal: AbortSignal.timeout(4_000),
  }).catch(() => {});
}
