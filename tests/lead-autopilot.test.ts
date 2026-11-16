// Done for you, and a lead chat that can change everything: after a log the AI writes the messages that are due,
// starts the research and writes a prep note for a demo or proposal; from the chat every change can be made (business,
// promises, moves, meetings, research, drafts, documents), each one undoable.
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushed: string[] = [];
vi.mock("@/lib/sales/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/sales/notify")>()), push: vi.fn(async (t: string) => { pushed.push(t); return 1; }) }));
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real, llmConfigured: () => true,
    llm: vi.fn(async () => ({ text: "## What they told us\nSmile Dental Care, 3 dentists, Andheri.\n## What to prepare\nA WhatsApp booking demo with their clinic name and timings.\n## Steps\n1. Build the flow (2 hours)\n## Confirm with them\nTheir booking software?\n## Message to send with it\nHi Neha, here is the demo built for Smile Dental Care.", model: "m" })),
  };
});

import { one, q } from "@/lib/db";
import { applyStoredAction, proposeActions, undoStoredAction } from "@/lib/assistant/actions";
import { dealAutopilot, dealPrep, prepKind } from "@/lib/sales/autopilot";
import { focusContext } from "@/lib/sales/chat-focus";
import { addCommitment, createDeal } from "@/lib/sales/deals";
import { upsertPerson } from "@/lib/sales/identity";
import { makeCtx } from "@/lib/settings";
import { ist } from "./helpers";

let deal: number;
let person: number;
beforeEach(async () => {
  pushed.length = 0;
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_interactions,
           sales_commitments, sales_moves, sales_meetings, sales_jobs, sales_docs, assistant_actions restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
  person = await upsertPerson({ name: "Dr Neha Mehta" });
  deal = await createDeal({ title: "Dr Mehta: clinic automation", person_id: person, source: "outbound" });
});

describe("done for you after a log", () => {
  it("knows which next steps it can prepare", () => {
    expect(prepKind("Prepare the demo with their clinic details and share it")).toBe("demo");
    expect(prepKind("Send the proposal with pricing")).toBe("proposal");
    expect(prepKind("Prepare a rollout plan and share it")).toBe("plan");
    expect(prepKind("Call her on Friday")).toBeNull();
  });

  it("writes the messages due, researches what was never researched, queues the prep note, and says what it did", async () => {
    await q("update sales_deals set next_action = 'Prepare the demo with the clinic details and share it' where id = $1", [deal]);
    await q("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1,'linkedin','in','Here are our clinic details', now() - interval '3 hours','web')", [deal]);
    const items = await dealAutopilot(deal, "web");
    const jobs = await q<{ kind: string }>("select kind from sales_jobs order by kind");
    expect(jobs.map((j) => j.kind)).toEqual(expect.arrayContaining(["draft_move", "enrich_person", "deal_prep"]));
    expect(items.map((x) => x.label).join(" | ")).toMatch(/Message being written: [\s\S]*Researching the contact[\s\S]*Writing a demo prep note/);
    const conv = (await one<{ c: { autopilot: { items: { label: string }[] } } }>("select conversation as c from sales_deals where id = $1", [deal]))!.c;
    expect(conv.autopilot.items.length).toBe(items.length);
  });

  it("the prep note: written from the record, saved on the lead (only you see it), told on Telegram, once", async () => {
    await q("update sales_deals set next_action = 'Prepare the demo with the clinic details and share it' where id = $1", [deal]);
    const id = await dealPrep(deal);
    const doc = await one<{ title: string; kind: string; internal: boolean; body: string }>("select title, kind, internal, body from sales_docs where id = $1", [id]);
    expect(doc).toMatchObject({ title: "Prep: Prepare the demo with the clinic details and share it", kind: "brief", internal: true });
    expect(doc!.body).toContain("## Message to send with it");
    expect(pushed[0]).toMatch(/Done for you/);
    expect(await dealPrep(deal)).toBeNull();
    const conv = (await one<{ c: { autopilot: { items: { label: string }[] } } }>("select conversation as c from sales_deals where id = $1", [deal]))!.c;
    expect(conv.autopilot.items.map((x) => x.label)).toContain("Prep note ready: Prepare the demo with the clinic details and share it");
  });
});

