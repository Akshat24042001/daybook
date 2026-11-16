// The agent knows what it can and cannot do: only channels you can really use, what is known and not known, how the
// lead behaves; screenshots keep their real dates and platform, an old one never moves the lead backwards, a chat with
// someone else is flagged, AI-filled fields stay fresh while yours are never touched, and "not now" parks the lead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, q } from "@/lib/db";
import { createDeal, getDeal, updateDeal } from "@/lib/sales/deals";
import { upsertPerson } from "@/lib/sales/identity";
import { capture, differentPerson, messageAt, processCapture, screenHeader } from "@/lib/sales/ingest";
import { dealContext } from "@/lib/sales/context";
import { dealReach, engagementFrom, engagementLine, knowledgeLines, onlyReachable, reachFrom, reachLines } from "@/lib/sales/reach";
import { refreshMoves } from "@/lib/sales/moves";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
const H = 3_600_000;

describe("only channels you can use", () => {
  it("a chat you already have counts; a missing profile does not", () => {
    const r = reachFrom({ phones: [], emails: [], linkedin: null, threads: [{ channel: "whatsapp", direction: "in", at: new Date() }] });
    expect(r.channels.map((c) => c.channel)).toEqual(["whatsapp"]);
    expect(r.best).toBe("whatsapp");
    expect(r.missing.map((m) => m.channel)).toEqual(["email", "linkedin"]);
    expect(reachLines(r)).toMatch(/CANNOT USE YET: email[\s\S]*LinkedIn \(no LinkedIn profile saved and no LinkedIn conversation\)/);
  });
  it("the next message goes where they last wrote, among what you have", () => {
    const r = reachFrom({ phones: ["+91 98200 11111"], emails: ["a@b.in"], threads: [{ channel: "email", direction: "in", at: "2026-11-15" }, { channel: "whatsapp", direction: "out", at: "2026-11-14" }] });
    expect(r.best).toBe("email");
    expect(reachFrom({}).best).toBeNull();
    expect(reachLines(reachFrom({}))).toContain("NONE");
  });
  it("a step on a channel you cannot use is pointed at one you can; getting the contact stays", () => {
    const r = reachFrom({ phones: ["+91 98200 11111"] });
    expect(onlyReachable("Message her on LinkedIn about the demo", r)).toBe("Message her on WhatsApp about the demo");
    expect(onlyReachable("Email the proposal", r)).toBe("WhatsApp the proposal");
    expect(onlyReachable("Find her LinkedIn profile", r)).toBe("Find her LinkedIn profile");
    expect(onlyReachable("Ask for her email", r)).toBe("Ask for her email");
    expect(onlyReachable("Message her on LinkedIn", reachFrom({}))).toBe("Message her on LinkedIn");
  });
  it("knowledge: what is known, and what is not, with the rule", () => {
    const k = knowledgeLines({ contact: "Dr Neha", company: "Smile Dental", website: "smile.in", researched: false });
    expect(k).toMatch(/WHAT YOU KNOW: Contact's name: Dr Neha; Their business: Smile Dental; Website: smile.in/);
    expect(k).toMatch(/WHAT YOU DO NOT KNOW YET: Their role, Who decides, Industry[\s\S]*Budget, Timeline[\s\S]*not been researched/);
    expect(k).toContain("Never state or assume anything in the second list");
  });
});

describe("how they engage", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const at = (h: number) => new Date(now - h * H).toISOString();
  it("reply speed, who is waiting, warming or cooling", () => {
    const e = engagementFrom([
      { direction: "out", at: at(200) }, { direction: "in", at: at(180) }, // 20h
      { direction: "out", at: at(150) }, { direction: "in", at: at(130) }, // 20h
      { direction: "out", at: at(100) }, { direction: "in", at: at(98) }, // 2h: faster
    ], now);
    expect(e).toMatchObject({ their_replies: 3, their_median_h: 20, their_last_h: 2, waiting_on: "you", trend: "warming", days_since_they_wrote: 4 });
    expect(engagementLine(e)).toMatch(/they have written 3 times; they usually answer in about 20 hours; last time about 2 hours; answering faster than before \(warming\); you owe them a reply for 4 days/);
    expect(engagementLine(engagementFrom([], now))).toBe("HOW THEY ENGAGE: no conversation logged yet.");
  });
});

