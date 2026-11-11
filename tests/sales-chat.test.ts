import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// the model is scripted; the bot, the database and the Telegram API mock are real
const replies: string[] = [];
const seen: string[] = [];
vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  openModels: () => ["test/model:free"],
  OPEN_MODELS: ["test/model:free"],
  interpretTelegramMessage: vi.fn(async () => ({ kind: "unknown" })),
  interpretTaskInput: vi.fn(async (t: string) => t),
  chatWithModel: vi.fn(async (messages: { role: string; content: string }[]) => {
    seen.push(messages.map((m) => m.content).join("\n"));
    const text = replies.shift();
    if (text === undefined) throw new Error("no scripted reply left");
    return { text, model: "test/model:free" };
  }),
}));
vi.mock("@/lib/sales/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/sales/notify")>()), push: vi.fn(async () => 1) }));

import { closePool, one, q } from "@/lib/db";
import { applyStoredAction, proposeActions, undoStoredAction } from "@/lib/assistant/actions";
import { askAssistant } from "@/lib/assistant/run";
import { amountOf } from "@/lib/assistant/actions-sales";
import { createDeal } from "@/lib/sales/deals";
import { upsertPerson } from "@/lib/sales/identity";
import { dealBrief, findDeal, focusContext } from "@/lib/sales/chat-focus";
import { makeCtx } from "@/lib/settings";
import { handleUpdate } from "@/lib/telegram/bot";
import { parseLeadCommand } from "@/lib/telegram/leads";
import { ist, resetDb } from "./helpers";
// @ts-expect-error plain .mjs helper shared with the dev script
import { startMockTelegram } from "./mock-telegram.mjs";

const CHAT = 4343;
let mock: Awaited<ReturnType<typeof startMockTelegram>>;
let uid = 9000;
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

