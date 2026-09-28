import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// the model is scripted; everything else (SQL, views, storage) is real
const replies: string[] = [];
vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  openModels: () => ["test/model:free"],
  chatWithModel: vi.fn(async () => {
    const text = replies.shift();
    if (text === undefined) throw new Error("no scripted reply left");
    return { text, model: "test/model:free" };
  }),
}));

import { chatWithModel } from "@/lib/ai";
import { buildBlocks, parseReply, runAgent } from "@/lib/assistant/agent";
import { toFreeModels } from "@/lib/assistant/models";
import { checkSql, runReadOnlySql, SqlRejected } from "@/lib/assistant/sql";
import { closePool, q } from "@/lib/db";
import {
  addMemory, addMessage, cleanModel, createChat, deleteChat, deleteMemory, listChats, listMemory, messagesFor,
} from "@/lib/services/assistant";
import { ctxAt, ist, resetDb } from "./helpers";

const TZ = "Asia/Kolkata";

beforeEach(async () => {
  await resetDb();
  await q("truncate assistant_chats, assistant_memory restart identity cascade");
  replies.length = 0;
});
afterAll(closePool);

async function seedDay() {
  await q(`insert into projects (name, weekly_target_min) values ('Aivaura', 1200)`);
  await q(`insert into tasks (title, project_id) values ('Pitch deck', 1), ('Invoice', 1), ('Call bank', null)`);
  await q(`insert into day_entries (task_id, date, status, must_do, updated_at) values
    (1, '2026-09-25', 'done', true, $1), (2, '2026-09-25', 'open', false, now()), (3, '2026-09-25', 'skipped', false, now())`,
  [ist("2026-09-25 11:20")]);
  await q(`insert into time_logs (task_id, date, minutes) values (1, '2026-09-25', 90)`);
  await q(`insert into work_segments (date, kind, start_at, end_at) values
    ('2026-09-25', 'office', $1, $2), ('2026-09-25', 'meal', $2, $3), ('2026-09-25', 'office', $3, $4)`,
  [ist("2026-09-25 10:00"), ist("2026-09-25 13:00"), ist("2026-09-25 13:45"), ist("2026-09-25 18:15")]);
  await q(`insert into days (date, score, steps, sleep_minutes) values ('2026-09-25', 7.5, 9100, 400)`);
}

describe("assistant SQL guard", () => {
  it("allows plain reads, including words like delete inside strings", () => {
    expect(checkSql("select title from tasks where title ilike '%delete%';")).toBe("select title from tasks where title ilike '%delete%'");
    expect(() => checkSql("with x as (select 1) select * from x")).not.toThrow();
  });

  it.each([
    ["delete from tasks", /start with SELECT/],
    ["select 1; drop table tasks", /one statement/],
    ["select pg_sleep(10)", /pg_/],
    ["select * from information_schema.tables", /information_schema/],
    ["select telegram_chat_id from settings", /private/],
    ["select $$x$$", /dollar/],
    ["select * into t2 from tasks", /INTO/],
    ["select * from tasks for update", /only reading|locks/],
    ["with d as (delete from tasks returning *) select * from d", /only reading/],
  ])("rejects %s", (sql, why) => {
    expect(() => checkSql(sql)).toThrow(why);
  });

  it("refuses tables that are not on the allow list, found through the query plan", async () => {
    await expect(runReadOnlySql("select * from tg_updates", TZ)).rejects.toThrow(/not allowed to read: tg_updates/);
    await expect(runReadOnlySql("select * from pending_adds", TZ)).rejects.toBeInstanceOf(SqlRejected);
  });

  it("runs reads in local time with dates and times as plain text", async () => {
    await seedDay();
    const r = await runReadOnlySql(
      "select date, worked_min, logged_min, first_work_local, done, planned, not_today, score from v_daily where date = '2026-09-25'",
      TZ,
    );
    expect(r.rows).toEqual([{
      date: "2026-09-25", worked_min: 180 + 270, logged_min: 90, first_work_local: "2026-09-25 10:00",
      done: 1, planned: 3, not_today: 1, score: 7.5,
    }]);
  });

  it("the task-day view says when things were finished, in local time", async () => {
    await seedDay();
    const r = await runReadOnlySql(
      "select title, project, status, must_do, logged_min, extract(hour from status_changed_local)::int as hour from v_task_days where status = 'done'",
      TZ,
    );
    expect(r.rows).toEqual([{ title: "Pitch deck", project: "Aivaura", status: "done", must_do: true, logged_min: 90, hour: 11 }]);
  });

  it("refuses sequence side effects and leaves the data untouched", async () => {
    await seedDay();
    await expect(runReadOnlySql("select * from tasks where nextval('tasks_id_seq') > 0", TZ)).rejects.toThrow();
    expect((await q("select count(*)::int as n from tasks"))[0]).toEqual({ n: 3 });
  });
});

