import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, one, q } from "@/lib/db";
import { handleUpdate, KEYS, PERSISTENT_KEYBOARD } from "@/lib/telegram/bot";
import { runTick } from "@/lib/telegram/tick";
import { getSettings } from "@/lib/settings";
import { ist, resetDb, seedExercises } from "./helpers";
// @ts-expect-error plain .mjs helper shared with the dev script
import { startMockTelegram } from "./mock-telegram.mjs";

const CHAT = 4242;
let mock: Awaited<ReturnType<typeof startMockTelegram>>;
let uid = 1000;

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
  mock.reset();
  process.env.TELEGRAM_OWNER_CHAT_ID = "";
});

type Call = Record<string, any>;
const sentMessages = (): Call[] => mock.calls.filter((c: Call) => c.method === "sendMessage");
const lastSent = (): Call => sentMessages().at(-1)!;
const allButtons = (m: Call) => (m.reply_markup?.inline_keyboard ?? []).flat();

async function say(text: string, now: string, chat = CHAT) {
  uid++;
  await handleUpdate({ update_id: uid, message: { message_id: uid, chat: { id: chat, type: "private" }, text } }, ist(now));
}

/** Presses the newest inline button whose label contains `label`, exactly as Telegram would deliver it. */
async function tap(label: string, now: string, chat = CHAT) {
  const msgs = [...mock.messages.values()].reverse();
  for (const m of msgs) {
    const b = allButtons(m).find((x: Call) => x.callback_data && x.text.includes(label));
    if (b) {
      uid++;
      await handleUpdate(
        { update_id: uid, callback_query: { id: `cb${uid}`, from: { id: chat }, message: { message_id: m.message_id, chat: { id: chat, type: "private" } }, data: b.callback_data } },
        ist(now),
      );
      return;
    }
  }
  throw new Error(`No button containing "${label}" found. Newest message: ${JSON.stringify(msgs[0]?.text)}`);
}

const currentText = (id: number) => mock.messages.get(`${CHAT}:${id}`)?.text as string;
async function link() {
  await say("/start", "2026-09-19 09:00");
}

describe("security and linking", () => {
  it("first /start stores the chat id and locks the bot; a persistent keyboard is sent", async () => {
    await say("/start", "2026-09-19 09:00");
    expect((await getSettings()).telegram_chat_id).toBe(CHAT);
    const m = lastSent();
    expect(m.reply_markup).toEqual(PERSISTENT_KEYBOARD);
    expect(m.reply_markup.is_persistent).toBe(true);
    expect(m.reply_markup.resize_keyboard).toBe(true);
  });

  it("ignores everyone else silently after the lock (no reply, no callback answer, no data change)", async () => {
    await link();
    mock.reset();
    await say("Buy milk", "2026-09-19 10:00", 999);
    await say(KEYS.office, "2026-09-19 10:00", 999);
    await say("/start", "2026-09-19 10:00", 999);
    expect(mock.calls.length).toBe(0);
    expect((await q("select * from tasks")).length).toBe(0);
    expect((await q("select * from work_segments")).length).toBe(0);
    expect((await getSettings()).telegram_chat_id).toBe(CHAT);
  });

  it("respects TELEGRAM_OWNER_CHAT_ID when set (a different chat cannot claim the bot)", async () => {
    process.env.TELEGRAM_OWNER_CHAT_ID = "777";
    await say("/start", "2026-09-19 09:00", CHAT);
    expect(mock.calls.length).toBe(0);
    await say("/start", "2026-09-19 09:00", 777);
    expect(lastSent().chat_id).toBe(777);
  });

  it("does not lock on a non-/start first message", async () => {
    await say("hello", "2026-09-19 09:00");
    expect((await getSettings()).telegram_chat_id).toBeNull();
    expect(mock.calls.length).toBe(0);
  });

  it("skips a re-delivered update instead of running it twice", async () => {
    await link();
    const upd = { update_id: 5555, message: { message_id: 1, chat: { id: CHAT, type: "private" }, text: KEYS.office } };
    await handleUpdate(upd, ist("2026-09-19 10:00"));
    await handleUpdate(upd, ist("2026-09-19 10:00"));
    expect((await q("select * from work_segments")).length).toBe(1);
    expect(sentMessages().filter((m) => /At office from/.test(m.text)).length).toBe(1);
  });
});

