// Whatever you tick as done on a lead is logged on its timeline: a move, the next step, a promise. Skip logs nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
import { one, q } from "@/lib/db";
import { createDeal } from "@/lib/sales/deals";
import { upsertPerson } from "@/lib/sales/identity";
import { channelIn, doneAs, isOwnWork } from "@/lib/sales/done";
import { commitmentAction, moveStatusAction, nextStepDoneAction } from "@/app/sales-actions";

beforeEach(async () => {
  await q("truncate sales_deals, sales_people, sales_companies, sales_interactions, sales_moves, sales_commitments, sales_radar_items restart identity cascade");
});

const log = (dealId: number) => q<{ channel: string; direction: string; summary: string; body: string | null; confidence: string }>(
  "select channel, direction, summary, body, confidence from sales_interactions where deal_id = $1 order by id", [dealId]);

describe("working out how a finished step goes on the timeline", () => {
  it("from the button used, the step's words, or where you last talked", () => {
    expect(channelIn("Send the WhatsApp with the demo link")).toBe("whatsapp");
    expect(channelIn("Call Rahul about pricing")).toBe("call");
    expect(channelIn("Email the quote")).toBe("email");
    expect(channelIn("Book the demo meeting")).toBe("meeting");
    expect(doneAs("Follow up", { target: "gmail" })).toEqual({ channel: "email", direction: "out" });
    expect(doneAs("Follow up", { lastChannel: "whatsapp" })).toEqual({ channel: "whatsapp", direction: "out" });
    expect(doneAs("Visit their office")).toEqual({ channel: "meeting", direction: "both" });
    // work only on your side is a note, not a touch
    expect(isOwnWork("Prepare the proposal deck")).toBe(true);
    expect(doneAs("Prepare the proposal deck")).toEqual({ channel: "note", direction: "internal" });
    expect(isOwnWork("Prepare and send the proposal")).toBe(false);
  });
});

describe("ticking things done logs them", () => {
  it("a move ticked done after sending on WhatsApp is logged on WhatsApp with the message; skip logs nothing", async () => {
    const pid = await upsertPerson({ name: "Krina Mehta", phone: "+919820011122" });
    const id = await createDeal({ person_id: pid, title: "Namlink" });
    const mv = (await one<{ id: number }>("insert into sales_moves (deal_id, kind, title, draft, channel, dedupe_key) values ($1,'follow_up','Follow up with Krina','Hi Krina, any update?','whatsapp','f1') returning id", [id]))!.id;
    const r = await moveStatusAction(mv, "done", "Hi Krina, any update on Namlink?");
    expect(r).toMatchObject({ ok: true, logged: "whatsapp", dealId: id });
    expect(await log(id)).toEqual([{ channel: "whatsapp", direction: "out", summary: "Done: Follow up with Krina", body: "Hi Krina, any update on Namlink?", confidence: "sure" }]);
    expect((await one<{ last_outbound_at: string | null }>("select last_outbound_at from sales_deals where id = $1", [id]))!.last_outbound_at).toBeTruthy();
    const sk = (await one<{ id: number }>("insert into sales_moves (deal_id, kind, title, dedupe_key) values ($1,'custom','Maybe call','f2') returning id", [id]))!.id;
    await moveStatusAction(sk, "skipped");
    expect(await log(id)).toHaveLength(1);
  });

  it("the deal's next step: a move for it, or Mark done, logs it and clears it", async () => {
    const id = await createDeal({ title: "Bliss" });
    await q("update sales_deals set next_action = 'Send the demo on WhatsApp', next_action_at = now() where id = $1", [id]);
    const mv = (await one<{ id: number }>("insert into sales_moves (deal_id, kind, title, dedupe_key) values ($1,'next_action','Send the demo on WhatsApp','na1') returning id", [id]))!.id;
    await moveStatusAction(mv, "done");
    expect((await log(id)).map((x) => [x.channel, x.summary])).toEqual([["whatsapp", "Done: Send the demo on WhatsApp"]]);
    expect((await one<{ next_action: string | null }>("select next_action from sales_deals where id = $1", [id]))!.next_action).toBeNull();

    await q("update sales_deals set next_action = 'Call to confirm the scope' where id = $1", [id]);
    const r = await nextStepDoneAction(id);
    expect(r).toMatchObject({ ok: true, logged: "call" });
    expect((await log(id)).at(-1)).toMatchObject({ channel: "call", summary: "Done: Call to confirm the scope" });
    expect((await one<{ next_action: string | null }>("select next_action from sales_deals where id = $1", [id]))!.next_action).toBeNull();
    expect(await nextStepDoneAction(id)).toMatchObject({ ok: false });
  });

  it("a step with no channel named goes where you last talked", async () => {
    const id = await createDeal({ title: "Panila" });
    await q("insert into sales_interactions (deal_id, channel, direction, body) values ($1, 'email', 'in', 'Send me details')", [id]);
    await q("update sales_deals set next_action = 'Share the case study' where id = $1", [id]);
    expect(await nextStepDoneAction(id)).toMatchObject({ logged: "email" });
  });

  it("a promise you kept is logged; theirs is a note", async () => {
    const id = await createDeal({ title: "Promises" });
    const mine = (await one<{ id: number }>("insert into sales_commitments (deal_id, owner, text) values ($1, 'me', 'Email the revised quote') returning id", [id]))!.id;
    const theirs = (await one<{ id: number }>("insert into sales_commitments (deal_id, owner, text) values ($1, 'them', 'Send their logo files') returning id", [id]))!.id;
    expect(await commitmentAction(mine, "done")).toMatchObject({ ok: true, logged: "email" });
    expect(await commitmentAction(theirs, "done")).toMatchObject({ ok: true, logged: "note" });
    expect((await log(id)).map((x) => [x.channel, x.direction, x.summary])).toEqual([
      ["email", "out", "Done: Email the revised quote"], ["note", "internal", "They delivered: Send their logo files"],
    ]);
    // ticking it again does not log twice
    await commitmentAction(mine, "open");
    await commitmentAction(mine, "done");
    expect(await log(id)).toHaveLength(2);
  });

  it("a radar lead's move ticked done becomes a deal with it logged", async () => {
    const it0 = (await one<{ id: number }>("insert into sales_radar_items (url, url_hash, title, body, status) values ('https://x.example/1', 'h1', 'Need a booking bot', 'For our clinic', 'qualified') returning id"))!.id;
    const mv = (await one<{ id: number }>("insert into sales_moves (radar_item_id, kind, title, draft, channel, dedupe_key) values ($1,'radar','Reply to the clinic','Hi, saw your post','linkedin',$2) returning id", [it0, `radar:${it0}`]))!.id;
    const r = await moveStatusAction(mv, "done");
    expect(r).toMatchObject({ ok: true, logged: "linkedin" });
    const item = (await one<{ deal_id: number | null; status: string }>("select deal_id, status from sales_radar_items where id = $1", [it0]))!;
    expect(item.deal_id).toBeTruthy();
    expect(item.status).toBe("contacted");
  });

  it("a debrief move is your own write-up: closing it is not a touch", async () => {
    const id = await createDeal({ title: "Debrief" });
    const mv = (await one<{ id: number }>("insert into sales_moves (deal_id, kind, title, dedupe_key) values ($1,'debrief','Debrief the meeting','d1') returning id", [id]))!.id;
    await moveStatusAction(mv, "done");
    expect(await log(id)).toEqual([]);
  });
});
