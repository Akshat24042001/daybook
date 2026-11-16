// A log moves the lead on: the screenshot reader knows who the owner is (LinkedIn shows names, not sides), filing sees
// the deal as it stands (next step, open promises with ids, the conversation), the business and website they share
// become the deal's company with research started, the next step gets a date, kept promises close. Drafts read the
// whole history and the stage, cold first messages are complete, and nothing unsupported gets through.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, q } from "@/lib/db";
import { addCommitment, createDeal, getDeal } from "@/lib/sales/deals";
import { capture, processCapture } from "@/lib/sales/ingest";
import { readPrompt } from "@/lib/sales/read-screens";
import { dealContext } from "@/lib/sales/context";
import { dealBrief } from "@/lib/sales/chat-focus";
import { draftMessage, STYLE_GUIDE, unsupported } from "@/lib/sales/voice";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

function ai(answer: (o: { vision: boolean; prompt: string; n: number }) => string) {
  const calls: { vision: boolean; prompt: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: unknown[] };
    const prompt = JSON.stringify(body.messages);
    const vision = prompt.includes("image_url");
    calls.push({ vision, prompt });
    return new Response(JSON.stringify({ choices: [{ message: { content: answer({ vision, prompt, n: calls.length }) } }] }), { status: 200 });
  }));
  return calls;
}