describe("the lead chat changes everything", () => {
  it("is told to act, with the ids it needs", async () => {
    const c = await addCommitment({ deal_id: deal, person_id: null, owner: "them", text: "share clinic details", due_at: null });
    const ctx = await focusContext({ deal_id: deal });
    expect(ctx).toContain("ACT, DO NOT JUST ADVISE");
    expect(ctx).toContain(`commitment_id=${c} They: share clinic details`);
    expect(ctx).toMatch(/update_company[\s\S]*close_promise[\s\S]*save_draft[\s\S]*do_everything/);
  });

  it("business, promise, move, meeting, research, draft, document, do everything: applied and undone", async () => {
    const promise = await addCommitment({ deal_id: deal, person_id: null, owner: "them", text: "share clinic details", due_at: null });
    const move = (await one<{ id: number }>("insert into sales_moves (deal_id, kind, title, dedupe_key, created_by) values ($1, 'custom', 'Ask for clinic details', 'x1', 'me') returning id", [deal]))!.id;
    const ctx = await makeCtx(ist("2026-11-16 10:00"));
    const { items, rejected } = await proposeActions(ctx, null, [
      { type: "update_company", deal_id: deal, name: "Smile Dental Care", website: "smiledentalcare.in", city: "Mumbai" },
      { type: "close_promise", commitment_id: promise, status: "done" },
      { type: "finish_move", move_id: move, status: "done" },
      { type: "book_meeting", deal_id: deal, date: "2026-11-19", time: "16:00", minutes: 30, title: "Demo for Smile Dental Care", place: "https://meet.example/x" },
      { type: "research_lead", deal_id: deal, what: "person" },
      { type: "save_draft", deal_id: deal, channel: "linkedin", message: "Hi Neha, thanks for the clinic details. The demo will be ready by Wednesday.", title: "Thank her and set the demo" },
      { type: "prepare_doc", deal_id: deal, title: "Demo plan", body: "## Flow\n1. Patient books on WhatsApp" },
    ]);
    expect(rejected).toEqual([]);
    expect(items.map((i) => i.label)).toEqual([
      "🏢 New business: Smile Dental Care", "✓ Kept: share clinic details", "✓ Done: Ask for clinic details", "📅 Demo for Smile Dental Care",
      "🔎 Research the contact", "✉️ Ready to send (linkedin): Thank her and set the demo", "📄 Demo plan",
    ]);
    for (const i of items) await applyStoredAction(ctx, i.id);
    const co = await one<{ name: string; website: string; city: string; domain: string }>("select c.name, c.website, c.city, c.domain from sales_deals d join sales_companies c on c.id = d.company_id where d.id = $1", [deal]);
    expect(co).toEqual({ name: "Smile Dental Care", website: "https://smiledentalcare.in", city: "Mumbai", domain: "smiledentalcare.in" });
    expect((await one<{ company_id: number }>("select company_id from sales_people where id = $1", [person]))!.company_id).toBeTruthy();
    expect((await one<{ status: string }>("select status from sales_commitments where id = $1", [promise]))!.status).toBe("done");
    expect((await one<{ status: string }>("select status from sales_moves where id = $1", [move]))!.status).toBe("done");
    expect(await one<{ at: string; place: string }>("select to_char(starts_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as at, place from sales_meetings where deal_id = $1", [deal])).toEqual({ at: "2026-11-19 16:00", place: "https://meet.example/x" });
    expect((await q<{ kind: string }>("select kind from sales_jobs order by kind")).map((j) => j.kind)).toEqual(expect.arrayContaining(["audit_website", "enrich_company", "enrich_person"]));
    expect(await one("select channel, draft, created_by from sales_moves where deal_id = $1 and kind = 'custom' and created_by = 'ai'", [deal])).toEqual({ channel: "linkedin", draft: "Hi Neha, thanks for the clinic details. The demo will be ready by Wednesday.", created_by: "ai" });
    expect(await one("select title, internal from sales_docs where deal_id = $1", [deal])).toEqual({ title: "Demo plan", internal: true });

    for (const i of [...items].reverse()) await undoStoredAction(i.id);
    expect((await one<{ company_id: number | null }>("select company_id from sales_deals where id = $1", [deal]))!.company_id).toBeNull();
    expect((await one<{ status: string }>("select status from sales_commitments where id = $1", [promise]))!.status).toBe("open");
    expect((await one<{ status: string }>("select status from sales_moves where id = $1", [move]))!.status).toBe("open");
    expect(await one("select 1 from sales_meetings where deal_id = $1", [deal])).toBeNull();
    expect(await one("select 1 from sales_docs where deal_id = $1", [deal])).toBeNull();
    expect(await one("select 1 from sales_moves where deal_id = $1 and kind = 'custom' and created_by = 'ai'", [deal])).toBeNull();
  });

  it("refuses what makes no sense, with a reason", async () => {
    const ctx = await makeCtx(ist("2026-11-16 10:00"));
    const { items, rejected } = await proposeActions(ctx, null, [
      { type: "update_company", deal_id: deal, city: "Mumbai" },
      { type: "update_company", deal_id: deal, website: "not a site" },
      { type: "close_promise", commitment_id: 9999 },
      { type: "save_draft", deal_id: deal },
    ]);
    expect(items).toEqual([]);
    expect(rejected.join("\n")).toMatch(/no business yet[\s\S]*not a website[\s\S]*open promise does not exist[\s\S]*needs the message/);
  });

  it("do everything: the same work as after a log, on request", async () => {
    await q("update sales_deals set next_action = 'Send the proposal' where id = $1", [deal]);
    const ctx = await makeCtx(ist("2026-11-16 10:00"));
    const { items } = await proposeActions(ctx, null, [{ type: "do_everything", deal_id: deal }]);
    const r = await applyStoredAction(ctx, items[0].id);
    expect(r.status).toBe("applied");
    expect((await q<{ kind: string }>("select kind from sales_jobs")).map((j) => j.kind)).toEqual(expect.arrayContaining(["enrich_person", "deal_prep"]));
  });
});