describe("screenshot times and platform", () => {
  const now = new Date("2026-11-16T06:30:00Z"); // 12:00 IST
  it("local times read in your timezone; never in the future", () => {
    expect(messageAt("2026-11-15 10:42", "Asia/Kolkata", now)).toBe("2026-11-15T05:12:00.000Z");
    expect(messageAt("2026-11-16T09:00:00+05:30", "Asia/Kolkata", now)).toBe("2026-11-16T03:30:00.000Z");
    expect(messageAt("2026-12-20 10:00", "Asia/Kolkata", now)).toBe("2025-12-20T04:30:00.000Z"); // the year was misread
    expect(messageAt("2026-11-16 18:00", "Asia/Kolkata", now)).toBeNull(); // later today: not possible
    expect(messageAt("2026-12-01 11:00", "Asia/Kolkata", now, true)).toBe("2026-12-01T05:30:00.000Z"); // a meeting can be ahead
    expect(messageAt("yesterday", "Asia/Kolkata", now)).toBeNull();
  });
  it("the app and who it is with, from the reader's first line", () => {
    expect(screenHeader("CHAT WITH: +91 98200 11111, APP: WhatsApp\n[10:42] THEM: hi")).toEqual({ app: "whatsapp", chatWith: "+91 98200 11111" });
    expect(screenHeader("CHAT WITH: Dr Neha Mehta, APP: LinkedIn messaging")).toEqual({ app: "linkedin", chatWith: "Dr Neha Mehta" });
    expect(screenHeader("FROM: a@b.in")).toEqual({ app: null, chatWith: null });
    expect(differentPerson("Rahul Verma", "Dr Neha Mehta")).toBe(true);
    expect(differentPerson("Neha", "Dr Neha Mehta")).toBe(false);
    expect(differentPerson("+91 98200 11111", "Dr Neha Mehta")).toBe(false);
  });
});

function ai(file: unknown, read = "CHAT WITH: +91 98200 11111, APP: WhatsApp\n[Yesterday]\n[10:00] THEM (Neha): hi") {
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    const vision = String(init.body).includes("image_url");
    return new Response(JSON.stringify({ choices: [{ message: { content: vision ? read : JSON.stringify(file) } }] }), { status: 200 });
  }));
}