describe("state buttons and time tracking from Telegram", () => {
  it("switches segments and replies with confirmation plus worked time", async () => {
    await link();
    await say(KEYS.office, "2026-09-19 10:02");
    expect(lastSent().text).toBe("At office from 10:02. 0m so far.");
    await say(KEYS.break, "2026-09-19 13:16");
    expect(lastSent().text).toBe("Break from 13:16. 3h 14m so far.");
    await say(KEYS.office, "2026-09-19 14:16");
    await say(KEYS.outside, "2026-09-19 16:16");
    expect(lastSent().text).toBe("Out on work from 16:16. 5h 14m so far.");
    const segs = await q<{ kind: string }>("select kind from work_segments order by start_at");
    expect(segs.map((s) => s.kind)).toEqual(["office", "break", "office", "outside"]);
  });

  it("says so when the same state is tapped twice", async () => {
    await link();
    await say(KEYS.office, "2026-09-19 10:00");
    await say(KEYS.office, "2026-09-19 10:05");
    expect(lastSent().text).toMatch(/^Already at office since 10:00/);
    expect((await q("select * from work_segments")).length).toBe(1);
  });

  it("matches keyboard labels even without emoji variation selectors", async () => {
    await link();
    await say("🏢 At office".replace(/️/g, ""), "2026-09-19 10:00");
    expect((await q("select * from work_segments")).length).toBe(1);
  });
});

describe("free-text quick-add over the bot", () => {
  it("shows a parsed preview with the four actions and adds on [Add]", async () => {
    await link();
    await say("Vector: Insights !! ~2h @5pm", "2026-09-19 14:00");
    const m = lastSent();
    expect(m.text).toContain("Insights");
    expect(m.text).toContain("Project: Vector");
    expect(m.text).toContain("Must-do");
    const labels = allButtons(m).map((b: Call) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["✅ Add", "Tomorrow", "Someday", "✏️ Edit in app"]));
    await tap("✅ Add", "2026-09-19 14:00");
    const t = await one<{ title: string; estimate_min: number }>("select title, estimate_min from tasks");
    expect(t).toMatchObject({ title: "Insights", estimate_min: 120 });
    expect((await q("select * from day_entries where must_do")).length).toBe(1);
  });

  it("[Tomorrow] and [Someday] place the task accordingly", async () => {
    await link();
    await say("Write proposal", "2026-09-19 14:00");
    await tap("Tomorrow", "2026-09-19 14:00");
    expect((await one<{ date: string }>("select date from day_entries"))!.date).toBe("2026-09-20");
    await say("AI thought ?", "2026-09-19 14:00");
    await tap("Someday", "2026-09-19 14:00");
    expect((await one<{ type: string }>("select type from tasks where title = 'AI thought'"))!.type).toBe("someday");
  });

  it("offers the existing task first when a close match exists (duplicate guard)", async () => {
    await link();
    await say("Vector: Insights >>", "2026-09-19 10:00");
    await tap("✅ Add", "2026-09-19 10:00");
    await say("Vector: Insights", "2026-09-19 10:05");
    const m = lastSent();
    expect(m.text).toMatch(/similar task already exists/i);
    expect(allButtons(m)[0].text).toBe("➕ Add existing task to today");
    await tap("Add existing task", "2026-09-19 10:05");
    expect((await q("select * from tasks")).length).toBe(1);
  });

  // No must-do cap any more (commit d865bdc): a fourth must-do is simply added.
  it("adds any number of must-dos from Telegram", async () => {
    await link();
    for (const t of ["A !!", "B !!", "C !!", "D !!"]) {
      await say(t, "2026-09-19 10:00");
      await tap("✅ Add", "2026-09-19 10:00");
    }
    expect([...mock.messages.values()].at(-1)!.text).toMatch(/D.*added to today/);
    expect((await q("select * from day_entries where must_do")).length).toBe(4);
  });

  it("every button stays under Telegram's 64-byte callback_data limit (the mock enforces it)", async () => {
    await link();
    await say("Vector: Insights !! ~2h @5pm >> +HarshJoshi ^J", "2026-09-19 14:00");
    expect(mock.calls.filter((c: Call) => c.method === "sendMessage").length).toBeGreaterThan(0);
  });
});

