import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// the model is scripted; the bot, the database and the Telegram API mock are real
const replies: string[] = [];
vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  openModels: () => ["test/model:free"],
  OPEN_MODELS: ["test/model:free"],
  interpretTelegramMessage: vi.fn(async () => ({ kind: "unknown" })),
  interpretTaskInput: vi.fn(async (t: string) => t),
  chatWithModel: vi.fn(async () => {
    const text = replies.shift();
    if (text === undefined) throw new Error("no scripted reply left");
    return { text, model: "test/model:free" };
  }),
}));

import { closePool, q } from "@/lib/db";
import { handleUpdate } from "@/lib/telegram/bot";
import { blocksToTelegram, chunk, looksLikeQuestion, mdToTelegram } from "@/lib/telegram/assistant";
import { ist, resetDb } from "./helpers";
// @ts-expect-error plain .mjs helper shared with the dev script
import { startMockTelegram } from "./mock-telegram.mjs";

const CHAT = 4242;
let mock: Awaited<ReturnType<typeof startMockTelegram>>;
let uid = 5000;
type Call = Record<string, any>;

beforeAll(async () => {
  mock = await startMockTelegram(0);
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN_NOT_REAL";
  process.env.TELEGRAM_API_BASE = mock.url;
  process.env.TELEGRAM_OWNER_CHAT_ID = String(CHAT);
  process.env.APP_BASE_URL = "https://daybook.example.test";
});
afterAll(async () => {
  await mock.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb();
  await q("truncate assistant_chats, assistant_actions, assistant_memory restart identity cascade");
  mock.reset();
  replies.length = 0;
  await q("insert into projects (name) values ('Aivaura')");
  await q("insert into tasks (title, project_id) values ('Send GST invoice', 1), ('Pitch deck', 1)");
  await q("insert into day_entries (task_id, date, status) values (1, '2026-09-25', 'open'), (2, '2026-09-25', 'open')");
});

async function say(text: string, now = "2026-09-25 16:00", replyTo?: number) {
  uid++;
  await handleUpdate(
    { update_id: uid, message: { message_id: uid, chat: { id: CHAT, type: "private" }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: CHAT, type: "private" } } } : {}) } },
    ist(now),
  );
}

const buttons = (m: Call) => (m?.reply_markup?.inline_keyboard ?? []).flat() as Call[];
const messagesNow = () => [...mock.messages.values()] as Call[];

async function tap(label: string, now = "2026-09-25 16:05") {
  for (const m of messagesNow().reverse()) {
    const b = buttons(m).find((x) => x.callback_data && x.text.includes(label));
    if (b) {
      uid++;
      await handleUpdate(
        { update_id: uid, callback_query: { id: `cb${uid}`, from: { id: CHAT }, message: { message_id: m.message_id, chat: { id: CHAT, type: "private" } }, data: b.callback_data } },
        ist(now),
      );
      return m.message_id as number;
    }
  }
  throw new Error(`no button "${label}"`);
}

const pendingAnswer = (extra: Record<string, unknown> = {}) => [
  JSON.stringify({ queries: [{ name: "q1", why: "today's list", sql: "select entry_id, title, status from v_task_days where date = '2026-09-25' order by entry_id" }] }),
  JSON.stringify({
    answer: "Two things are **still open**:\n- Send GST invoice\n- Pitch deck\n\nTap to apply.",
    tables: [{ from: "q1", title: "Open today", columns: ["title", "status"] }],
    actions: [{ type: "task_status", entry_id: 1, status: "done" }],
    followups: ["Why do I keep delaying invoices?"],
    title: "Pending today",
    ...extra,
  }),
];

describe("telegram formatting", () => {
  it("turns markdown into Telegram HTML, tables into monospace, and escapes the rest", () => {
    expect(mdToTelegram("## Today\nYou did **3** of *5* <tasks>.\n\n- one\n  - two\n\n| a | b |\n|---|---|\n| x | 10 |")).toEqual([
      "<b>Today</b>\nYou did <b>3</b> of <i>5</i> &lt;tasks&gt;.",
      "• one\n   ◦ two",
      "<pre>a  b\nx  10</pre>",
    ]);
  });

  it("draws charts as text bars and tables as monospace blocks", () => {
    const [chart, table] = blocksToTelegram([
      { type: "chart", chart: "bar", title: "Worked", x: "date", y: ["h"], unit: "h", rows: [{ date: "2026-09-24", h: 4 }, { date: "2026-09-25", h: 8 }] },
      { type: "table", title: "Open", columns: ["title", "carry"], rows: [{ title: "Invoice", carry: 6 }], total: 20 },
    ]);
    expect(chart).toBe("📊 <b>Worked</b> (h)\n<pre>24 Sep ██████        4\n25 Sep ████████████  8</pre>");
    expect(table).toBe("📋 <b>Open</b> <i>(+19 more in the app)</i>\n<pre>title    carry\nInvoice      6</pre>");
  });

  it("splits long answers under Telegram's limit without cutting a block", () => {
    const parts = chunk(["a".repeat(3000), `<pre>${"b".repeat(2000)}</pre>`, "c"]);
    expect(parts.length).toBe(2);
    expect(parts[1].startsWith("<pre>")).toBe(true);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
  });

  it("knows questions from tasks", () => {
    for (const t of ["how was my week", "What's pending?", "am I sleeping enough", "kya pending hai", "invoice status?"]) expect(looksLikeQuestion(t)).toBe(true);
    for (const t of ["do laundry tomorrow", "Call mom @tom", "Aivaura: send proposal ~30m", "gym"]) expect(looksLikeQuestion(t)).toBe(false);
  });
});

