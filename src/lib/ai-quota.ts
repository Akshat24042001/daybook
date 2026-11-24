/**
 * The free AI allowance, kept fair between you and the background.
 *
 * Free AI comes with a daily allowance. OpenRouter gives one allowance for every free model together (50 requests a
 * day, 1000 once 10 credits were ever bought) and reports what is left at GET /api/v1/key. Gemini gives each model its
 * own allowance per project, resets it at midnight Pacific time, and only says what it was when it runs out (a 429 with
 * a per-day quota id and its value), so Daybook counts what it sends.
 *
 * Two lanes share it:
 *   you         anything you start (a log, a chat, a draft, Telegram): may use the whole allowance
 *   background  the minute tick and the job queue (radar, research, news, hunts): stops while what is left is at or
 *               under the part kept for you (AI_KEEP_FOR_YOU, else a quarter of the allowance, 10 to 100)
 * When a provider says the day's allowance is gone, nobody sends to it again until it resets, so a request fails in a
 * moment instead of walking every model. When nothing can answer for that reason, AiUnavailable says when it comes back.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { TZDate } from "@date-fns/tz";
import { q, UserError } from "./db";

export type Lane = "you" | "background";

const lanes = ((globalThis as unknown as { __aiLanes?: AsyncLocalStorage<Lane> }).__aiLanes ??= new AsyncLocalStorage<Lane>());

/** Which lane the current work is in; anything not marked is yours. */
export function aiLane(): Lane {
  return lanes.getStore() ?? "you";
}
export function inBackground<T>(fn: () => Promise<T>): Promise<T> {
  return lanes.run("background", fn);
}
export function asYou<T>(fn: () => Promise<T>): Promise<T> {
  return lanes.run("you", fn);
}

/** No AI can answer because the day's free allowance is used up (or kept for you). `until` is when it comes back. */
export class AiUnavailable extends UserError {
  until: Date | null;
  constructor(until: Date | null, message?: string) {
    super(message ?? `Today's free AI allowance is used up${until ? `; it comes back at ${until.toISOString().slice(11, 16)} UTC` : ""}.`);
    this.name = "AiUnavailable";
    this.until = until;
  }
}
export const isAiUnavailable = (e: unknown): e is AiUnavailable => e instanceof Error && e.name === "AiUnavailable";

// ------------------------------------------------------------------ quota days (pure)

const PACIFIC = "America/Los_Angeles";

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
export function pacificDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function nextPacificMidnight(now: Date = new Date()): Date {
  const [y, m, d] = pacificDay(now).split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d + 1, 0, 0, 0, PACIFIC).getTime());
}

// ------------------------------------------------------------------ reading provider answers (pure)

export type Provider = "openrouter" | "gemini";

/** The allowance a model draws on, or null when it is not a free allowance (a paid OpenRouter model). */
export function bucketFor(provider: Provider, model: string): string | null {
  if (provider === "gemini") return `gemini:${model}`;
  return /:free$/.test(model) ? "openrouter:free" : null;
}

/** A provider saying the whole day's allowance is gone (not a per-minute limit). */
export function dailyQuotaHit(provider: Provider, status: number, body: string): boolean {
  if (status !== 429) return false;
  if (provider === "openrouter") return /free-models-per-day/i.test(body);
  return /PerDay/i.test(body); // quotaId GenerateRequestsPerDayPerProjectPerModel(-FreeTier)
}

