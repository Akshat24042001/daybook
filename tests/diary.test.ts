import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, q } from "@/lib/db";
import { OPEN_MODELS } from "@/lib/ai";
import {
  addEntry, deleteEntry, getSummary, listEntries, parseSummaryJson, ratingCeiling, summarizeDay, summariesInRange,
} from "@/lib/services/diary";
import { add, ctxAt, resetDb } from "./helpers";

const GOOD = {
  headline: "Shipped the proposal and walked 9k steps",
  summary: "You finished the proposal draft and had a good call with Rahul.",
  rating: 7.46,
  mood: "focused",
  wins: ["Proposal draft done"],
  struggles: [],
  highlights: ["Rahul wants a revised quote by Friday", "", 42],
  tomorrow: ["Send Rahul the quote"],
  tags: ["Work", "health"],
};

function openRouterReply(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { "content-type": "application/json" } });
}

describe("ratingCeiling", () => {
  const counts = { open: 0, done: 5, progressed: 0, attempted: 0, skipped: 0, dropped: 0 };
  const strong = { worked: 480, unaccountedPct: 5, mustDoTotal: 2, mustDoHit: 2, steps: 10000, counts };

  it("leaves room only below 10 even on a perfect day", () => {
    expect(ratingCeiling(strong, 4, 8000)).toEqual({ cap: 9.5, reasons: [] });
  });

  it("takes the harshest applicable cap", () => {
    expect(ratingCeiling({ ...strong, worked: 0 }, 4, 8000).cap).toBe(3);
    expect(ratingCeiling({ ...strong, mustDoHit: 1 }, 4, 8000).cap).toBe(6);
    expect(ratingCeiling(strong, 0, 8000).cap).toBe(7);
    expect(ratingCeiling({ ...strong, steps: null }, 4, 8000)).toEqual({ cap: 8, reasons: ["step goal not met"] });
    expect(ratingCeiling({ ...strong, counts: { ...counts, done: 1, open: 4 } }, 4, 8000).cap).toBe(5);
  });
});

describe("parseSummaryJson", () => {
  it("reads a clean JSON answer and cleans the lists", () => {
    const s = parseSummaryJson(JSON.stringify(GOOD));
    expect(s.rating).toBe(7.5);
    expect(s.highlights).toEqual(["Rahul wants a revised quote by Friday"]);
    expect(s.tags).toEqual(["work", "health"]);
  });

  it("tolerates fences and chatter around the object", () => {
    const s = parseSummaryJson(`Sure! Here is the summary:\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\nHope that helps.`);
    expect(s.headline).toBe(GOOD.headline);
  });

  it("clamps the rating and rejects answers without a summary", () => {
    expect(parseSummaryJson(JSON.stringify({ ...GOOD, rating: 14 })).rating).toBe(10);
    expect(parseSummaryJson(JSON.stringify({ ...GOOD, rating: "n/a" })).rating).toBeNull();
    expect(() => parseSummaryJson(JSON.stringify({ ...GOOD, summary: "" }))).toThrow();
    expect(() => parseSummaryJson("no json here")).toThrow();
  });
});

describe("diary end to end (OpenRouter mocked)", () => {
  beforeAll(async () => {
    await resetDb();
    await listEntries("2000-01-01"); // creates the diary tables if this test DB predates them
    await q("truncate diary_entries, diary_summaries restart identity");
    process.env.OPENROUTER_API_KEY = "sk-or-TEST-not-real";
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    delete process.env.OPENROUTER_API_KEY;
    await closePool();
  });

  it("stores notes, sends them with the day's facts, and saves the summary", async () => {
    const ctx = await ctxAt("2026-09-24 21:00");
    await add(ctx, "Write proposal !!");
    await addEntry(ctx.today, "Met Rahul today, he wants a revised quote by Friday.", "voice");
    expect(await listEntries(ctx.today)).toHaveLength(1);

    const calls: { model: string; prompt: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ model: body.model, prompt: body.messages[1].content });
      // first free model is rate limited: the chain must fall through to the next one
      if (calls.length === 1) return openRouterReply("", 429);
      return openRouterReply(`\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``);
    }));

    const s = await summarizeDay(ctx, ctx.today);
    expect(calls.map((c) => c.model)).toEqual(OPEN_MODELS.slice(0, 2));
    expect(calls.every((c) => c.model.endsWith(":free"))).toBe(true);
    expect(calls[1].prompt).toContain("Rahul");
    expect(calls[1].prompt).toContain("[must-do] Write proposal");
    expect(s.model).toBe(OPEN_MODELS[1]);
    expect(s.entry_count).toBe(1);
    expect((await getSummary(ctx.today))?.headline).toBe(GOOD.headline);
    expect(await summariesInRange(ctx.today, ctx.today)).toHaveLength(1);
  });

  it("keeps notes when every model fails and says so plainly", async () => {
    const ctx = await ctxAt("2026-09-24 21:30");
    vi.stubGlobal("fetch", vi.fn(async () => openRouterReply("", 503)));
    await expect(summarizeDay(ctx, ctx.today)).rejects.toThrow(/could not summarise/);
    const notes = await listEntries(ctx.today);
    expect(notes).toHaveLength(1);
    await deleteEntry(notes[0].id);
    expect(await listEntries(ctx.today)).toHaveLength(0);
  });
});