describe("assistant in telegram", () => {
  it("answers a question in place of the Thinking message, with buttons that apply and undo", async () => {
    replies.push(...pendingAnswer());
    await say("what is pending today?");
    const answer = messagesNow().find((m) => m.text.includes("still open"))!;
    expect(answer.text).toContain("Two things are <b>still open</b>:\n• Send GST invoice");
    expect(answer.text).toContain("📋 <b>Open today</b>");
    const labels = buttons(answer).map((b) => b.text);
    expect(labels).toEqual(["▶ ✓ Done: Send GST invoice", "💬 Why do I keep delaying invoices?", "🆕 New chat", "Open in app"]);
    expect(buttons(answer).at(-1)!.url).toMatch(/^https:\/\/daybook\.example\.test\/assistant\?c=1(&t=|$)/);
    // no separate thinking message was left behind
    expect(messagesNow().filter((m) => m.text.startsWith("🤔"))).toEqual([]);

    await tap("Done: Send GST invoice");
    expect(await q("select status from day_entries where id = 1")).toEqual([{ status: "done" }]);
    expect(buttons(mock.messages.get(`${CHAT}:${answer.message_id}`)).map((b) => b.text)[0]).toBe("↩ Undo · ✓ Done: Send GST invoice");
    const toast = mock.calls.filter((c: Call) => c.method === "answerCallbackQuery").at(-1);
    expect(toast.text).toBe("✓ ✓ Done: Send GST invoice");

    await tap("Undo");
    expect(await q("select status from day_entries where id = 1")).toEqual([{ status: "open" }]);
    expect(buttons(mock.messages.get(`${CHAT}:${answer.message_id}`)).map((b) => b.text)[0]).toBe("▶ ✓ Done: Send GST invoice");
  });

  it("keeps one chat going: follow-up buttons and replies continue it, /new starts another", async () => {
    replies.push(...pendingAnswer());
    await say("what is pending today?");
    replies.push(JSON.stringify({ answer: "Because the invoice has no deadline.", actions: [{ type: "move_task", entry_id: 1, date: "tomorrow" }] }));
    await tap("Why do I keep delaying");
    const chats = await q<{ id: number; source: string; n: number }>(
      "select c.id, c.source, count(m.*)::int as n from assistant_chats c join assistant_messages m on m.chat_id = c.id group by c.id order by c.id",
    );
    expect(chats).toEqual([{ id: 1, source: "telegram", n: 4 }]);
    const second = messagesNow().find((m) => m.text.includes("no deadline"))!;
    expect(buttons(second)[0].text).toBe("▶ → Move Send GST invoice to tomorrow");

    replies.push(JSON.stringify({ answer: "Fair enough." }));
    await say("ok but I will do it today", "2026-09-25 16:10", second.message_id);
    expect((await q("select count(*)::int as n from assistant_messages where chat_id = 1"))[0]).toEqual({ n: 6 });

    await say("/new");
    replies.push(JSON.stringify({ answer: "Fresh start." }));
    await say("how am I doing?", "2026-09-25 16:20");
    expect((await q("select id, source from assistant_chats order by id"))).toEqual([{ id: 1, source: "telegram" }, { id: 2, source: "telegram" }]);

    await say("/chats");
    const list = messagesNow().at(-1)!;
    expect(list.text).toContain("Your chats");
    expect(buttons(list).map((b) => b.text).slice(0, 2)).toEqual(["● how am I doing?", "Pending today"]);
  });

  it("offers Done buttons on open tasks it looked at even when the model proposes none", async () => {
    replies.push(...pendingAnswer({ actions: [] }));
    await say("what is pending today?");
    const answer = messagesNow().find((m) => m.text.includes("still open"))!;
    expect(buttons(answer).map((b) => b.text).slice(0, 2)).toEqual(["▶ ✓ Done: Send GST invoice", "▶ ✓ Done: Pitch deck"]);
  });

  it("tells the owner when the models are down, instead of leaving Thinking… on screen", async () => {
    await say("how was my week?");
    const last = messagesNow().at(-1)!;
    expect(last.text).toMatch(/^⚠️ /);
  });
});
