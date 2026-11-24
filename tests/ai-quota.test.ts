// The free AI allowance: background work stops before the part kept for you, a "used up for today" answer holds that
// allowance until it resets (so nothing walks every model for nothing), and an entry you log while it is used up is
// never lost: it waits, is filed by itself later, or is saved now as a note on its deal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, q } from "@/lib/db";
import {
  aiGate, aiSent, bucketFor, dailyQuotaHit, forgetQuotaState, inBackground, isAiUnavailable, keepForYou, nextPacificMidnight,
  nextUtcMidnight, pacificDay, parseFreeAllowance, quotaLimitIn,
} from "@/lib/ai-quota";
import { llm } from "@/lib/sales/llm";
import { createDeal } from "@/lib/sales/deals";
import { capture, processCapture, requeueWaitingCaptures } from "@/lib/sales/ingest";
import { keepCaptureAsNoteAction, logToDealAction } from "@/app/sales-actions";
import { enqueue, runJobs } from "@/lib/sales/jobs";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const OR_DAY_CAP = JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", code: 429 } });
const GEMINI_DAY_CAP = JSON.stringify([{ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }] } }]);
const OR_MINUTE = JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-min.", code: 429 } });

describe("reading provider answers (pure)", () => {
  it("tells a day's allowance from a per-minute limit", () => {
    expect(dailyQuotaHit("openrouter", 429, OR_DAY_CAP)).toBe(true);
    expect(dailyQuotaHit("openrouter", 429, OR_MINUTE)).toBe(false);
    expect(dailyQuotaHit("gemini", 429, GEMINI_DAY_CAP)).toBe(true);
    expect(dailyQuotaHit("gemini", 429, JSON.stringify({ error: { details: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] } }))).toBe(false);
    expect(dailyQuotaHit("openrouter", 500, OR_DAY_CAP)).toBe(false);
    expect(quotaLimitIn(GEMINI_DAY_CAP)).toBe(20);
  });

  it("knows which models share an allowance", () => {
    expect(bucketFor("openrouter", "google/gemma-4-31b-it:free")).toBe("openrouter:free");
    expect(bucketFor("openrouter", "qwen/qwen3.8-27b:free")).toBe("openrouter:free");
    expect(bucketFor("openrouter", "anthropic/claude-sonnet")).toBeNull(); // paid: no daily allowance
    expect(bucketFor("gemini", "gemini-2.5-flash")).toBe("gemini:gemini-2.5-flash");
  });

  it("reads OpenRouter's own count of what is left", () => {
    expect(parseFreeAllowance({ data: { label: "x", free_model_daily_requests: { used: 12, limit: 50, remaining: 38 } } })).toEqual({ used: 12, limit: 50, remaining: 38 });
    expect(parseFreeAllowance({ data: { free_model_daily_requests: { used: 3, limit: 1000 } } })).toEqual({ used: 3, limit: 1000, remaining: 997 });
    expect(parseFreeAllowance({ data: { label: "x" } })).toBeNull();
    expect(parseFreeAllowance(null)).toBeNull();
  });

  it("keeps a quarter for you, between 10 and 100, or what AI_KEEP_FOR_YOU says", () => {
    expect(keepForYou(50)).toBe(13);
    expect(keepForYou(1000)).toBe(100);
    expect(keepForYou(20)).toBe(10);
    expect(keepForYou(5)).toBe(5);
    vi.stubEnv("AI_KEEP_FOR_YOU", "25");
    expect(keepForYou(50)).toBe(25);
    vi.unstubAllEnvs();
  });

  it("resets on the provider's day: UTC for OpenRouter, Pacific for Gemini", () => {
    const now = new Date("2026-11-24T02:00:00Z"); // 7:30 IST; still 23 Nov in California
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-11-25T00:00:00.000Z");
    expect(pacificDay(now)).toBe("2026-11-23");
    expect(nextPacificMidnight(now).toISOString()).toBe("2026-11-24T08:00:00.000Z"); // PST is UTC-8
    expect(nextPacificMidnight(new Date("2026-07-01T12:00:00Z")).toISOString()).toBe("2026-07-02T07:00:00.000Z"); // PDT
  });
});

