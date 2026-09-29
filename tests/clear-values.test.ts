import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyStoredAction, proposeActions, undoStoredAction } from "@/lib/assistant/actions";
import { closePool, q } from "@/lib/db";
import { setSleep } from "@/lib/services/days";
import { handleUpdate } from "@/lib/telegram/bot";
import { ctxAt, ist, resetDb } from "./helpers";
// @ts-expect-error plain .mjs helper shared with the dev script
import { startMockTelegram } from "./mock-telegram.mjs";

let mock: Awaited<ReturnType<typeof startMockTelegram>>;
let uid = 9000;
beforeAll(async () => {
  mock = await startMockTelegram(0);
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN_NOT_REAL";
  process.env.TELEGRAM_API_BASE = mock.url;
  process.env.TELEGRAM_OWNER_CHAT_ID = "4242";
});
afterAll(async () => {
  await mock.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb();
  await q("truncate assistant_actions restart identity cascade");
  mock.reset();
});

const day = async () => (await q("select score, steps, sleep_minutes, sleep_quality from days where date = '2026-09-25'"))[0];

describe("clearing a value entered by mistake", () => {
  it("clearing sleep also clears its quality", async () => {
    await setSleep("2026-09-25", 420, 4);
    await setSleep("2026-09-25", null);
    expect(await day()).toMatchObject({ sleep_minutes: null, sleep_quality: null });
  });

  it("the assistant can clear a value, and undo puts it back", async () => {
    await q("insert into days (date, score, steps) values ('2026-09-25', 7.5, 9100)");
    const ctx = await ctxAt("2026-09-25 21:00");
    const { items } = await proposeActions(ctx, null, [{ type: "set_day", field: "score", value: "clear" }]);
    expect(items[0].label).toBe("⌫ Clear score");
    await applyStoredAction(ctx, items[0].id);
    expect(await day()).toMatchObject({ score: null, steps: 9100 });
    await undoStoredAction(items[0].id);
    expect(await day()).toMatchObject({ score: 7.5, steps: 9100 });
  });

  it("Telegram: /steps clear, /score clear, /sleep clear", async () => {
    await q("insert into days (date, score, steps, sleep_minutes, sleep_quality) values ('2026-09-25', 8, 12000, 390, 2)");
    for (const cmd of ["/steps clear", "/score reset", "/sleep clear"]) {
      uid++;
      await handleUpdate({ update_id: uid, message: { message_id: uid, chat: { id: 4242, type: "private" }, text: cmd } }, ist("2026-09-25 21:00"));
    }
    expect(await day()).toEqual({ score: null, steps: null, sleep_minutes: null, sleep_quality: null });
    expect(mock.calls.filter((c: Record<string, unknown>) => c.method === "sendMessage").map((c: Record<string, unknown>) => c.text)).toEqual([
      "🧹 Today's steps cleared.", "🧹 Today's score cleared.", "🧹 Today's sleep cleared.",
    ]);
  });
});
