import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI is replaced by a scripted answer so the filing is tested, not the model.
const aiAnswer: { value: unknown } = { value: null };
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmJson: vi.fn(async () => aiAnswer.value), llm: vi.fn(async () => ({ text: "x", model: "test" })), llmConfigured: () => true };
});

import { one, q } from "@/lib/db";
import { createDeal, updateDeal } from "@/lib/sales/deals";
import { capture, processCapture, undoCapture, type Extraction } from "@/lib/sales/ingest";
import { upsertPerson } from "@/lib/sales/identity";

beforeEach(async () => {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_jobs restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
});

const email: Extraction = {
  kind: "email", is_sales_related: true, channel: "email", direction: "in",
  people: [{ name: "Neha Kapoor", title: "Operations Head", email: "neha@brightsmile.in", phone: "+91 98200 11111", city: "Pune", seniority: "head", is_decision_maker: true }],
  company: { name: "BrightSmile Dental", website: "https://brightsmile.in", industry: "Dental clinics", city: "Pune", employees: 45 },
  messages: [{ from: "them", text: "Hi Akshat, our front desk misses about 30 calls a day. Can your bot handle bookings? We want it live before Diwali." }],
  summary: "Neha asks for a booking bot; misses 30 calls a day.",
  requirements: "WhatsApp booking bot for 3 branches", budget: "around 2 lakh",
  commitments: [{ owner: "me", text: "send a proposal", due: "2026-11-14" }],
  stage_signal: "replied", value: { amount: 200000, currency: "INR" }, next_step: "Send the proposal by Friday",
  details: {
    deal_title: "BrightSmile: WhatsApp booking bot", deal_type: "new", pain: "Front desk misses about 30 calls a day",
    desired_outcome: "Every call answered and booked", compelling_event: "Live before Diwali", competitors: ["Practo"],
    current_solution: "Receptionist only", expected_close: "2026-11-30",
  },
};

describe("a screenshot of a mail or chat is filed everywhere it belongs", () => {
  it("creates the lead with a proper name and fills deal, person and company details", async () => {
    aiAnswer.value = email;
    const id = await capture({ source: "web", text: "", images: ["data:image/png;base64,AAAA"] }, { now: true });
    const r = await processCapture(id);
    expect(r.created_deal).toBeTruthy();
    const d = (await one<Record<string, unknown>>("select * from sales_deals where id = $1", [r.deal_id]))!;
    expect(d.title).toBe("BrightSmile: WhatsApp booking bot");
    expect(d.pain).toBe("Front desk misses about 30 calls a day");
    expect(d.compelling_event).toBe("Live before Diwali");
    expect(d.competitors).toEqual(["Practo"]);
    expect(String(d.expected_close).slice(0, 10)).toBe("2026-11-30");
    expect(Number(d.value_amount)).toBe(200000);
    const p = (await one<Record<string, unknown>>("select * from sales_people where id = $1", [r.person_id]))!;
    expect(p.title).toBe("Operations Head");
    expect(p.city).toBe("Pune");
    expect(p.is_decision_maker).toBe(true);
    expect(p.preferred_channel).toBe("email");
    expect(p.emails).toContain("neha@brightsmile.in");
    const c = (await one<Record<string, unknown>>("select c.* from sales_companies c join sales_people p on p.company_id = c.id where p.id = $1", [r.person_id]))!;
    expect(c.website).toBe("https://brightsmile.in");
    expect(c.employees).toBe(45);
    expect(r.filled).toEqual(expect.arrayContaining(["Pain", "Why now", "Competitors", "Person: Decision maker", "Company: Employees"]));
    expect(r.commitment_texts?.[0]).toMatch(/You: send a proposal/);
    expect(r.deal_title).toBe("BrightSmile: WhatsApp booking bot");
  });

  it("never overwrites what you wrote yourself", async () => {
    const pid = await upsertPerson({ name: "Neha Kapoor", email: "neha@brightsmile.in", title: "CEO" });
    const dealId = await createDeal({ person_id: pid, title: "My own name" });
    await updateDeal(dealId, { pain: "My words" });
    aiAnswer.value = email;
    const r = await processCapture(await capture({ source: "web", text: "x", hints: { deal_id: dealId } }, { now: true }));
    const d = (await one<Record<string, unknown>>("select title, pain, compelling_event from sales_deals where id = $1", [dealId]))!;
    expect(d.title).toBe("My own name");
    expect(d.pain).toBe("My words");
    expect(d.compelling_event).toBe("Live before Diwali");
    expect((await one<{ title: string }>("select title from sales_people where id = $1", [pid]))!.title).toBe("CEO");
    expect(r.filled).not.toContain("Pain");
  });

  it("the same screenshot twice is not logged twice, and its promise is not added again", async () => {
    const chat: Extraction = { ...email, messages: [
      { from: "them", text: "Can your bot handle bookings?" },
      { from: "me", text: "Yes, I will send a proposal by Friday" },
    ] };
    aiAnswer.value = chat;
    const r1 = await processCapture(await capture({ source: "web", text: "", images: ["data:image/png;base64,AAAA"] }, { now: true }));
    expect(r1.message_count).toBe(2);
    const before = (await one<{ n: number }>("select count(*)::int as n from sales_interactions where deal_id = $1", [r1.deal_id]))!.n;
    const r2 = await processCapture(await capture({ source: "web", text: "", images: ["data:image/png;base64,AAAA"] }, { now: true }));
    expect(r2.deal_id).toBe(r1.deal_id);
    expect(r2.already).toBe(2);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_interactions where deal_id = $1", [r1.deal_id]))!.n).toBe(before);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_commitments where deal_id = $1", [r1.deal_id]))!.n).toBe(1);
    // an overlapping screenshot with one new message logs only that one
    aiAnswer.value = { ...chat, messages: [...chat.messages!, { from: "them", text: "Great, also need Instagram replies" }] };
    const r3 = await processCapture(await capture({ source: "web", text: "", images: ["data:image/png;base64,BBBB"] }, { now: true }));
    expect(r3.already).toBe(2);
    expect(r3.message_count ?? 1).toBe(1);
  });

  it("undo of a screenshot lets the same screenshot be logged again", async () => {
    aiAnswer.value = { ...email, messages: [{ from: "them", text: "a" }, { from: "me", text: "b" }] };
    const c1 = await capture({ source: "web", text: "", images: ["data:image/png;base64,AAAA"] }, { now: true });
    const r1 = await processCapture(c1);
    await undoCapture(c1);
    // the lead it created is gone too; filing again starts fresh
    expect(await one("select 1 from sales_deals where id = $1", [r1.deal_id])).toBeNull();
    const r2 = await processCapture(await capture({ source: "web", text: "", images: ["data:image/png;base64,AAAA"] }, { now: true }));
    expect(r2.already ?? 0).toBe(0);
    expect(r2.message_count).toBe(2);
  });

  it("when it cannot tell who it is, you name the person and it is filed", async () => {
    aiAnswer.value = { ...email, people: [] };
    const id = await capture({ source: "web", text: "budget 2 lakh, need it before Diwali" }, { now: true });
    const r = await processCapture(id);
    expect(r.deal_id).toBeFalsy();
    const r2 = await processCapture(id, { newPersonName: "Neha Kapoor" });
    expect(r2.deal_id).toBeTruthy();
    expect((await one<{ full_name: string }>("select full_name from sales_people where id = $1", [r2.person_id]))!.full_name).toBe("Neha Kapoor");
  });
});