/** The daily allowance a 429 names (Gemini: "quotaValue": "20"). */
export function quotaLimitIn(body: string): number | null {
  const m = body.match(/"quotaValue"\s*:\s*"?(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Any answer that means "out of allowance" (daily or per minute). */
export function looksLikeQuota(message: string): boolean {
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate limit/i.test(message);
}

/** How much of a daily allowance is kept for what you do yourself. */
export function keepForYou(limit: number): number {
  const env = Number(process.env.AI_KEEP_FOR_YOU);
  if (process.env.AI_KEEP_FOR_YOU?.trim() && Number.isFinite(env) && env >= 0) return Math.min(Math.floor(env), limit);
  return Math.min(limit, Math.max(10, Math.min(100, Math.round(limit / 4))));
}

// ------------------------------------------------------------------ shared state (Postgres, cached briefly)

interface QuotaRow {
  bucket: string;
  blocked_until: string | null;
  day: string | null;
  used: number;
  day_limit: number | null;
}

const mem = ((globalThis as unknown as { __aiQuota?: { at: number; rows: Map<string, QuotaRow> } | null }).__aiQuota ??= null);
let state: { at: number; rows: Map<string, QuotaRow> } | null = mem;
const STATE_MS = 20_000;

async function rows(): Promise<Map<string, QuotaRow>> {
  if (state && Date.now() - state.at < STATE_MS) return state.rows;
  try {
    const list = await q<QuotaRow>("select bucket, blocked_until, day, used, day_limit from ai_quota");
    state = { at: Date.now(), rows: new Map(list.map((r) => [r.bucket, r])) };
  } catch {
    state = { at: Date.now(), rows: state?.rows ?? new Map() }; // no table yet: nothing is blocked
  }
  (globalThis as unknown as { __aiQuota?: unknown }).__aiQuota = state;
  return state.rows;
}

/** Forgets the cached state (tests, and after a write). */
export function forgetQuotaState(): void {
  state = null;
  orCache = null;
  (globalThis as unknown as { __aiQuota?: unknown }).__aiQuota = null;
}

/** When the allowance comes back, if a provider said it is gone. */
export async function blockedUntil(bucket: string, now: Date = new Date()): Promise<Date | null> {
  const r = (await rows()).get(bucket);
  const until = r?.blocked_until ? new Date(r.blocked_until) : null;
  return until && until > now ? until : null;
}

/** After a quota answer: when this model's allowance comes back, if the provider said the day's allowance is gone. */
export async function quotaBack(provider: Provider, model: string): Promise<Date | null> {
  const bucket = bucketFor(provider, model);
  return bucket ? blockedUntil(bucket) : null;
}

async function block(bucket: string, until: Date, reason: string, limit: number | null): Promise<void> {
  try {
    await q(
      `insert into ai_quota (bucket, blocked_until, reason, day_limit, updated_at) values ($1,$2,$3,$4,now())
       on conflict (bucket) do update set blocked_until = $2, reason = $3, day_limit = coalesce($4, ai_quota.day_limit), updated_at = now()`,
      [bucket, until.toISOString(), reason.slice(0, 300), limit],
    );
  } catch (e) {
    console.warn("[ai-quota] could not save the block:", (e as Error).message);
  }
  state = null;
}

async function countUse(bucket: string, day: string): Promise<void> {
  try {
    await q(
      `insert into ai_quota (bucket, day, used, updated_at) values ($1,$2,1,now())
       on conflict (bucket) do update set used = case when ai_quota.day = $2 then ai_quota.used + 1 else 1 end, day = $2, updated_at = now()`,
      [bucket, day],
    );
  } catch {
    /* counting is best effort */
  }
  const r = state?.rows.get(bucket);
  if (r) {
    r.used = r.day === day ? r.used + 1 : 1;
    r.day = day;
  }
}

// ------------------------------------------------------------------ OpenRouter: what is left today, as it reports it

export interface FreeAllowance {
  used: number;
  limit: number;
  remaining: number;
}
let orCache: { at: number; value: FreeAllowance | null } | null = null;
const OR_MS = 60_000;

/** Pure: the free_model_daily_requests object from GET /api/v1/key (it may sit under data). */
export function parseFreeAllowance(json: unknown): FreeAllowance | null {
  const root = json as { data?: { free_model_daily_requests?: unknown }; free_model_daily_requests?: unknown } | null;
  const f = (root?.data?.free_model_daily_requests ?? root?.free_model_daily_requests) as Partial<FreeAllowance> | undefined;
  if (!f || typeof f.limit !== "number") return null;
  const used = typeof f.used === "number" ? f.used : Math.max(0, f.limit - (f.remaining ?? 0));
  const remaining = typeof f.remaining === "number" ? f.remaining : Math.max(0, f.limit - used);
  return { used, limit: f.limit, remaining };
}

/** Today's free OpenRouter allowance, or null when it cannot be read (then nothing is held back). */
export async function openRouterFree(): Promise<FreeAllowance | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  if (orCache && Date.now() - orCache.at < OR_MS) return orCache.value;
  let value: FreeAllowance | null = null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (res.ok) value = parseFreeAllowance(await res.json());
  } catch {
    value = null;
  }
  orCache = { at: Date.now(), value };
  return value;
}

// ------------------------------------------------------------------ the gate, and what happened

export type Gate = { ok: true } | { ok: false; until: Date | null; why: string };

/** May this request go to this model now, in this lane? */
export async function aiGate(provider: Provider, model: string, now: Date = new Date()): Promise<Gate> {
  const bucket = bucketFor(provider, model);
  if (!bucket) return { ok: true };
  const blocked = await blockedUntil(bucket, now);
  if (blocked) return { ok: false, until: blocked, why: "allowance used up" };
  if (aiLane() !== "background") return { ok: true };
  if (provider === "openrouter") {
    const f = await openRouterFree();
    if (f && f.remaining <= keepForYou(f.limit)) return { ok: false, until: nextUtcMidnight(now), why: `kept for you (${f.remaining} of ${f.limit} left)` };
    return { ok: true };
  }
  const r = (await rows()).get(bucket);
  if (r?.day_limit && r.day === pacificDay(now) && r.day_limit - r.used <= keepForYou(r.day_limit)) {
    return { ok: false, until: nextPacificMidnight(now), why: `kept for you (${Math.max(0, r.day_limit - r.used)} of ${r.day_limit} left)` };
  }
  return { ok: true };
}

/** Records a request that was sent: counts it, and when the day's allowance is gone, holds the model until it resets. */
export async function aiSent(provider: Provider, model: string, status: number | null, body = "", now: Date = new Date()): Promise<void> {
  const bucket = bucketFor(provider, model);
  if (!bucket) return;
  if (provider === "gemini") await countUse(bucket, pacificDay(now));
  if (status !== null && dailyQuotaHit(provider, status, body)) {
    const until = provider === "gemini" ? nextPacificMidnight(now) : nextUtcMidnight(now);
    const limit = provider === "gemini" ? quotaLimitIn(body) : null;
    console.warn(`[ai-quota] ${bucket}: today's allowance is used up until ${until.toISOString()}`);
    await block(bucket, until, `${status}: ${body.slice(0, 200)}`, limit);
    if (provider === "openrouter") orCache = { at: Date.now(), value: orCache?.value ? { ...orCache.value, remaining: 0 } : null };
  }
}

/** For Settings: what is known about today's allowances. */
export async function aiAllowanceToday(now: Date = new Date()): Promise<{ openrouter: FreeAllowance | null; keep: number | null; blocked: { bucket: string; until: string }[] }> {
  const openrouter = await openRouterFree();
  const blocked = [...(await rows()).values()]
    .filter((r) => r.blocked_until && new Date(r.blocked_until) > now)
    .map((r) => ({ bucket: r.bucket, until: new Date(r.blocked_until!).toISOString() }));
  return { openrouter, keep: openrouter ? keepForYou(openrouter.limit) : null, blocked };
}
