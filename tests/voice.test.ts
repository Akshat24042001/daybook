import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, one, q } from "@/lib/db";
import { handleUpdate } from "@/lib/telegram/bot";
import { voiceToQuickAdd } from "@/lib/voice";
import { parseQuickAdd } from "@/lib/parser";
import { ist, resetDb, seedExercises } from "./helpers";
// @ts-expect-error plain .mjs helper shared with the dev script
import { startMockTelegram } from "./mock-telegram.mjs";

const CHAT = 4242;
const KEY = "dg_TESTKEY_should_never_leak";
let mock: Awaited<ReturnType<typeof startMockTelegram>>;
let uid = 9000;

beforeAll(async () => {
  mock = await startMockTelegram(0);
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN_NOT_REAL";
  process.env.TELEGRAM_API_BASE = mock.url;
  process.env.TELEGRAM_OWNER_CHAT_ID = "";
  process.env.APP_BASE_URL = "https://daybook.example.test";
  process.env.DEEPGRAM_API_KEY = KEY;
  process.env.DEEPGRAM_API_BASE = mock.url;
});
afterAll(async () => {
  await mock.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb();
  await seedExercises();
  mock.reset();
  process.env.DEEPGRAM_API_KEY = KEY;
});

type Call = Record<string, any>;
const sent = (): Call[] => mock.calls.filter((c: Call) => c.method === "sendMessage");
const last = (): Call => sent().at(-1)!;
const buttons = (m: Call) => (m.reply_markup?.inline_keyboard ?? []).flat();

async function say(text: string, now: string, replyTo?: number) {
  uid++;
  await handleUpdate(
    { update_id: uid, message: { message_id: uid, chat: { id: CHAT, type: "private" }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: CHAT, type: "private" } } } : {}) } },
    ist(now),
  );
}
async function voice(transcript: string, now: string, replyTo?: number) {
  mock.deepgram.transcript = transcript;
  uid++;
  await handleUpdate(
    { update_id: uid, message: { message_id: uid, chat: { id: CHAT, type: "private" }, voice: { file_id: "AwACAgQ", mime_type: "audio/ogg", duration: 4 }, ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: CHAT, type: "private" } } } : {}) } },
    ist(now),
  );
}
async function tap(label: string, now: string) {
  for (const m of [...mock.messages.values()].reverse()) {
    const b = buttons(m).find((x: Call) => x.callback_data && x.text.includes(label));
    if (b) {
      uid++;
      await handleUpdate(
        { update_id: uid, callback_query: { id: `cb${uid}`, from: { id: CHAT }, message: { message_id: m.message_id, chat: { id: CHAT, type: "private" } }, data: b.callback_data } },
        ist(now),
      );
      return;
    }
  }
  throw new Error(`no button "${label}"`);
}
const link = () => say("/start", "2026-09-19 09:00");

describe("voice to quick-add rules", () => {
  it("turns spoken phrases into syntax the parser understands", () => {
    const s = voiceToQuickAdd("Vector insights must do tomorrow at 5 pm estimate 2 hours");
    expect(s).toBe("Vector insights !! @tom @5pm ~2h");
    const p = parseQuickAdd(s, { now: ist("2026-09-19 14:00"), tz: "Asia/Kolkata", boundaryMin: 240 });
    expect(p).toMatchObject({ title: "Vector insights", mustDo: true, estimateMin: 120, targetDate: "2026-09-20" });
    expect(p.dueAt!.toISOString()).toBe("2026-09-20T11:30:00.000Z");
  });
  it("handles personal, ongoing, someday and weekdays; leaves plain sentences alone", () => {
    expect(voiceToQuickAdd("Buy medicines for mom personal")).toBe("Buy medicines for mom /p");
    expect(voiceToQuickAdd("Vector notifications ongoing")).toBe("Vector notifications >>");
    expect(voiceToQuickAdd("Read about robotics when free")).toBe("Read about robotics ?");
    expect(voiceToQuickAdd("Send the proposal on friday")).toBe("Send the proposal @fri");
    expect(voiceToQuickAdd("Send the quarterly report")).toBe("Send the quarterly report");
    expect(voiceToQuickAdd("Add call Karmit at 5:30 pm.")).toBe("call Karmit @5:30pm");
  });
});