let deal = 0;
let person = 0;
beforeEach(async () => {
  await resetDb();
  await q("truncate assistant_chats, assistant_actions, assistant_memory restart identity cascade");
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_payments, sales_tg_prompts restart identity cascade`);
  mock.reset();
  replies.length = 0;
  seen.length = 0;
  person = await upsertPerson({ name: "Ravi Shah", company: "Shah Dental Clinics", email: "ravi@shahdental.in" });
  deal = await createDeal({ title: "Shah Dental: WhatsApp booking", person_id: person, value_amount: 150000, currency: "INR" } as Parameters<typeof createDeal>[0]);
  await q("insert into sales_interactions (deal_id, person_id, channel, direction, occurred_at, summary, source) values ($1,$2,'whatsapp','in',now() - interval '1 day','Asked if the bot can book across 3 branches','web')", [deal, person]);
});

async function say(text: string, replyTo?: number) {
  uid++;
  await handleUpdate(
    { update_id: uid, message: { message_id: uid, chat: { id: CHAT, type: "private" }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: CHAT, type: "private" } } } : {}) } },
    ist("2026-11-11 16:00"),
  );
}
const buttons = (m: Call) => (m?.reply_markup?.inline_keyboard ?? []).flat() as Call[];
const messagesNow = () => [...mock.messages.values()] as Call[];
async function tap(label: string) {
  for (const m of messagesNow().reverse()) {
    const b = buttons(m).find((x) => x.callback_data && x.text.includes(label));
    if (b) {
      uid++;
      await handleUpdate({ update_id: uid, callback_query: { id: `cb${uid}`, from: { id: CHAT }, message: { message_id: m.message_id, chat: { id: CHAT, type: "private" } }, data: b.callback_data } }, ist("2026-11-11 16:05"));
      return;
    }
  }
  throw new Error(`no button "${label}"`);
}
const answer = (o: Record<string, unknown>) => JSON.stringify({ title: "Shah Dental", ...o });

describe("small parts", () => {
  it("reads lead commands", () => {
    expect(parseLeadCommand("/leads")).toEqual({ list: true });
    expect(parseLeadCommand("/lead")).toEqual({ help: true });
    expect(parseLeadCommand("/lead Shah Dental")).toEqual({ who: "Shah Dental", say: null });
    expect(parseLeadCommand("/lead Shah Dental: budget 2 lakh, call Friday")).toEqual({ who: "Shah Dental", say: "budget 2 lakh, call Friday" });
    expect(parseLeadCommand("/lead Shah - what's happening?")).toEqual({ who: "Shah", say: "what's happening?" });
    expect(parseLeadCommand("lead: Ravi wants a website")).toBeNull(); // the capture, unchanged
  });
  it("reads Indian amounts", () => {
    expect(amountOf("2 lakh")).toBe(200000);
    expect(amountOf("1.5L")).toBe(150000);
    expect(amountOf("₹2,50,000")).toBe(250000);
    expect(amountOf("50k")).toBe(50000);
    expect(amountOf("1 crore")).toBe(10000000);
    expect(amountOf("soon")).toBeNull();
  });
  it("finds a lead by deal, contact or company words, and briefs the assistant on it", async () => {
    expect((await findDeal("shah"))?.id).toBe(deal);
    expect((await findDeal("Ravi"))?.id).toBe(deal);
    expect(await findDeal("nobody here")).toBeNull();
    const b = (await dealBrief(deal))!;
    expect(b).toContain(`LEAD deal_id=${deal}: Shah Dental: WhatsApp booking`);
    expect(b).toContain("ravi@shahdental.in");
    expect(b).toContain("Asked if the bot can book across 3 branches");
    expect(await focusContext({ deal_id: deal })).toMatch(/ONE LEAD/);
    expect(await focusContext({ area: "sales" })).toMatch(/SALES PIPELINE[\s\S]*Shah Dental/);
  });
});

describe("chat about a lead (web)", () => {
  it("knows the lead, proposes changes as buttons, applies on tap and undoes", async () => {
    replies.push(answer({
      answer: "Ravi asked about **3 branches**. Next: send the proposal.",
      actions: [
        { type: "update_deal", deal_id: deal, value: "2 lakh", next_step: "Send the proposal", next_step_date: "2026-11-14", pain: "Front desk misses calls" },
        { type: "add_deal_promise", deal_id: deal, owner: "me", text: "Send the proposal", due: "2026-11-14" },
        { type: "log_deal_note", deal_id: deal, text: "Spoke on the phone: wants all 3 branches live before Diwali", type2: "x" },
        { type: "update_lead_contact", deal_id: deal, phone: "+91 98200 11111", title: "Owner", is_decision_maker: true },
      ],
    }));
    const ctx = await makeCtx(ist("2026-11-11 16:00"));
    const r = await askAssistant({ chatId: null, message: "budget is 2 lakh, I'll send the proposal Friday", source: "web", deadline: Date.now() + 30_000, ctx, focus: { deal_id: deal } });
    // the model was told about this lead
    expect(seen[0]).toContain(`LEAD deal_id=${deal}`);
    expect((await one<{ focus: { deal_id: number } }>("select focus from assistant_chats where id = $1", [r.chat.id]))!.focus).toEqual({ deal_id: deal });
    const items = r.message.blocks.find((b) => b.type === "actions")!.items as { id: number; label: string }[];
    expect(items.map((i) => i.label)).toEqual([
      "✎ Shah Dental: WhatsApp booking", "📌 You promise: Send the proposal", "＋ Note on Shah Dental: WhatsApp booking", "✎ Ravi Shah",
    ]);
    // nothing changed yet
    expect(Number((await one<{ v: number }>("select value_amount as v from sales_deals where id = $1", [deal]))!.v)).toBe(150000);

    for (const i of items) await applyStoredAction(ctx, i.id);
    const d = (await one<Record<string, unknown>>("select value_amount, next_action, pain, next_action_at from sales_deals where id = $1", [deal]))!;
    expect(Number(d.value_amount)).toBe(200000);
    expect(d.next_action).toBe("Send the proposal");
    expect(d.pain).toBe("Front desk misses calls");
    expect(await one("select 1 from sales_commitments where deal_id = $1 and owner = 'me' and text = 'Send the proposal'", [deal])).toBeTruthy();
    expect(await one("select 1 from sales_interactions where deal_id = $1 and body like 'Spoke on the phone%'", [deal])).toBeTruthy();
    const p = (await one<{ phones: string[]; title: string; is_decision_maker: boolean }>("select phones, title, is_decision_maker from sales_people where id = $1", [person]))!;
    expect(p).toMatchObject({ phones: ["+91 98200 11111"], title: "Owner", is_decision_maker: true });
    // the change is in the deal's history, marked as made by the AI
    expect(await one("select 1 from sales_deal_events where deal_id = $1 and field = 'value_amount' and cause = 'ai'", [deal])).toBeTruthy();

    // undo puts the deal and the contact back, and removes the promise and the note
    for (const i of [...items].reverse()) await undoStoredAction(i.id);
    expect(Number((await one<{ v: number }>("select value_amount as v from sales_deals where id = $1", [deal]))!.v)).toBe(150000);
    expect(await one("select 1 from sales_commitments where deal_id = $1", [deal])).toBeNull();
    expect(await one("select 1 from sales_interactions where deal_id = $1 and body like 'Spoke on the phone%'", [deal])).toBeNull();
    expect((await one<{ phones: string[] }>("select phones from sales_people where id = $1", [person]))!.phones).toEqual([]);
  });

  it("refuses a bad change with a clear reason instead of applying it", async () => {
    const ctx = await makeCtx(ist("2026-11-11 16:00"));
    const { items, rejected } = await proposeActions(ctx, null, [
      { type: "update_deal", deal_id: deal, value: "a lot" },
      { type: "move_deal", deal_id: deal, stage: "the moon" },
      { type: "update_deal", deal_id: 99999, title: "x" },
      { type: "update_lead_contact", deal_id: deal, email: "not-an-email" },
    ]);
    expect(items).toEqual([]);
    expect(rejected.join("\n")).toMatch(/not an amount[\s\S]*no stage called[\s\S]*does not exist[\s\S]*not an email/);
  });

  it("moves a lead's stage and adds a new lead", async () => {
    const ctx = await makeCtx(ist("2026-11-11 16:00"));
    const { items } = await proposeActions(ctx, null, [
      { type: "move_deal", deal_id: deal, stage: "contacted", note: "first reply" },
      { type: "add_lead", person: "Neha Kapoor", company: "BrightSmile", value: "75k", requirements: "Instagram DMs" },
    ]);
    expect(items.map((i) => i.label)).toEqual([expect.stringMatching(/^→ Shah Dental: WhatsApp booking: /), "＋ New lead: BrightSmile: Neha Kapoor"]);
    for (const i of items) await applyStoredAction(ctx, i.id);
    expect((await one<{ role: string }>("select s.role from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [deal]))!.role).toBe("contacted");
    const n = (await one<{ id: number; value_amount: number }>("select id, value_amount from sales_deals where title = 'BrightSmile: Neha Kapoor'"))!;
    expect(Number(n.value_amount)).toBe(75000);
    await undoStoredAction(items[1].id);
    expect(await one("select 1 from sales_deals where id = $1", [n.id])).toBeNull();
  });
});

describe("leads in Telegram", () => {
  it("/leads lists them; a tap shows the card", async () => {
    await say("/leads");
    const list = messagesNow().at(-1)!;
    expect(list.text).toContain("Open leads");
    expect(buttons(list)[0].text).toContain("Shah Dental: WhatsApp booking");
    await tap("Shah Dental");
    const card = messagesNow().at(-1)!;
    expect(card.text).toContain("<b>Shah Dental: WhatsApp booking</b>");
    expect(card.text).toContain("Ravi Shah");
    expect(card.text).toContain("Reply to this card");
  });

  it("/lead name shows the card; replying to it updates the lead with buttons", async () => {
    await say("/lead shah");
    const card = messagesNow().at(-1)!;
    expect(card.text).toContain("Shah Dental: WhatsApp booking");
    replies.push(answer({ answer: "Updated the budget.", actions: [{ type: "update_deal", deal_id: deal, budget: "2 lakh" }] }));
    await say("their budget is 2 lakh", card.message_id);
    expect(seen.at(-1)).toContain(`LEAD deal_id=${deal}`);
    const reply = messagesNow().find((m) => m.text.includes("Updated the budget"))!;
    expect(buttons(reply)[0].text).toContain("✎ Shah Dental");
    await tap("✎ Shah Dental");
    expect((await one<{ budget: string }>("select budget from sales_deals where id = $1", [deal]))!.budget).toBe("2 lakh");
  });

  it("/lead name: question goes to the assistant about that lead", async () => {
    replies.push(answer({ answer: "They asked about 3 branches yesterday." }));
    await say("/lead Shah Dental: what's happening?");
    expect(seen.at(-1)).toContain("Asked if the bot can book across 3 branches");
    expect(messagesNow().some((m) => m.text.includes("They asked about 3 branches"))).toBe(true);
    const chat = (await one<{ focus: { deal_id: number } }>("select focus from assistant_chats order by id desc limit 1"))!;
    expect(chat.focus).toEqual({ deal_id: deal });
  });

  it("says so when no lead matches, and /lead alone explains itself", async () => {
    await say("/lead Nobody Inc");
    expect(messagesNow().at(-1)!.text).toContain("No lead matches");
    await say("/lead");
    expect(messagesNow().at(-1)!.text).toContain("/lead Shah Dental: budget 2 lakh");
  });
});
