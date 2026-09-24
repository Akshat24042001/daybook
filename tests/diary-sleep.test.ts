import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, one, q } from "@/lib/db";
import { handleUpdate, parseSleep } from "@/lib/telegram/bot";
import { runNightlyDiary, runTick } from "@/lib/telegram/tick";
import { listEntries } from "@/lib/services/diary";
import { add, ctxAt, ist, resetDb, seedExercises } from "./helpers";
// @ts-expect-error plain .mjs helper shared with the dev script
import { startMockTelegram } from "./mock-telegram.mjs";

const CHAT = 4242;
let mock: Awaited<ReturnType<typeof startMockTelegram>>;
let uid = 5000;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  mock = await startMockTelegram(0);
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN_NOT_REAL";
  process.env.TELEGRAM_API_BASE = mock.url;
  process.env.TELEGRAM_OWNER_CHAT_ID = "";
  process.env.APP_BASE_URL = "https://daybook.example.test";
});
afterAll(async () => {
  await mock.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb();
  await seedExercises();
  await listEntries("2000-01-01"); // creates the diary tables in an older test DB
  await q("truncate diary_entries, diary_summaries restart identity");
  mock.reset();
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(() => vi.unstubAllGlobals());

type Call = Record<string, any>;
const sentMessages = (): Call[] => mock.calls.filter((c: Call) => c.method === "sendMessage");
const lastSent = (): Call => sentMessages().at(-1)!;
const allButtons = (m: Call) => (m.reply_markup?.inline_keyboard ?? []).flat();

async function say(text: string, now: string, replyTo?: number) {
  uid++;
  await handleUpdate(
    {
      update_id: uid,
      message: {
        message_id: uid,
        chat: { id: CHAT, type: "private" },
        text,
        ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: CHAT, type: "private" } } } : {}),
      },
    },
    ist(now),
  );
}
async function tap(label: string, now: string) {
  for (const m of [...mock.messages.values()].reverse()) {
    const b = allButtons(m).find((x: Call) => x.callback_data && x.text.includes(label));
    if (b) {
      uid++;
      await handleUpdate(
        { update_id: uid, callback_query: { id: `cb${uid}`, from: { id: CHAT }, message: { message_id: m.message_id, chat: { id: CHAT, type: "private" } }, data: b.callback_data } },
        ist(now),
      );
      return;
    }
  }
  throw new Error(`No button containing "${label}"`);
}
const link = () => say("/start", "2026-09-19 09:00");

/** OpenRouter answers with a fixed summary; Telegram calls still reach the mock server. */
function stubAi() {
  process.env.OPENROUTER_API_KEY = "sk-or-TEST-not-real";
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("openrouter.ai")) {
      calls.push(JSON.parse(String(init?.body)).messages[1].content);
      const content = JSON.stringify({
        headline: "Steady day", summary: "You worked and rested.", rating: 6.5, mood: "calm",
        wins: [], struggles: [], highlights: [], tomorrow: [], tags: ["work"],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
    return realFetch(url, init);
  }));
  return calls;
}

describe("sleep", () => {
  it("understands the common ways of saying it, and ignores tasks without a number", () => {
    expect(parseSleep("slept 7h")).toBe(420);
    expect(parseSleep("Sleep 6.5")).toBe(390);
    expect(parseSleep("I slept 7 hours 30 min")).toBe(450);
    expect(parseSleep("slept 6h30m")).toBe(390);
    expect(parseSleep("8h sleep")).toBe(480);
    expect(parseSleep("sleep early tonight")).toBeNull();
    expect(parseSleep("sleep 30")).toBeNull(); // 30 hours is not a night
  });

  it("logs sleep from a Telegram message, then asks how well", async () => {
    await link();
    await say("slept 7h", "2026-09-19 08:00");
    expect(lastSent().text).toMatch(/7h.*sleep logged/);
    await tap("🙂", "2026-09-19 08:01");
    expect(await one("select sleep_minutes, sleep_quality from days where date = '2026-09-19'"))
      .toEqual({ sleep_minutes: 420, sleep_quality: 4 });
  });

  it("the morning brief offers one-tap sleep buttons until sleep is logged", async () => {
    await link();
    await runTick(ist("2026-09-19 08:00"));
    const brief = sentMessages().find((m) => m.text.includes("Morning brief"))!;
    expect(brief.text).toMatch(/How long did you sleep/);
    await tap("7½h", "2026-09-19 08:02");
    expect((await one<{ sleep_minutes: number }>("select sleep_minutes from days where date = '2026-09-19'"))!.sleep_minutes).toBe(450);
    // the sleep rows are gone from the brief, its other buttons stay
    const edited = mock.messages.get(`${CHAT}:${brief.message_id}`);
    expect(allButtons(edited).some((b: Call) => /h$/.test(b.text))).toBe(false);
  });
});

describe("diary from Telegram", () => {
  it("sends one evening prompt when nothing is written, and a reply lands in that day's diary", async () => {
    await link();
    await runTick(ist("2026-09-19 21:41"));
    const prompt = sentMessages().find((m) => m.text.includes("How did today go?"))!;
    expect(prompt.reply_markup).toMatchObject({ force_reply: true });
    await runTick(ist("2026-09-19 21:45")); // never twice
    expect(sentMessages().filter((m) => m.text.includes("How did today go?")).length).toBe(1);

    await say("Met Rahul about the quote, felt good.", "2026-09-19 21:50", prompt.message_id);
    const notes = await listEntries("2026-09-19");
    expect(notes.map((n) => [n.body, n.source])).toEqual([["Met Rahul about the quote, felt good.", "telegram"]]);
    expect(lastSent().text).toMatch(/Saved to your diary/);
  });

  it("skips the prompt on a day that already has a note", async () => {
    await link();
    await say("diary: lunch with the team", "2026-09-19 14:00");
    expect((await listEntries("2026-09-19")).map((n) => n.body)).toEqual(["lunch with the team"]);
    await runTick(ist("2026-09-19 21:41"));
    expect(sentMessages().some((m) => m.text.includes("How did today go?"))).toBe(false);
  });

  it("with AI on, a diary message is answered with the day's rating and headline", async () => {
    await link();
    stubAi();
    await say("/diary shipped the proposal", "2026-09-19 20:00");
    expect(lastSent().text).toMatch(/6\.5\/10.*Steady day/s);
  });
});

describe("nightly summary", () => {
  it("summarises yesterday even without notes, once, and skips empty days", async () => {
    const calls = stubAi();
    const ctx = await ctxAt("2026-09-18 10:00");
    await add(ctx, "Write proposal");

    expect(await runNightlyDiary(ist("2026-09-19 04:10"))).toBe("not-yet"); // before boundary + 30 min
    expect(await runNightlyDiary(ist("2026-09-19 04:31"))).toBe("summarized");
    expect(calls[0]).toContain("Write proposal");
    expect(calls[0]).toContain("(no diary notes for this day)");
    expect(await one("select headline from diary_summaries where date = '2026-09-18'")).toEqual({ headline: "Steady day" });
    expect(await runNightlyDiary(ist("2026-09-19 05:00"))).toBe("done-already");

    // a day with nothing tracked is not summarised
    expect(await runNightlyDiary(ist("2026-09-21 04:31"))).toBe("empty");
  });

  it("does nothing without an AI key", async () => {
    expect(await runNightlyDiary(ist("2026-09-19 04:31"))).toBe("ai-off");
  });
});