/** A scripted AI and OpenRouter key endpoint; every request is recorded. */
function scripted(o: { status?: number; body?: string; left?: { used: number; limit: number; remaining: number } | null; content?: string } = {}) {
  const calls: { url: string; model: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/v1/key")) {
      calls.push({ url, model: null });
      return new Response(JSON.stringify({ data: { free_model_daily_requests: o.left ?? null } }), { status: 200 });
    }
    const model = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? null;
    calls.push({ url, model });
    if (o.status && o.status !== 200) return new Response(o.body ?? "", { status: o.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: o.content ?? "ok" } }] }), { status: 200 });
  }));
  return calls;
}

beforeEach(async () => {
  await q("delete from ai_quota");
  forgetQuotaState();
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.stubEnv("AI_MODELS", "acme/text-a:free,acme/text-b:free,acme/text-c:free");
  vi.stubEnv("AI_VISION_MODELS", "acme/vision-a:free");
  (globalThis as unknown as { __llmCool?: Map<string, number> }).__llmCool?.clear();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await q("delete from ai_quota"); // a block left behind would stop the AI in every test after this file
  forgetQuotaState();
});

describe("the gate", () => {
  it("one 'used up for today' answer stops every free model until midnight UTC, for everyone", async () => {
    const calls = scripted({ status: 429, body: OR_DAY_CAP });
    const err = await llm([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(isAiUnavailable(err)).toBe(true);
    expect((err as { until: Date }).until.toISOString()).toBe(nextUtcMidnight().toISOString());
    expect(calls.filter((c) => c.model)).toHaveLength(1); // the other two free models were not tried for nothing
    const row = await one<{ blocked_until: string }>("select blocked_until from ai_quota where bucket = 'openrouter:free'");
    expect(new Date(row!.blocked_until).toISOString()).toBe(nextUtcMidnight().toISOString());

    forgetQuotaState(); // another server slot: reads the block from the database
    const again = scripted({ content: "fine" });
    const err2 = await llm([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(isAiUnavailable(err2)).toBe(true);
    expect(again).toHaveLength(0); // nothing sent at all
  });

  it("a per-minute limit is not a used-up day: the old 'try again' error stays", async () => {
    scripted({ status: 429, body: OR_MINUTE });
    const err = await llm([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(isAiUnavailable(err)).toBe(false);
    expect(String(err.message)).toMatch(/429/);
    expect(await one("select 1 from ai_quota where bucket = 'openrouter:free'")).toBeNull();
  });

  it("background work stops at the part kept for you; what you do still goes through", async () => {
    const calls = scripted({ left: { used: 38, limit: 50, remaining: 12 }, content: "done" });
    const bg = await inBackground(() => llm([{ role: "user", content: "score this radar lead" }])).catch((e) => e);
    expect(isAiUnavailable(bg)).toBe(true);
    expect(calls.filter((c) => c.model)).toHaveLength(0);

    const mine = await llm([{ role: "user", content: "file my chat" }]); // the lane you are in by default
    expect(mine.text).toBe("done");
  });

  it("background work runs as before while plenty is left", async () => {
    scripted({ left: { used: 5, limit: 1000, remaining: 995 }, content: "done" });
    expect((await inBackground(() => llm([{ role: "user", content: "x" }]))).text).toBe("done");
  });

  it("Gemini: learns the daily allowance from its 429, counts what is sent, and keeps the end for you", async () => {
    const now = new Date();
    await aiSent("gemini", "gemini-2.5-flash", 429, GEMINI_DAY_CAP, now);
    forgetQuotaState();
    expect((await aiGate("gemini", "gemini-2.5-flash", now)).ok).toBe(false); // used up until midnight Pacific
    // the next day: 8 of 20 used, so 12 left, more than the 10 kept for you: background may go
    await q("update ai_quota set blocked_until = null, day = $1, used = 8 where bucket = 'gemini:gemini-2.5-flash'", [pacificDay(now)]);
    forgetQuotaState();
    expect((await inBackground(() => aiGate("gemini", "gemini-2.5-flash", now))).ok).toBe(true);
    for (let i = 0; i < 2; i++) await aiSent("gemini", "gemini-2.5-flash", 200, "", now);
    forgetQuotaState();
    const bg = await inBackground(() => aiGate("gemini", "gemini-2.5-flash", now));
    expect(bg.ok).toBe(false); // 10 left: kept for you
    expect((await aiGate("gemini", "gemini-2.5-flash", now)).ok).toBe(true);
  });
});

describe("a log while the allowance is used up", () => {
  beforeEach(async () => {
    await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
             sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_jobs restart identity cascade`);
    await q("update sales_settings set config = '{}'::jsonb");
  });

  it("waits instead of failing, can be saved now as a note, and is never filed twice", async () => {
    const deal = await createDeal({ title: "Koel: chatbot" });
    scripted({ status: 429, body: OR_DAY_CAP });
    const r = await logToDealAction(deal, "Does anyone here work on something like this? Please DM me.\n+91 93854 95938 - Koel", { channel: "whatsapp", direction: "in" });
    expect(r.ok).toBe(true);
    const res = (r as { result: { failed?: string; waiting?: boolean; note_deal_id?: number; capture_id?: number } }).result;
    expect(res.waiting).toBe(true);
    expect(res.note_deal_id).toBe(deal);
    expect(res.failed).toMatch(/allowance is used up/);
    expect(res.failed).toMatch(/save it as a note/);
    const cap = await one<{ status: string; wait_ai: boolean }>("select status, wait_ai from sales_captures where id = $1", [res.capture_id]);
    expect(cap).toEqual({ status: "failed", wait_ai: true });

    const saved = await keepCaptureAsNoteAction(res.capture_id!);
    expect(saved.ok).toBe(true);
    const row = await one<{ channel: string; direction: string; body: string; capture_id: number; source: string }>(
      "select channel, direction, body, capture_id, source from sales_interactions where deal_id = $1", [deal]);
    expect(row).toMatchObject({ channel: "whatsapp", direction: "in", capture_id: res.capture_id, source: "manual" });
    expect(row!.body).toMatch(/Koel/);
    expect(await one("select status, wait_ai from sales_captures where id = $1", [res.capture_id])).toEqual({ status: "done", wait_ai: false });

    expect(await requeueWaitingCaptures()).toBe(0); // saved: not filed again when the AI is back
    const twice = await keepCaptureAsNoteAction(res.capture_id!);
    expect(twice.ok).toBe(false);
  });

  it("is filed by itself once the AI is back, and a queued try that still finds none waits without using its tries", async () => {
    const deal = await createDeal({ title: "Koel: chatbot" });
    scripted({ status: 429, body: OR_DAY_CAP });
    const id = await capture({ source: "web", channel: "whatsapp", text: "Koel: can you build this? budget 50k", hints: { deal_id: deal } }, { now: true });
    await expect(processCapture(id)).rejects.toSatisfy(isAiUnavailable);

    expect(await requeueWaitingCaptures()).toBe(1);
    expect(await requeueWaitingCaptures()).toBe(0); // already queued
    const { HANDLERS } = await import("@/lib/sales/run");
    await runJobs(HANDLERS, 20_000);
    const job = await one<{ status: string; attempts: number; run_after: string }>("select status, attempts, run_after from sales_jobs where kind = 'process_capture'");
    expect(job!.status).toBe("queued");
    expect(job!.attempts).toBe(0);
    expect(new Date(job!.run_after).getTime()).toBeGreaterThan(nextUtcMidnight().getTime());

    // the allowance is back: the waiting entry is filed like any other
    await q("delete from ai_quota");
    forgetQuotaState();
    await q("update sales_jobs set run_after = now()");
    scripted({ content: JSON.stringify({ kind: "conversation", is_sales_related: true, channel: "whatsapp", direction: "in",
      messages: [{ from: "them", text: "Can you build this? budget 50k" }], summary: "Koel asked for a build, budget 50k." }) });
    await runJobs(HANDLERS, 20_000);
    expect(await one("select status, wait_ai from sales_captures where id = $1", [id])).toEqual({ status: "done", wait_ai: false });
    expect(Number((await one<{ n: number }>("select count(*)::int as n from sales_interactions where deal_id = $1", [deal]))!.n)).toBeGreaterThan(0);
  });

  it("background jobs that only lack AI wait for it instead of failing for good", async () => {
    scripted({ status: 429, body: OR_DAY_CAP });
    await enqueue("needs_ai", {});
    await runJobs({ async needs_ai() { await llm([{ role: "user", content: "x" }]); } }, 10_000);
    const job = await one<{ status: string; attempts: number }>("select status, attempts from sales_jobs where kind = 'needs_ai'");
    expect(job).toEqual({ status: "queued", attempts: 0 });
  });
});