describe("task action messages: status, minutes, attempted retry", () => {
  async function addMust(text: string, now: string) {
    await say(text, now);
    await tap("✅ Add", now);
  }

  it("Done then minutes; Progressed then minutes; Attempted then retry in 2h", async () => {
    await link();
    await addMust("Industry study !!", "2026-09-19 10:00");
    await addMust("Vector: Insights >> !!", "2026-09-19 10:00");
    await addMust("Karmit callback @5pm !!", "2026-09-19 10:00");
    await say(KEYS.today, "2026-09-19 10:30");
    const today = lastSent();
    expect(today.text).toContain("Must do");
    expect(allButtons(today).map((b: Call) => b.text)).toEqual(
      expect.arrayContaining(["⭐ Industry study", "⭐ Insights", "⭐ Karmit callback", "Open Today"]),
    );

    // 1. Done + 45m
    await tap("⭐ Industry study", "2026-09-19 10:31");
    let action = lastSent();
    expect(allButtons(action).map((b: Call) => b.text)).toEqual(
      ["✅ Done", "↗ Progressed", "📞 Attempted", "⏰ +30m", "🗓 Tomorrow", "✗ Skip", "✏️ Open in app", "📝 Note"],
    );
    await tap("✅ Done", "2026-09-19 10:32");
    expect(currentText(action.message_id)).toMatch(/How long/);
    expect(allButtons(mock.messages.get(`${CHAT}:${action.message_id}`)!).map((b: Call) => b.text)).toEqual(
      ["5", "10", "15", "30", "45", "60", "90", "120", "No time"],
    );
    await tap("45", "2026-09-19 10:33");
    expect(currentText(action.message_id)).toMatch(/Done · 45m logged/);

    // 2. Progressed + 60m
    await tap("⭐ Insights", "2026-09-19 11:00");
    await tap("↗ Progressed", "2026-09-19 11:00");
    await tap("60", "2026-09-19 11:01");

    // 3. Attempted -> asks for retry timing, does NOT add carry
    await tap("⭐ Karmit callback", "2026-09-19 12:00");
    action = lastSent();
    await tap("📞 Attempted", "2026-09-19 12:00");
    expect(currentText(action.message_id)).toMatch(/Retry when\?/);
    expect(allButtons(mock.messages.get(`${CHAT}:${action.message_id}`)!).map((b: Call) => b.text)).toEqual(
      ["In 2h", "Tomorrow AM", "Tomorrow PM", "Pick on web"],
    );
    await tap("In 2h", "2026-09-19 12:00");

    const rows = await q<{ title: string; status: string; carry_count: number }>(
      "select t.title, e.status, t.carry_count from day_entries e join tasks t on t.id = e.task_id order by t.id",
    );
    expect(rows).toEqual([
      { title: "Industry study", status: "done", carry_count: 0 },
      { title: "Insights", status: "progressed", carry_count: 0 },
      { title: "Karmit callback", status: "attempted", carry_count: 0 },
    ]);
    const logs = await q<{ minutes: number; source: string }>("select minutes, source from time_logs order by id");
    expect(logs).toEqual([{ minutes: 45, source: "telegram" }, { minutes: 60, source: "telegram" }]);

    // the retry ping arrives 2 hours later via the tick
    mock.calls.length = 0;
    await runTick(ist("2026-09-19 14:00"));
    expect(sentMessages().some((m) => /Retry: .*Karmit callback/.test(m.text))).toBe(true);
  });

  it("Skip adds to the carry count; +30m schedules one reminder; Tomorrow moves the entry", async () => {
    await link();
    await addMust("Vinit follow up !!", "2026-09-19 10:00");
    await say(KEYS.today, "2026-09-19 10:05");
    await tap("⭐ Vinit follow up", "2026-09-19 10:10");
    await tap("✗ Skip", "2026-09-19 10:10");
    expect((await one<{ carry_count: number }>("select carry_count from tasks"))!.carry_count).toBe(1);

    await say("Call Bob", "2026-09-19 10:20");
    await tap("✅ Add", "2026-09-19 10:20");
    await tap("⏰ +30m", "2026-09-19 10:21");
    const n = await one<{ scheduled_for: Date; status: string }>("select scheduled_for, status from notifications where kind = 'task_snooze'");
    expect(n!.status).toBe("scheduled");
    expect(n!.scheduled_for.toISOString()).toBe(ist("2026-09-19 10:51").toISOString());
    mock.calls.length = 0;
    await runTick(ist("2026-09-19 10:52"));
    expect(sentMessages().some((m) => /Reminder: .*Call Bob/.test(m.text))).toBe(true);
    await runTick(ist("2026-09-19 10:53")); // never twice
    expect(sentMessages().filter((m) => /Reminder: .*Call Bob/.test(m.text)).length).toBe(1);

    await say("Pay bill", "2026-09-19 11:00");
    await tap("✅ Add", "2026-09-19 11:00");
    await tap("🗓 Tomorrow", "2026-09-19 11:01");
    expect((await one<{ date: string }>("select e.date from day_entries e join tasks t on t.id = e.task_id where t.title = 'Pay bill'"))!.date).toBe("2026-09-20");
  });
});