describe("Telegram voice notes (Deepgram)", () => {
  it("transcribes with the server-side key, shows what it heard, then treats it like typed text", async () => {
    await link();
    await voice("Vector insights must do tomorrow at 5 pm estimate 2 hours", "2026-09-19 14:00");
    expect(mock.deepgram.calls.length).toBe(1);
    expect(mock.deepgram.calls[0].auth).toBe(`Token ${KEY}`);
    expect(mock.deepgram.calls[0].bytes).toBeGreaterThan(1000);
    const texts = sent().map((m) => m.text);
    expect(texts.some((t) => t.startsWith("🎙 Heard: “Vector insights must do tomorrow"))).toBe(true);
    const preview = last();
    expect(preview.text).toContain("Must-do");
    expect(preview.text).toContain("Estimate: 120 min");
    await tap("✅ Add", "2026-09-19 14:00");
    const t = await one<{ title: string; estimate_min: number }>("select title, estimate_min from tasks");
    expect(t).toMatchObject({ title: "Vector insights", estimate_min: 120 });
    expect((await one<{ date: string; must_do: boolean }>("select date, must_do from day_entries"))).toMatchObject({ date: "2026-09-20", must_do: true });
  });

  it("logs manual time from a voice note, calculating the hours", async () => {
    await link();
    await voice("I entered office at 10:45 and left at 1:30.", "2026-09-19 20:00");
    const preview = last();
    expect(preview.text).toContain("Log time for today?");
    expect(preview.text).toContain("At office 10:45 to 13:30 = 2h 45m");
    expect(preview.text).toContain("Worked: <b>2h 45m</b>");
    expect(buttons(preview).map((b: Call) => b.text)).toEqual(["✅ Save", "Add as task instead", "✗ Cancel"]);
    expect((await q("select * from work_segments")).length).toBe(0); // nothing saved before confirming
    await tap("✅ Save", "2026-09-19 20:01");
    const seg = await one<{ kind: string; start_at: Date; end_at: Date }>("select kind, start_at, end_at from work_segments");
    expect(seg!.kind).toBe("office");
    expect(seg!.start_at.toISOString()).toBe(ist("2026-09-19 10:45").toISOString());
    expect(seg!.end_at.toISOString()).toBe(ist("2026-09-19 13:30").toISOString());
    expect([...mock.messages.values()].at(-1)!.text).toMatch(/Logged\. Worked 2h 45m on today/);
  });

  it("typed manual time entry works the same, including lunch and yesterday", async () => {
    await link();
    await say("yesterday office 10:45 to 1:30, break 1:30 to 2:15, outside 2:15 to 6", "2026-09-19 20:00");
    expect(last().text).toContain("Log time for 2026-09-18?");
    expect(last().text).toContain("Worked: <b>6h 30m</b> (breaks not counted)");
    await tap("✅ Save", "2026-09-19 20:01");
    const rows = await q<{ kind: string; date: string }>("select kind, date from work_segments order by start_at");
    expect(rows).toEqual([
      { kind: "office", date: "2026-09-18" },
      { kind: "break", date: "2026-09-18" },
      { kind: "outside", date: "2026-09-18" },
    ]);
  });

  it("rejects an overlapping time entry without saving anything, and Cancel discards", async () => {
    await link();
    await say("office 10 to 1", "2026-09-19 20:00");
    await tap("✅ Save", "2026-09-19 20:00");
    await say("office 12 to 3", "2026-09-19 20:01");
    await tap("✅ Save", "2026-09-19 20:01");
    expect((await q("select * from work_segments")).length).toBe(1);
    await say("break 5 to 6", "2026-09-19 20:02");
    await tap("Cancel", "2026-09-19 20:02");
    expect((await q("select * from work_segments")).length).toBe(1);
  });

  it("\"Add as task instead\" hands the line to quick-add", async () => {
    await link();
    await say("Office cleaning 10 to 11", "2026-09-19 09:00");
    expect(last().text).toContain("Log time");
    await tap("Add as task instead", "2026-09-19 09:00");
    expect(last().text).toContain("Office cleaning");
    await tap("✅ Add", "2026-09-19 09:00");
    expect((await one<{ title: string }>("select title from tasks"))!.title).toBe("Office cleaning 10 to 11");
  });

  it("adds a spoken or typed note to a task via reply", async () => {
    await link();
    await say("Karmit callback !!", "2026-09-19 10:00");
    await tap("✅ Add", "2026-09-19 10:00");
    await tap("📝 Note", "2026-09-19 10:01");
    const prompt = last();
    expect(prompt.reply_markup).toMatchObject({ force_reply: true });
    await voice("Ask about the pricing revision and the new deadline.", "2026-09-19 10:02", prompt.message_id);
    const t = await one<{ notes: string }>("select notes from tasks");
    expect(t!.notes).toBe("[2026-09-19] Ask about the pricing revision and the new deadline.");
    await say("also bring the contract", "2026-09-19 10:03", prompt.message_id);
    const t2 = await one<{ notes: string }>("select notes from tasks");
    expect(t2!.notes).toBe("[2026-09-19] Ask about the pricing revision and the new deadline.\n[2026-09-19] also bring the contract");
  });

  it("explains missing keys and speech-service failures instead of failing silently", async () => {
    await link();
    delete process.env.DEEPGRAM_API_KEY;
    await voice("hello", "2026-09-19 10:00");
    expect(last().text).toMatch(/need a Deepgram key/);
    process.env.DEEPGRAM_API_KEY = KEY;
    mock.deepgram.status = 401;
    await voice("hello", "2026-09-19 10:01");
    expect(last().text).toMatch(/Deepgram key was rejected/);
    mock.deepgram.status = 200;
    await voice("", "2026-09-19 10:02");
    expect(last().text).toMatch(/could not make out any words/);
  });

  it("never sends the Deepgram key or bot token into any Telegram message", async () => {
    await link();
    mock.deepgram.status = 401;
    await voice("hello", "2026-09-19 10:01");
    const everything = JSON.stringify(mock.calls);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("TEST_TOKEN_NOT_REAL");
  });

  it("ignores voice notes from anyone but the owner", async () => {
    await link();
    mock.reset();
    uid++;
    await handleUpdate(
      { update_id: uid, message: { message_id: uid, chat: { id: 999, type: "private" }, voice: { file_id: "x" } } },
      ist("2026-09-19 10:00"),
    );
    expect(mock.calls.length).toBe(0);
    expect(mock.deepgram.calls.length).toBe(0);
  });
});
