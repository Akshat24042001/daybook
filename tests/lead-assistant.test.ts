// The lead chat as an assistant: it rewrites the lead's draft in place (with undo), and finishing a move from the chat
// is logged like the buttons. Freelancer-style leads without a direct contact wait aside; disguised emails are read.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
import { one, q } from "@/lib/db";
import { applyStoredAction, proposeActions, undoStoredAction } from "@/lib/assistant/actions";
import { createDeal } from "@/lib/sales/deals";
import { contactsOf, deobfuscate, isBlindMarketplace, type RankItem } from "@/lib/sales/radar-rank";
import { makeCtx } from "@/lib/settings";
import { ist } from "./helpers";

beforeEach(async () => {
  await q("truncate sales_deals, sales_interactions, sales_moves, sales_radar_items, assistant_actions restart identity cascade");
});

describe("the chat changes the lead's draft", () => {
  it("replaces the radar lead's drafted message, and undo brings the old one back", async () => {
    const ctx = await makeCtx(ist("2026-11-21 16:00"));
    const rid = (await one<{ id: number }>("insert into sales_radar_items (url, url_hash, title, body, status) values ('https://x.example/1', 'h1', 'Need a bot', 'clinic', 'qualified') returning id"))!.id;
    const mv = (await one<{ id: number }>("insert into sales_moves (radar_item_id, kind, title, draft, channel, dedupe_key) values ($1, 'radar', 'Reply', 'Hi, long old message', 'email', $2) returning id", [rid, `radar:${rid}`]))!.id;
    const { items } = await proposeActions(ctx, null, [{ type: "set_lead_draft", radar_item_id: rid, message: "Hi, short new one" }]);
    expect(items[0].label).toMatch(/Draft updated/);
    await applyStoredAction(ctx, items[0].id);
    expect((await one<{ draft: string; channel: string }>("select draft, channel from sales_moves where id = $1", [mv]))).toEqual({ draft: "Hi, short new one", channel: "email" });
    await undoStoredAction(items[0].id);
    expect((await one<{ draft: string }>("select draft from sales_moves where id = $1", [mv]))!.draft).toBe("Hi, long old message");
  });

  it("on a deal with no draft yet, saves one ready to send", async () => {
    const ctx = await makeCtx(ist("2026-11-21 16:00"));
    const id = await createDeal({ title: "Bliss" });
    await q("delete from sales_moves where deal_id = $1", [id]);
    const { items } = await proposeActions(ctx, null, [{ type: "set_lead_draft", deal_id: id, message: "Hi Farah, here is the plan", channel: "whatsapp" }]);
    await applyStoredAction(ctx, items[0].id);
    expect(await one("select channel, draft from sales_moves where deal_id = $1 and status = 'open'", [id])).toEqual({ channel: "whatsapp", draft: "Hi Farah, here is the plan" });
  });

  it("a move finished from the chat is logged on the lead, like the button", async () => {
    const ctx = await makeCtx(ist("2026-11-21 16:00"));
    const id = await createDeal({ title: "Logged" });
    const mv = (await one<{ id: number }>("insert into sales_moves (deal_id, kind, title, created_by, dedupe_key) values ($1, 'custom', 'Call Farah about pricing', 'me', 'c1') returning id", [id]))!.id;
    const { items } = await proposeActions(ctx, null, [{ type: "finish_move", move_id: mv, status: "done" }]);
    await applyStoredAction(ctx, items[0].id);
    expect(await one("select channel, summary from sales_interactions where deal_id = $1", [id])).toEqual({ channel: "call", summary: "Done: Call Farah about pricing" });
  });
});

describe("leads you can actually reach", () => {
  const item = (o: Partial<RankItem>): RankItem => ({ id: 1, title: "Need an app", body: "", url: null, score: 70, posted_at: null, found_at: new Date().toISOString(), fit: null, ...o });

  it("a Freelancer post with no direct contact waits aside; one with a proven contact or an email in it does not", () => {
    expect(isBlindMarketplace(item({ url: "https://www.freelancer.com/projects/x" }))).toBe(true);
    expect(isBlindMarketplace(item({ url: "https://www.freelancer.com/projects/x", identity: { status: "found", emails: ["owner@shop.in"], phones: [] } }))).toBe(false);
    expect(isBlindMarketplace(item({ url: "https://www.freelancer.com/projects/x", body: "write to me at raj [at] shop [dot] in" }))).toBe(false);
    expect(isBlindMarketplace(item({ url: "https://news.ycombinator.com/item?id=1" }))).toBe(false);
  });

  it("reads emails people disguise in posts, and leaves ordinary sentences alone", () => {
    expect(deobfuscate("mail jane [at] acme [dot] com")).toBe("mail jane@acme.com");
    expect(deobfuscate("reach me: jane at acme dot io")).toBe("reach me: jane@acme.io");
    expect(deobfuscate("jane@acme dot co")).toBe("jane@acme.co");
    expect(deobfuscate("meet at the office at noon")).toBe("meet at the office at noon");
    expect(contactsOf(item({ body: "SEEKING FREELANCER | Remote | contact: hiring (at) shopwise (dot) io" })).emails).toEqual(["hiring@shopwise.io"]);
  });
});
