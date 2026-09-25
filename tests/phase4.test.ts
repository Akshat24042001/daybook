import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { handleUpdate } from "@/lib/telegram/bot";
import { runTick } from "@/lib/telegram/tick";
import { logTouch, setTouchInterval, snoozeTouch, touchStates } from "@/lib/services/keep-in-touch";
import { searchAll } from "@/lib/services/search";
import { exportAll, isExportTable, tableRows, toCsv } from "@/lib/services/export";
import { listEntries } from "@/lib/services/diary";
import { add, ctxAt, ist, resetDb } from "./helpers";
// @ts-expect-error plain .mjs helper shared with the dev script
import { startMockTelegram } from "./mock-telegram.mjs";

const CHAT = 4242;
const TZ = "Asia/Kolkata";
let mock: Awaited<ReturnType<typeof startMockTelegram>>;
let uid = 8000;

async function contact(name: string, createdIst: string): Promise<number> {
  const r = await q<{ id: number }>("insert into contacts (name, created_at) values ($1, $2) returning id", [name, ist(createdIst)]);
  return r[0].id;
}

beforeAll(async () => {
  mock = await startMockTelegram(0);
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN_NOT_REAL";
  process.env.TELEGRAM_API_BASE = mock.url;
  process.env.TELEGRAM_OWNER_CHAT_ID = "";
  process.env.APP_BASE_URL = "https://daybook.example.test";
  await touchStates("2026-09-19", TZ); // adds the keep-in-touch columns in an older test DB
  await listEntries("2000-01-01");
});
afterAll(async () => {
  await mock.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb();
  await q("truncate contacts, contact_touches, refs, diary_entries, diary_summaries restart identity cascade");
  mock.reset();
});

describe("keep in touch", () => {
  it("is due after 30 days by default, most overdue first; a touch or a snooze clears it", async () => {
    const a = await contact("Rahul", "2026-07-01 10:00");
    const b = await contact("Meera", "2026-08-10 10:00");
    await contact("New Person", "2026-09-10 10:00");

    let s = await touchStates("2026-09-19", TZ);
    expect(s.filter((x) => x.due).map((x) => x.name)).toEqual(["Rahul", "Meera"]);
    expect(s[0]).toMatchObject({ name: "Rahul", sinceDays: 80, overdueDays: 50, lastTouch: null });

    await logTouch(a, "2026-09-19", "call", "caught up on the quote");
    await snoozeTouch(b, "2026-09-19", 7);
    s = await touchStates("2026-09-19", TZ);
    expect(s.filter((x) => x.due)).toEqual([]);
    expect(s.find((x) => x.name === "Rahul")).toMatchObject({ lastTouch: "2026-09-19", lastKind: "call", sinceDays: 0 });

    // the snooze ends after a week
    expect((await touchStates("2026-09-27", TZ)).find((x) => x.name === "Meera")!.due).toBe(true);
  });

  it("respects a custom interval and 'never'", async () => {
    const a = await contact("Close Friend", "2026-09-05 10:00");
    await setTouchInterval(a, 7);
    expect((await touchStates("2026-09-19", TZ))[0].due).toBe(true);
    await setTouchInterval(a, null);
    expect((await touchStates("2026-09-19", TZ))[0]).toMatchObject({ due: false, overdueDays: null });
    await expect(setTouchInterval(a, 0)).rejects.toThrow();
  });

  it("Telegram nudges the 3 most overdue once a day; Talked moves on to the next person", async () => {
    await handleUpdate({ update_id: ++uid, message: { message_id: uid, chat: { id: CHAT, type: "private" }, text: "/start" } }, ist("2026-09-19 09:00"));
    for (const [n, d] of [["A", "2026-06-01"], ["B", "2026-06-15"], ["C", "2026-07-01"], ["D", "2026-07-15"]] as const) await contact(n, `${d} 10:00`);

    await runTick(ist("2026-09-19 11:05"));
    const nudges = mock.calls.filter((c: Record<string, any>) => c.method === "sendMessage" && c.text.includes("Keep in touch"));
    expect(nudges.length).toBe(1);
    expect(nudges[0].text).toMatch(/A.*\n.*B.*\n.*C/);
    expect(nudges[0].text).toMatch(/1 more/);
    await runTick(ist("2026-09-19 11:30"));
    expect(mock.calls.filter((c: Record<string, any>) => c.method === "sendMessage" && c.text.includes("Keep in touch")).length).toBe(1);

    const msg = [...mock.messages.values()].find((m: Record<string, any>) => m.text.includes("Keep in touch"));
    const talked = msg.reply_markup.inline_keyboard.flat().find((b: Record<string, any>) => b.text.startsWith("✓ Talked to A"));
    await handleUpdate(
      { update_id: ++uid, callback_query: { id: `cb${uid}`, from: { id: CHAT }, message: { message_id: msg.message_id, chat: { id: CHAT, type: "private" } }, data: talked.callback_data } },
      ist("2026-09-19 11:40"),
    );
    const edited = mock.messages.get(`${CHAT}:${msg.message_id}`);
    expect(edited.text).not.toMatch(/<b>A<\/b>/);
    expect(edited.text).toMatch(/<b>D<\/b>/);
    expect((await q("select kind from contact_touches"))).toEqual([{ kind: "other" }]);
  });
});

describe("search", () => {
  it("finds tasks, projects, contacts, references and diary across the app, starts-with first", async () => {
    const ctx = await ctxAt("2026-09-19 10:00");
    await add(ctx, "Aivaura: Send Rahul the quote");
    await add(ctx, "Call about Rahul's invoice");
    await contact("Rahul Mehta", "2026-09-01 10:00");
    await q("insert into refs (kind, title, body) values ('note', 'Pricing ideas', 'ask Rahul about tiers')");
    await q("insert into diary_entries (date, body, source) values ('2026-09-18', 'Long call with Rahul today', 'text')");

    const hits = await searchAll("rahul");
    const kinds = hits.map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(["task", "contact", "ref", "diary"]));
    expect(hits.find((h) => h.kind === "contact")).toMatchObject({ title: "Rahul Mehta", href: "/contacts?q=Rahul%20Mehta" });
    expect(hits.find((h) => h.kind === "diary")!.href).toBe("/diary?date=2026-09-18");
    expect((await searchAll("aiv")).find((h) => h.kind === "project")!.title).toBe("Aivaura");
    expect(await searchAll("r")).toEqual([]); // too short
    expect(await searchAll("100%_off")).toEqual([]); // wildcards are literal
  });
});

describe("export", () => {
  it("exports every table as JSON and any table as safe CSV", async () => {
    const ctx = await ctxAt("2026-09-19 10:00");
    await add(ctx, 'Quote "big" deal, v2');
    await add(ctx, "=HYPERLINK(evil)");
    const all = await exportAll();
    expect(all.tables.tasks.map((t) => t.title)).toEqual(['Quote "big" deal, v2', "=HYPERLINK(evil)"]);
    expect(Object.keys(all.tables)).not.toContain("notifications");

    const csv = toCsv((await tableRows("tasks"))!);
    expect(csv).toContain('"Quote ""big"" deal, v2"');
    expect(csv).toContain("'=HYPERLINK(evil)");
    expect(isExportTable("tg_updates")).toBe(false);
    expect(isExportTable("tasks")).toBe(true);
  });
});