describe("Phase 2 acceptance: a full day from Telegram alone", () => {
  it("state changes, 3 task updates with minutes, 5 exercise logs (one changed amount), score and steps; no duplicates on a repeated tick", async () => {
    await link();
    const addMust = async (text: string, now: string) => {
      await say(text, now);
      await tap("✅ Add", now);
    };

    // morning
    await addMust("Industry study !!", "2026-09-19 08:30");
    await addMust("Vector: Insights >> !!", "2026-09-19 08:30");
    await addMust("Karmit callback @5pm !!", "2026-09-19 08:30");
    await runTick(ist("2026-09-19 08:01")); // morning brief
    expect(sentMessages().some((m) => m.text.includes("Morning brief"))).toBe(true);

    // state changes
    await say(KEYS.office, "2026-09-19 10:02");
    await say(KEYS.break, "2026-09-19 13:00");
    await say(KEYS.office, "2026-09-19 14:00");

    // 3 task updates with minutes
    await tap("⭐ Industry study", "2026-09-19 10:30").catch(async () => {
      await say(KEYS.today, "2026-09-19 10:30");
      await tap("⭐ Industry study", "2026-09-19 10:30");
    });
    await tap("✅ Done", "2026-09-19 10:31");
    await tap("45", "2026-09-19 10:32");
    await tap("⭐ Insights", "2026-09-19 11:00");
    await tap("↗ Progressed", "2026-09-19 11:00");
    await tap("60", "2026-09-19 11:01");
    await tap("⭐ Karmit callback", "2026-09-19 12:00");
    await tap("✅ Done", "2026-09-19 12:00");
    await tap("30", "2026-09-19 12:01");

    // 5 exercise logs, one with a changed amount
    const slots = ["11:00", "11:30", "12:00", "12:30", "13:00"];
    for (let i = 0; i < slots.length; i++) {
      const at = `2026-09-19 ${slots[i]}`;
      await runTick(ist(at));
      const ping = sentMessages().filter((m) => m.text.includes(`${slots[i]} exercise`)).at(-1)!;
      expect(ping, `ping at ${slots[i]}`).toBeTruthy();
      if (i === 0) expect(allButtons(ping)[0].text).toBe("✅ Log 20 Squats");
      if (i === 1) {
        await tap("+5", at); // 20 -> 25, edited in place, no new message
        expect(allButtons(mock.messages.get(`${CHAT}:${ping.message_id}`)!)[0].text).toBe("✅ Log 25 Squats");
      }
      await tap("Log", at);
    }
    const ex = await q<{ status: string; amount: number; name: string }>(
      "select l.status, l.amount, t.name from exercise_logs l join exercise_types t on t.id = l.exercise_type_id order by l.slot_at",
    );
    expect(ex.length).toBe(5);
    expect(ex.every((e) => e.status === "done")).toBe(true);
    // 11:00 -> 20, 11:30 -> 25 (changed), and the next pings default to the last used amount
    expect(ex.map((e) => e.amount)).toEqual([20, 25, 25, 25, 25]);

    // day end, score and steps
    await say(KEYS.off, "2026-09-19 18:30");
    expect(sentMessages().some((m) => m.text.includes("Day ended. Worked 7h 28m"))).toBe(true); // 10:02-13:00 + 14:00-18:30
    await tap("7", "2026-09-19 18:31");
    await tap("7.5", "2026-09-19 18:31");
    await tap("8k", "2026-09-19 18:32");

    // the web app's data reflects every change
    const day = await one<{ score: number; steps: number; closed_at: Date }>("select score, steps, closed_at from days where date = '2026-09-19'");
    expect(day).toMatchObject({ score: 7.5, steps: 8000 });
    expect(day!.closed_at).not.toBeNull();
    const statuses = await q<{ status: string }>("select e.status from day_entries e join tasks t on t.id = e.task_id order by t.id");
    expect(statuses.map((s) => s.status)).toEqual(["done", "progressed", "done"]);
    const minutes = await q<{ minutes: number }>("select minutes from time_logs order by id");
    expect(minutes.map((m) => m.minutes)).toEqual([45, 60, 30]);
    const segs = await q<{ kind: string }>("select kind from work_segments order by start_at");
    expect(segs.map((s) => s.kind)).toEqual(["office", "break", "office"]);

    // forcing a tick to run twice never duplicates a message
    mock.calls.length = 0;
    const t = ist("2026-09-19 20:45");
    const first = await runTick(t);
    const afterFirst = sentMessages().length;
    const second = await runTick(t);
    expect(sentMessages().length).toBe(afterFirst);
    expect(second.sent).toEqual([]);
    expect(first.errors).toEqual([]);
    const dupes = await q("select kind, ref_id, scheduled_for, count(*) from notifications group by 1,2,3 having count(*) > 1");
    expect(dupes).toEqual([]);
  });
});