describe("a screenshot filed onto a lead", () => {
  let deal: number;
  let person: number;
  beforeEach(async () => {
    await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
             sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_jobs restart identity cascade`);
    await q("update sales_settings set config = '{}'::jsonb");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubEnv("AI_VISION_MODELS", "acme/vision:free");
    vi.stubEnv("AI_MODELS", "acme/text:free");
    (globalThis as unknown as { __llmCool?: Map<string, number> }).__llmCool?.clear();
    person = await upsertPerson({ name: "Dr Neha Mehta" });
    deal = await createDeal({ title: "Dr Mehta: clinic automation", person_id: person, source: "outbound" });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const day = (n: number, hh = 10) => { const d = new Date(Date.now() - n * 86_400_000); return `${d.toISOString().slice(0, 10)} ${String(hh).padStart(2, "0")}:00`; };

  it("the conversation keeps its back and forth and real times; the platform and the number come from the screen", async () => {
    ai({ kind: "conversation", is_sales_related: true, channel: "linkedin", people: [{ name: "Dr Neha Mehta" }], summary: "x",
      messages: [{ from: "them", at: day(3), text: "Can you build a booking bot?" }, { from: "me", at: day(3, 11), text: "Yes, sharing details." }, { from: "them", at: day(1), text: "Here are the clinic details" }] });
    const id = await capture({ source: "web", text: "", images: [IMG], hints: { deal_id: deal } }, { now: true });
    const r = await processCapture(id);
    const rows = await q<{ direction: string; channel: string; body: string; at: string }>("select direction, channel, body, to_char(occurred_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as at from sales_interactions where deal_id = $1 order by occurred_at", [deal]);
    expect(rows.map((x) => [x.direction, x.at])).toEqual([["in", day(3)], ["out", day(3, 11)], ["in", day(1)]]);
    expect(rows.every((x) => x.channel === "whatsapp")).toBe(true); // the screen said WhatsApp, the AI said LinkedIn
    expect((await one<{ phones: string[] }>("select phones from sales_people where id = $1", [person]))!.phones).toEqual(["+91 98200 11111"]);
    expect(r.filled).toContain("Person: Phone (from the chat)");
    // and so the reply goes on WhatsApp, never LinkedIn
    await refreshMoves(deal);
    expect((await one<{ channel: string }>("select channel from sales_moves where deal_id = $1 and kind = 'reply'", [deal]))!.channel).toBe("whatsapp");
    expect((await dealReach(deal)).missing.map((m) => m.channel)).toEqual(["email", "linkedin"]);
  });

  it("an older screenshot fills the history but leaves the next step and stage alone", async () => {
    await q("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1,'whatsapp','in','Latest: send the demo', now() - interval '2 hours','web')", [deal]);
    await q("update sales_deals set next_action = 'Send the demo' where id = $1", [deal]);
    ai({ kind: "conversation", is_sales_related: true, people: [{ name: "Dr Neha Mehta" }], summary: "old", next_step: "Ask for the clinic details", stage_signal: "not_now",
      messages: [{ from: "them", at: day(9), text: "Old message about pricing" }, { from: "me", at: day(9, 11), text: "Old reply" }] });
    const id = await capture({ source: "web", text: "", images: [IMG], hints: { deal_id: deal } }, { now: true });
    const r = await processCapture(id);
    expect(r.note).toMatch(/older than what is already logged/);
    const d = await getDeal(deal);
    expect(d!.next_action).toBe("Send the demo");
    expect(d!.stage_role).not.toBe("nurture");
    expect(await one("select 1 from sales_interactions where deal_id = $1 and body like '%Old message about pricing%'", [deal])).toBeTruthy();
  });

  it("a chat with someone else is flagged", async () => {
    ai({ kind: "conversation", is_sales_related: true, people: [{ name: "Rahul Verma" }], summary: "x", messages: [{ from: "them", at: day(0, 9), text: "Hello" }] }, "CHAT WITH: Rahul Verma, APP: WhatsApp\n[09:00] THEM (Rahul): Hello");
    const id = await capture({ source: "web", text: "", images: [IMG], hints: { deal_id: deal } }, { now: true });
    const r = await processCapture(id);
    expect(r.warning).toMatch(/looks like it is with "Rahul Verma", but this lead's contact is Dr Neha Mehta/);
  });

  it("fields the AI filled are updated; fields you set are never touched", async () => {
    await updateDeal(deal, { budget: "1 lakh", pain: "Missed calls" }, { cause: "ai" });
    await updateDeal(deal, { timeline: "by Diwali" }, { cause: "manual" });
    ai({ kind: "conversation", is_sales_related: true, people: [{ name: "Dr Neha Mehta" }], summary: "x", budget: "3 lakh", timeline: "by March", details: { pain: "Missed calls and no-shows" },
      messages: [{ from: "them", at: day(0, 9), text: "Budget is now 3 lakh, we need it by March" }] });
    const id = await capture({ source: "web", text: "", images: [IMG], hints: { deal_id: deal } }, { now: true });
    await processCapture(id);
    const d = await getDeal(deal);
    expect(d!.budget).toBe("3 lakh");
    expect(d!.pain).toBe("Missed calls and no-shows");
    expect(d!.timeline).toBe("by Diwali");
  });

  it('"not now, come back in March" parks it in Nurture with the date', async () => {
    ai({ kind: "conversation", is_sales_related: true, people: [{ name: "Dr Neha Mehta" }], summary: "x", stage_signal: "not_now", stage_detail: "busy until March", revisit_on: "2027-03-01",
      messages: [{ from: "them", at: day(0, 9), text: "Not now, come back in March" }] });
    const id = await capture({ source: "web", text: "", images: [IMG], hints: { deal_id: deal } }, { now: true });
    const r = await processCapture(id);
    const d = await getDeal(deal);
    expect(d!.stage_role).toBe("nurture");
    expect(String(d!.revisit_on).slice(0, 10)).toBe("2027-03-01");
    expect(r.moved).toMatch(/Nurture/);
  });

  it("drafts and the chat are told the channels, the unknowns and the behaviour", async () => {
    await q("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1,'whatsapp','in','hi', now() - interval '1 day','web')", [deal]);
    const ctx = await dealContext(deal);
    expect(ctx).toMatch(/HOW YOU CAN REACH THEM: WhatsApp via the WhatsApp chat you already have/);
    expect(ctx).toMatch(/CANNOT USE YET: email[\s\S]*LinkedIn/);
    expect(ctx).toMatch(/WHAT YOU DO NOT KNOW YET: [\s\S]*Budget/);
    expect(ctx).toMatch(/HOW THEY ENGAGE: they have written 1 time/);
  });
});