beforeEach(async () => {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_jobs restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.stubEnv("AI_VISION_MODELS", "acme/vision-a:free");
  vi.stubEnv("AI_MODELS", "acme/text-a:free");
  (globalThis as unknown as { __llmCool?: Map<string, number> }).__llmCool?.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("reading a screenshot: who wrote what", () => {
  it("the reader is told who the owner is, and that names decide before sides", () => {
    const p = readPrompt({ name: "Akshat Shah", aliases: ["Akshat", "You", "Me"] });
    expect(p).toContain("THE PHONE / ACCOUNT OWNER is Akshat Shah (also shown as: Akshat)");
    expect(p).toMatch(/On LinkedIn every message group starts with the sender's name/);
    expect(p).toMatch(/If that name is Akshat Shah or Akshat, it is ME; any other name is THEM/);
    expect(p).toMatch(/Only when no name or label is shown: right side/);
    expect(p).toContain("UNSURE");
  });
});

describe("a log moves the lead on", () => {
  it("the clinic and website become the deal's company, research starts, the next step moves on with a date, the kept promise closes", async () => {
    const dealId = await createDeal({ title: "Dr Mehta: clinic automation", source: "outbound" });
    await q("update sales_deals set next_action = 'Ask for the clinic details and schedule the demo', next_action_at = now() where id = $1", [dealId]);
    const promise = await addCommitment({ deal_id: dealId, person_id: null, owner: "them", text: "share the clinic details", due_at: null });
    await q("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1, 'linkedin', 'out', 'Could you share your clinic details so I can tailor the demo?', now() - interval '1 day', 'web')", [dealId]);
    const calls = ai(({ vision }) => vision
      ? "CHAT WITH: Dr Neha Mehta, APP: LinkedIn\n[10:02] ME (Akshat Shah): Could you share your clinic details so I can tailor the demo?\n[11:40] THEM (Dr Neha Mehta): Sure, I work at Smile Dental Care, Andheri. Website: smiledentalcare.in"
      : JSON.stringify({
        kind: "conversation", is_sales_related: true, channel: "linkedin", direction: "in",
        people: [{ name: "Dr Neha Mehta", company: "Smile Dental Care", title: "Dentist" }],
        company: { name: "Smile Dental Care", website: "https://smiledentalcare.in", city: "Mumbai" },
        messages: [
          { from: "me", text: "Could you share your clinic details so I can tailor the demo?" },
          { from: "them", text: "Sure, I work at Smile Dental Care, Andheri. Website: smiledentalcare.in" },
        ],
        summary: "She shared her clinic, Smile Dental Care, and its website.",
        next_step: "Prepare the demo with Smile Dental Care's details and share it", next_step_due: "2026-11-18",
        done_commitment_ids: [promise],
      }));
    const id = await capture({ source: "web", text: "", images: [IMG], hints: { deal_id: dealId } }, { now: true });
    const res = await processCapture(id);

    // the reader knew the owner; filing saw the next step, the promise id and the conversation so far
    expect(calls.find((c) => c.vision)!.prompt).toContain("THE PHONE / ACCOUNT OWNER is Akshat Shah");
    const filing = calls.find((c) => !c.vision)!.prompt;
    expect(filing).toContain("CURRENT NEXT STEP: Ask for the clinic details and schedule the demo");
    expect(filing).toContain(`id ${promise}: they promised share the clinic details`);
    expect(filing).toContain("FROM ME: Could you share your clinic details");
    expect(filing).toMatch(/THE NEXT STEP MOVES ON/);

    const d = await getDeal(dealId);
    expect(d!.next_action).toBe("Prepare the demo with Smile Dental Care's details and share it");
    expect(new Date(d!.next_action_at!).toISOString().slice(0, 10)).toBe("2026-11-18");
    const co = await one<{ name: string; website: string; domain: string }>("select c.name, c.website, c.domain from sales_deals d join sales_companies c on c.id = d.company_id where d.id = $1", [dealId]);
    expect(co).toEqual({ name: "Smile Dental Care", website: "https://smiledentalcare.in", domain: "smiledentalcare.in" });
    const jobs = (await q<{ kind: string }>("select kind from sales_jobs where kind in ('enrich_company','audit_website') order by kind")).map((j) => j.kind);
    expect(jobs).toEqual(["audit_website", "enrich_company"]);
    expect((await one<{ status: string }>("select status from sales_commitments where id = $1", [promise]))!.status).toBe("done");
    expect(res.filled).toEqual(expect.arrayContaining(["Deal: Company", "Company research started", "1 promise marked done"]));
    // the old message was not logged twice; her reply was
    const msgs = await q<{ direction: string }>("select direction from sales_interactions where deal_id = $1 and body ilike '%clinic details%'", [dealId]);
    expect(msgs.length).toBe(1);
  });
});

describe("Summarize again fixes a stale next step", () => {
  it("re-reads everything: the step that already happened is replaced with a date, the kept promise closes", async () => {
    const { summarizeDeal } = await import("@/lib/sales/conversation");
    const dealId = await createDeal({ title: "Dr Mehta", source: "outbound" });
    await q("update sales_deals set next_action = 'Ask for the clinic details', next_action_at = now() where id = $1", [dealId]);
    const promise = await addCommitment({ deal_id: dealId, person_id: null, owner: "them", text: "share the clinic details", due_at: null });
    await q("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1,'linkedin','in','Here are the clinic details: Smile Dental Care, smiledentalcare.in', now(),'web')", [dealId]);
    const calls = ai(() => JSON.stringify({ summary: "She shared the clinic details.", quick_actions: [], reply_draft: null, next_step: "Prepare the demo and share it", next_step_due: "2026-11-18", done_promise_ids: [promise, 999] }));
    await summarizeDeal(dealId);
    expect(calls[0].prompt).toContain("CURRENT NEXT STEP: Ask for the clinic details");
    expect(calls[0].prompt).toContain(`id ${promise}, THEM: share the clinic details`);
    const d = await getDeal(dealId);
    expect(d!.next_action).toBe("Prepare the demo and share it");
    expect(new Date(d!.next_action_at!).toISOString().slice(0, 10)).toBe("2026-11-18");
    expect((await one<{ status: string }>("select status from sales_commitments where id = $1", [promise]))!.status).toBe("done");
  });
});

describe("drafts and the lead chat know the whole story", () => {
  it("deal context: stage goal, current next step, their latest message word for word, who is waiting", async () => {
    const dealId = await createDeal({ title: "Smile Dental: booking bot", source: "outbound" });
    await q("update sales_deals set next_action = 'Prepare the demo', next_action_at = now(), pain = 'Front desk misses calls' where id = $1", [dealId]);
    const long = `Sure, here are our details. ${"We have 3 dentists and see about 60 patients a day. ".repeat(10)}Website smiledentalcare.in`;
    await q("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1,'linkedin','out','Could you share the clinic details?', now() - interval '2 hours','web'), ($1,'linkedin','in',$2, now() - interval '1 hour','web')", [dealId, long]);
    const ctx = await dealContext(dealId);
    expect(ctx).toMatch(/STAGE GOAL: First contact|STAGE GOAL: /);
    expect(ctx).toContain("CURRENT NEXT STEP: Prepare the demo");
    expect(ctx).toContain("THEIR PAIN: Front desk misses calls");
    expect(ctx).toContain(`THEIR LATEST MESSAGE`);
    expect(ctx).toContain("Website smiledentalcare.in"); // the whole message, not cut at 350 characters
    expect(ctx).toContain("WHO IS WAITING: you are (they wrote last): answer them.");
    const brief = await dealBrief(dealId);
    expect(brief).toContain("Website smiledentalcare.in");
    expect(brief).toMatch(/What this stage needs: /);
  });

  it("cold first messages are complete; replies read the history first", () => {
    expect(STYLE_GUIDE).toMatch(/COLD FIRST MESSAGE[\s\S]*whatsapp 50 to 90 words; linkedin 70 to 120 words; email body 100 to 170 words/);
    expect(STYLE_GUIDE).toMatch(/Never ask for something they already gave/);
  });

  it("nothing unsupported: emails, links, phones and amounts must be in the context", () => {
    const ctx = "Smile Dental Care, smiledentalcare.in, 3 dentists, budget INR 60,000, +91 98200 11111, neha@smiledentalcare.in";
    expect(unsupported("Saw smiledentalcare.in. ₹60,000 works. Call +91 98200 11111 or neha@smiledentalcare.in", ctx)).toEqual([]);
    expect(unsupported("We cut no-shows by 40% for clinics like yours, see demo.io or write to x@y.com, about ₹2 lakh", ctx)).toEqual(["x@y.com", "demo.io", "40%", "₹2 lakh"]);
  });

  it("a draft with an invented detail is written again without it", async () => {
    const calls = ai(({ n }) => JSON.stringify(n === 1
      ? { subject: null, message: "Hi Neha, we cut no-shows by 40% for 20 clinics. Demo on Thursday?" }
      : { subject: null, message: "Hi Neha, thanks for the clinic details. I will share a demo built for Smile Dental Care by Wednesday. Does a 15 minute walkthrough on Thursday work?" }));
    return draftMessage({ channel: "linkedin", purpose: "Reply", context: "THEIR LATEST MESSAGE: Here are the details of Smile Dental Care", kind: "reply" }).then((d) => {
      expect(calls.length).toBe(2);
      expect(calls[1].prompt).toContain("NOT IN CONTEXT: 40%");
      expect(d.message).not.toContain("40%");
    });
  });
});