describe("scheduled notifications", () => {
  it("morning brief goes out once, with the unplanned line and an [Open] URL button", async () => {
    await link();
    await say("Old task", "2026-09-18 14:00");
    await tap("✅ Add", "2026-09-18 14:00");
    mock.reset();
    await runTick(ist("2026-09-19 08:00"));
    const brief = sentMessages().find((m) => m.text.includes("Morning brief"))!;
    expect(brief.text).toMatch(/You did not plan last night\. 1 task auto-carried\./);
    expect(brief.text).toContain("Old task");
    const urls = allButtons(brief).filter((b: Call) => b.url);
    expect(urls[0].url).toBe("https://daybook.example.test/plan?date=2026-09-19");
    expect(allButtons(brief).some((b: Call) => b.callback_data === "sw:office")).toBe(true);
    await runTick(ist("2026-09-19 08:01"));
    expect(sentMessages().filter((m) => m.text.includes("Morning brief")).length).toBe(1);
  });

  it("timed task: reminder N minutes before, then a second and final one at the time only if still open", async () => {
    await link();
    await say("Karmit callback @5pm", "2026-09-19 14:00");
    await tap("✅ Add", "2026-09-19 14:00");
    mock.reset();
    await runTick(ist("2026-09-19 16:44"));
    expect(sentMessages().filter((m) => /Karmit callback/.test(m.text)).length).toBe(0);
    await runTick(ist("2026-09-19 16:45"));
    expect(sentMessages().filter((m) => /In 15 min: .*Karmit callback/.test(m.text)).length).toBe(1);
    await runTick(ist("2026-09-19 17:00"));
    expect(sentMessages().filter((m) => /Now: .*Karmit callback/.test(m.text)).length).toBe(1);
    await runTick(ist("2026-09-19 17:00"));
    await runTick(ist("2026-09-19 17:01"));
    expect(sentMessages().filter((m) => /Karmit callback/.test(m.text)).length).toBe(2);
  });

  it("no second reminder if the task was handled after the first", async () => {
    await link();
    await say("Karmit callback @5pm", "2026-09-19 14:00");
    await tap("✅ Add", "2026-09-19 14:00");
    await runTick(ist("2026-09-19 16:45"));
    await tap("✅ Done", "2026-09-19 16:50");
    mock.calls.length = 0;
    await runTick(ist("2026-09-19 17:00"));
    expect(sentMessages().filter((m) => /Karmit callback/.test(m.text)).length).toBe(0);
  });

  it("quiet hours suppress messages between 22:45 and 07:45", async () => {
    await link();
    await say("Night call @11pm", "2026-09-19 21:00");
    await tap("✅ Add", "2026-09-19 21:00");
    mock.reset();
    await runTick(ist("2026-09-19 22:59")); // second reminder time 23:00 - first reminder 22:45 is quiet
    await runTick(ist("2026-09-19 22:46"));
    expect(sentMessages().length).toBe(0);
    const sup = await q("select * from notifications where status = 'suppressed'");
    expect(sup.length).toBeGreaterThan(0);
  });

  it("exercise pings: working days only, 09:30 to 20:30, paused via /pause; unanswered ping is edited to Missed", async () => {
    await link();
    await runTick(ist("2026-09-19 09:30"));
    expect(sentMessages().filter((m) => m.text.includes("09:30 exercise")).length).toBe(1);
    const first = sentMessages().find((m) => m.text.includes("09:30 exercise"))!;
    await runTick(ist("2026-09-19 10:00"));
    // the 09:30 ping was never answered: edited to Missed and logged as missed; pings never stack up
    expect(currentText(first.message_id)).toBe("💪 09:30 exercise: Missed.");
    expect((await q<{ status: string }>("select status from exercise_logs")).map((r) => r.status)).toEqual(["missed"]);
    expect(allButtons(mock.messages.get(`${CHAT}:${first.message_id}`)!).length).toBe(0);

    await runTick(ist("2026-09-19 20:20"));
    expect(sentMessages().filter((m) => m.text.includes("20:00 exercise") || m.text.includes("20:30 exercise")).length).toBe(0);
    await runTick(ist("2026-09-19 20:30"));
    expect(sentMessages().filter((m) => m.text.includes("20:30 exercise")).length).toBe(1);
    await runTick(ist("2026-09-19 21:00"));
    expect(sentMessages().filter((m) => m.text.includes("21:00 exercise")).length).toBe(0);

    // Sunday is not a working day
    mock.reset();
    await runTick(ist("2026-09-20 10:00"));
    expect(sentMessages().filter((m) => m.text.includes("exercise")).length).toBe(0);

    // /pause toggles
    await say("/pause", "2026-09-21 09:00");
    expect(lastSent().text).toMatch(/paused/);
    await runTick(ist("2026-09-21 10:00"));
    expect(sentMessages().filter((m) => m.text.includes("10:00 exercise")).length).toBe(0);
    await say("/pause", "2026-09-21 10:05");
    expect(lastSent().text).toMatch(/resumed/);
    await runTick(ist("2026-09-21 10:30"));
    expect(sentMessages().filter((m) => m.text.includes("10:30 exercise")).length).toBe(1);
  });

  it("exercise stepper: Change exercise shows the types and returns to the stepper", async () => {
    await link();
    await runTick(ist("2026-09-19 10:00"));
    await tap("Change exercise", "2026-09-19 10:00");
    const ping = sentMessages().find((m) => m.text.includes("10:00 exercise"))!;
    expect(currentText(ping.message_id)).toMatch(/Pick one/);
    await tap("Plank", "2026-09-19 10:00");
    expect(allButtons(mock.messages.get(`${CHAT}:${ping.message_id}`)!)[0].text).toBe("✅ Log 30s Plank");
    await tap("Skip", "2026-09-19 10:01");
    expect((await one<{ status: string }>("select status from exercise_logs"))!.status).toBe("skipped");
  });

  it("recap: sent once whether Day end is tapped or the 20:45 fallback fires first; score reminder only if missing", async () => {
    await link();
    await say(KEYS.office, "2026-09-19 10:00");
    // fallback fires (Day end never tapped)
    mock.reset();
    await runTick(ist("2026-09-19 20:45"));
    expect(sentMessages().filter((m) => m.text.includes("Recap")).length).toBe(1);
    // tapping Day end later must not send a second recap
    await say(KEYS.off, "2026-09-19 21:00");
    expect(sentMessages().filter((m) => m.text.includes("Recap")).length).toBe(1);
    expect(sentMessages().some((m) => /already sent/.test(m.text))).toBe(true);
    // 21:30 reminder because score is missing
    await runTick(ist("2026-09-19 21:30"));
    expect(sentMessages().filter((m) => m.text.includes("Score it out of 10")).length).toBe(1);
    // and not when the score has been entered
    await q("delete from notifications where kind = 'score_reminder'");
    await q("insert into days (date, score) values ('2026-09-19', 6) on conflict (date) do update set score = 6");
    mock.reset();
    await runTick(ist("2026-09-19 21:31"));
    expect(sentMessages().filter((m) => m.text.includes("Score it out of 10")).length).toBe(0);
  });

  it("22:30 open-segment check asks how to close a forgotten segment and the buttons work", async () => {
    await link();
    await say(KEYS.office, "2026-09-19 10:00");
    await runTick(ist("2026-09-19 22:30"));
    const prompt = sentMessages().find((m) => /still on/.test(m.text))!;
    expect(allButtons(prompt).map((b: Call) => b.text)).toEqual(["End now", "Ended 1h ago", "Ended 2h ago", "Fix on web"]);
    await tap("Ended 1h ago", "2026-09-19 22:31");
    const seg = await one<{ end_at: Date }>("select end_at from work_segments");
    expect(seg!.end_at.toISOString()).toBe(ist("2026-09-19 21:31").toISOString());
    expect(currentText(prompt.message_id)).toMatch(/Ended at 21:31/);
  });

  it("cadence: a 7-day task not done for 8 days nudges exactly once per day; snooze skips a day", async () => {
    await link();
    await say("LinkedIn post *7d", "2026-09-10 10:00");
    await tap("✅ Add", "2026-09-10 10:00");
    mock.reset();
    await runTick(ist("2026-09-16 11:00")); // 6 days: not yet
    expect(sentMessages().filter((m) => m.text.includes("LinkedIn post")).length).toBe(0);
    await runTick(ist("2026-09-17 11:00")); // 7 days
    await runTick(ist("2026-09-17 11:01")); // same day again: no second nudge
    expect(sentMessages().filter((m) => /7 of 7 days since last done/.test(m.text)).length).toBe(1);
    await runTick(ist("2026-09-18 11:00")); // 8 days
    await runTick(ist("2026-09-18 11:02"));
    expect(sentMessages().filter((m) => /8 of 7 days since last done/.test(m.text)).length).toBe(1);
    const nudge = sentMessages().find((m) => /8 of 7 days since last done/.test(m.text))!;
    expect(allButtons(nudge).map((b: Call) => b.text)).toEqual(["Do it today", "Snooze 1 day", "Open"]);
    await tap("Snooze 1 day", "2026-09-18 11:05");
    await runTick(ist("2026-09-19 11:00")); // snoozed: skipped
    expect(sentMessages().filter((m) => /9 of 7 days since last done/.test(m.text)).length).toBe(0);
    await runTick(ist("2026-09-20 11:00"));
    expect(sentMessages().filter((m) => /10 of 7 days since last done/.test(m.text)).length).toBe(1);
  });

  it("I'm free suggests up to 3 Someday/cadence items; Start marks Progressed and asks for minutes", async () => {
    await link();
    for (const t of ["AI thought ?", "AI companies jumping ?", "Read paper ?", "Fourth idea ?"]) {
      await say(t, "2026-09-19 14:00");
      await tap("✅ Add", "2026-09-19 14:00");
    }
    await say(KEYS.free, "2026-09-19 15:00");
    await tap("30m", "2026-09-19 15:00");
    const m = [...mock.messages.values()].at(-1)!;
    const starts = allButtons(m).filter((b: Call) => b.callback_data?.startsWith("fr:s:"));
    expect(starts.length).toBe(3);
    await tap("▶ AI thought", "2026-09-19 15:00");
    expect(currentText(m.message_id)).toMatch(/How long did you spend/);
    const e = await one<{ status: string }>("select e.status from day_entries e join tasks t on t.id = e.task_id where t.title = 'AI thought'");
    expect(e!.status).toBe("progressed");
    await tap("30", "2026-09-19 15:30");
    expect((await one<{ minutes: number }>("select minutes from time_logs"))!.minutes).toBe(30);
  });
});

describe("weekly review", () => {
  it("arrives Sunday 10:00 with facts and links", async () => {
    await link();
    await say(KEYS.office, "2026-09-14 10:00");
    await say(KEYS.off, "2026-09-14 18:00");
    await q("insert into days (date, score, steps) values ('2026-09-14', 7, 9000) on conflict (date) do update set score = 7, steps = 9000");
    mock.reset();
    await runTick(ist("2026-09-20 10:00"));
    const wr = sentMessages().find((m) => m.text.includes("Weekly review"))!;
    expect(wr.text).toMatch(/Hours worked: 8h 00m/);
    expect(wr.text).toMatch(/average score: 7\.0/);
    expect(allButtons(wr).map((b: Call) => b.text)).toEqual(["Open Stats", "Set week targets"]);
    await runTick(ist("2026-09-20 10:01"));
    expect(sentMessages().filter((m) => m.text.includes("Weekly review")).length).toBe(1);
  });
});