describe("assistant reply handling", () => {
  it("parses JSON wrapped in fences and thinking, with raw newlines in strings", () => {
    const p = parseReply('<think>hmm {not this}</think>\n```json\n{"answer": "line one\nline two", "charts": [],}\n```');
    expect(p).toEqual({ answer: "line one\nline two", charts: [] });
    expect(parseReply("no json here")).toBeNull();
  });

  it("builds charts and tables only from real query results", () => {
    const results = new Map([["q1", { columns: ["date", "worked_h", "note"], rows: [{ date: "2026-09-25", worked_h: 7.5, note: "x" }], truncated: false, ms: 1 }]]);
    const blocks = buildBlocks({
      stats: [{ label: "Worked", value: 7.5, tone: "good" }, { label: "", value: "x" }],
      charts: [{ from: "q1", type: "line", x: "date", y: ["worked_h"] }, { from: "nope", x: "a", y: ["b"] }, { from: "q1", x: "date", y: ["made_up"] }],
      tables: [{ from: "q1", columns: ["date", "ghost"] }],
      followups: ["Why?", ""],
    }, results);
    expect(blocks).toEqual([
      { type: "stats", items: [{ label: "Worked", value: "7.5", sub: undefined, tone: "good" }] },
      { type: "chart", chart: "line", title: "Chart", x: "date", y: ["worked_h"], rows: [{ date: "2026-09-25", worked_h: 7.5 }], unit: undefined },
      // a made-up y column falls back to the numeric columns that exist
      { type: "chart", chart: "bar", title: "Chart", x: "date", y: ["worked_h"], rows: [{ date: "2026-09-25", worked_h: 7.5 }], unit: undefined },
      { type: "table", title: "Results", columns: ["date"], rows: [{ date: "2026-09-25" }], total: 1 },
      { type: "followups", items: ["Why?"] },
    ]);
  });
});

describe("assistant loop", () => {
  it("queries, recovers from a failed query, then answers with a chart of the real rows", async () => {
    await seedDay();
    replies.push(
      JSON.stringify({ queries: [
        { name: "q1", why: "hours", sql: "select date, round(worked_min/60.0,1) as worked_h from v_daily order by date" },
        { name: "q2", why: "oops", sql: "select nope from v_daily" },
      ] }),
      JSON.stringify({ queries: [{ name: "q2", sql: "select count(*) as open from v_task_days where status = 'open'" }] }),
      JSON.stringify({
        answer: "You worked **7.5 h** on 25 Sep.",
        charts: [{ from: "q1", type: "bar", x: "date", y: ["worked_h"], title: "Worked", unit: "h" }],
        remember: ["Wants brutal honesty"], title: "Hours check",
      }),
    );
    const ctx = await ctxAt("2026-09-25 20:00");
    const seen: string[] = [];
    const r = await runAgent({
      ctx, question: "how many hours did I work?", history: [], memory: [], snapshot: "", deadline: Date.now() + 60_000,
      emit: { status: () => undefined, query: (s) => seen.push(`${s.name}:${s.error ? "err" : s.rows}`) },
    });
    expect(seen).toEqual(["q1:1", "q2:err", "q2:1"]);
    expect(r.content).toBe("You worked **7.5 h** on 25 Sep.");
    expect(r.blocks).toEqual([{ type: "chart", chart: "bar", title: "Worked", x: "date", y: ["worked_h"], rows: [{ date: "2026-09-25", worked_h: 7.5 }], unit: "h" }]);
    expect(r.remember).toEqual(["Wants brutal honesty"]);
    expect(r.title).toBe("Hours check");
    // the failed query's error went back to the model
    const calls = vi.mocked(chatWithModel).mock.calls;
    const fed = calls[calls.length - 2][0].at(-3)!.content; // results of round 1, before the corrected q2
    expect(fed).toMatch(/ERROR q2: column "nope" does not exist/);
  });

  it("asks once more for JSON, then shows plain text rather than nothing", async () => {
    replies.push("Sure! Here you go.", "Still not JSON.");
    const ctx = await ctxAt("2026-09-25 20:00");
    const r = await runAgent({
      ctx, question: "hi", history: [], memory: [], snapshot: "", deadline: Date.now() + 60_000,
      emit: { status: () => undefined, query: () => undefined },
    });
    expect(r.content).toBe("Still not JSON.");
    expect(r.blocks).toEqual([]);
  });
});

describe("assistant storage", () => {
  it("keeps chats with their messages and model, and memory without duplicates", async () => {
    const c = await createChat("  what is   pending today and why do I keep putting things off every single week  ", "z-ai/glm-5.2:free");
    expect(c.title).toMatch(/^what is pending today and why do I keep putting things .*…$/);
    expect(c.title.length).toBeLessThanOrEqual(60);
    expect(c.model).toBe("z-ai/glm-5.2:free");
    await addMessage(c.id, { role: "user", content: "hi" });
    await addMessage(c.id, { role: "assistant", content: "yo", blocks: [{ type: "followups", items: ["x"] }], steps: [{ name: "q1", sql: "select 1", rows: 1 }] });
    const msgs = await messagesFor(c.id);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([["user", "hi"], ["assistant", "yo"]]);
    expect(msgs[1].blocks).toEqual([{ type: "followups", items: ["x"] }]);

    expect(await addMemory(["Goal: 25 focused hours a week", "goal 25 focused hours a WEEK!", "Bed by 23:30"], c.id)).toBe(2);
    const mem = await listMemory();
    expect(mem.map((m) => m.fact)).toEqual(["Goal: 25 focused hours a week", "Bed by 23:30"]);
    await deleteMemory([mem[0].id]);
    expect((await listMemory()).length).toBe(1);

    await deleteChat(c.id);
    expect(await listChats()).toEqual([]);
    expect((await listMemory()).length).toBe(1); // memory outlives the chat it came from
  });

  it("only accepts model ids that look like OpenRouter ids", () => {
    expect(cleanModel("qwen/qwen3.8-27b:free")).toBe("qwen/qwen3.8-27b:free");
    expect(cleanModel("'; drop table x")).toBeNull();
    expect(cleanModel(null)).toBeNull();
  });
});

describe("free model catalogue", () => {
  it("keeps free text models, marks the ones Auto uses, and sorts them first", () => {
    const models = toFreeModels([
      { id: "a/big:free", name: "Big (free)", context_length: 200_000, created: 1_760_000_000, supported_parameters: ["tools", "reasoning"] },
      { id: "b/paid", name: "Paid", context_length: 1_000_000, pricing: { prompt: "0.000001", completion: "0.000002" } },
      { id: "c/small:free", name: "Small", context_length: 32_000 },
      { id: "d/img:free", name: "Image", architecture: { output_modalities: ["image"] } },
      { id: "openrouter/auto", name: "Auto router", pricing: { prompt: "0", completion: "0" } },
      { id: "stealth/bunny-alpha", name: "Stealth", pricing: { prompt: "0", completion: "0" } },
      { id: "vendor/music-preview", name: "Music", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["text", "audio"] } },
      { id: "nvidia/nemotron-content-safety:free", name: "Safety" },
    ], ["c/small:free"]);
    expect(models.map((m) => [m.id, m.name, m.recommended])).toEqual([
      ["c/small:free", "Small", true],
      ["a/big:free", "Big", false],
    ]);
    expect(models[1]).toMatchObject({ provider: "a", context: 200_000, tools: true, reasoning: true, created: "2025-10-09" });
  });
});
