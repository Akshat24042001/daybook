import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI is replaced by a scripted answer so the pipeline is tested, not the model.
const aiAnswer: { value: unknown } = { value: null };
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real,
    llmJson: vi.fn(async () => aiAnswer.value),
    llm: vi.fn(async () => ({ text: "brief", model: "test" })),
    llmConfigured: () => true,
  };
});

import { one, q } from "@/lib/db";
import { addPayment, createDeal, getDeal, logInteraction, markPaid, addCommitment } from "@/lib/sales/deals";
import { acceptQuote, createQuote, docBySlug, getDoc, markDocSent, newRevision, recordView, saveRevision } from "@/lib/sales/docs";
import { emailDomain, normLinkedin, normPhone, resolvePerson, upsertPerson, waDigits } from "@/lib/sales/identity";
import { capture, parseWhatsAppExport, processCapture, undoCapture } from "@/lib/sales/ingest";
import { mdToHtml } from "@/lib/sales/md";
import { listMoves, refreshMoves } from "@/lib/sales/moves";
import { emailToRadar, storeItems } from "@/lib/sales/radar";
import { applyEvent, moveDeal, stageByRole } from "@/lib/sales/stages";
import { ingestGmail, stripQuoted } from "@/lib/sales/google";
import { channelUrl, sign, verify } from "@/lib/sales/links";

async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls restart identity cascade`);
  await q("delete from sales_radar_sources");
  await q("update sales_settings set config = '{}'::jsonb");
}

const role = async (dealId: number) => (await one<{ role: string }>("select s.role from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [dealId]))!.role;

beforeEach(async () => {
  await resetSales();
  aiAnswer.value = null;
});

describe("WhatsApp export parsing", () => {
  it("reads the iPhone format with seconds and AM/PM", () => {
    const raw = "[06/11/26, 10:15:32 PM] Rahul Mehta: Hi Akshat\n[06/11/26, 10:16:01 PM] Akshat: Hey Rahul, tell me\nmore on the next line\n[07/11/26, 9:02:11 AM] Rahul Mehta: Budget is 5k";
    const lines = parseWhatsAppExport(raw, "Asia/Kolkata")!;
    expect(lines).toHaveLength(3);
    expect(lines[0].sender).toBe("Rahul Mehta");
    expect(lines[1].text).toBe("Hey Rahul, tell me\nmore on the next line");
    expect(lines[0].at.toISOString()).toBe("2026-11-06T16:45:00.000Z");
  });
  it("reads the Android 24h format", () => {
    const raw = "06/11/2026, 22:15 - Priya: Can we talk tomorrow?\n06/11/2026, 22:20 - You: Sure, 11am works";
    const lines = parseWhatsAppExport(raw, "Asia/Kolkata")!;
    expect(lines.map((l) => l.sender)).toEqual(["Priya", "You"]);
  });
  it("says no to text that is not a chat export", () => {
    expect(parseWhatsAppExport("met Rahul today, he wants an app", "Asia/Kolkata")).toBeNull();
  });
});

describe("identity", () => {
  it("normalises handles", () => {
    expect(normPhone("+91 98765-43210")).toBe("9876543210");
    expect(waDigits("098765 43210")).toBe("919876543210");
    expect(normLinkedin("https://www.linkedin.com/in/Rahul-Mehta/?x=1")).toBe("in/rahul-mehta");
    expect(emailDomain("a@gmail.com")).toBeNull();
    expect(emailDomain("rahul@acme.io")).toBe("acme.io");
  });
  it("finds the same person by phone, email or exact name", async () => {
    const id = await upsertPerson({ name: "Rahul Mehta", phone: "+91 98765 43210", email: "rahul@acme.io", company: "Acme" });
    expect((await resolvePerson({ phone: "9876543210" })).person?.id).toBe(id);
    expect((await resolvePerson({ email: "RAHUL@acme.io" })).person?.id).toBe(id);
    expect((await resolvePerson({ name: "Rahul Mehta" })).person?.id).toBe(id);
    // the same handle never creates a second person
    expect(await upsertPerson({ name: "R. Mehta", phone: "09876543210" })).toBe(id);
  });
  it("asks instead of guessing when names collide", async () => {
    await upsertPerson({ name: "Rahul Shah", company: "Zeta" });
    await upsertPerson({ name: "Rahul Sharma", company: "Beta" });
    const r = await resolvePerson({ name: "Rahul" });
    expect(r.person).toBeNull();
  });
});

describe("state machine", () => {
  it("moves forward on events and only along allowed edges", async () => {
    const id = await createDeal({ title: "Acme app" });
    expect(await role(id)).toBe("new");
    await logInteraction({ deal_id: id, channel: "whatsapp", direction: "out", source: "test" });
    expect(await role(id)).toBe("contacted");
    await logInteraction({ deal_id: id, channel: "whatsapp", direction: "in", source: "test" });
    expect(await role(id)).toBe("engaged");
    await logInteraction({ deal_id: id, channel: "meeting", direction: "both", source: "test" });
    expect(await role(id)).toBe("discovery");
    // an outbound message never pulls a deal backwards
    await logInteraction({ deal_id: id, channel: "email", direction: "out", source: "test" });
    expect(await role(id)).toBe("discovery");
  });

  it("enforces requirements on manual moves", async () => {
    const id = await createDeal({ title: "Guarded", stage_role: "engaged" });
    const lost = (await stageByRole("lost"))!;
    const nurture = (await stageByRole("nurture"))!;
    const proposal = (await stageByRole("proposal"))!;
    const paid = (await stageByRole("paid"))!;
    await expect(moveDeal(id, lost.id, {})).rejects.toThrow(/reason/);
    await expect(moveDeal(id, nurture.id, {})).rejects.toThrow(/revisit date/);
    await expect(moveDeal(id, proposal.id, {})).rejects.toThrow(/sent quote/);
    await expect(moveDeal(id, paid.id, {})).rejects.toThrow(/cannot go/);
    await moveDeal(id, proposal.id, { note: "PDF on email" });
    expect(await role(id)).toBe("proposal");
    await moveDeal(id, lost.id, { reason: "Price too high" });
    const d = await getDeal(id);
    expect(d?.lost_reason).toBe("Price too high");
    expect(d?.closed_at).not.toBeNull();
    // they come back: a reply reopens it
    await logInteraction({ deal_id: id, channel: "whatsapp", direction: "in", source: "test" });
    expect(await role(id)).toBe("engaged");
    expect((await getDeal(id))?.closed_at).toBeNull();
  });

  it("lets money drive the end of the deal", async () => {
    const id = await createDeal({ title: "Paid", stage_role: "proposal" });
    await applyEvent(id, "quote_accepted");
    expect(await role(id)).toBe("won");
    const a = await addPayment({ deal_id: id, label: "Advance", amount: 500, currency: "USD" });
    const b = await addPayment({ deal_id: id, label: "Final", amount: 500, currency: "USD" });
    await markPaid(a, "2026-11-06");
    expect(await role(id)).toBe("active");
    await markPaid(b, "2026-11-20");
    expect(await role(id)).toBe("paid");
  });
});

describe("moves", () => {
  it("asks you to reply, then retires the move once you have", async () => {
    const id = await createDeal({ title: "Reply test", stage_role: "engaged" });
    await logInteraction({ deal_id: id, channel: "whatsapp", direction: "in", source: "test", occurred_at: new Date(Date.now() - 5 * 3_600_000) });
    await refreshMoves();
    let moves = await listMoves({ horizonHours: 48 });
    expect(moves.map((m) => m.kind)).toContain("reply");
    await logInteraction({ deal_id: id, channel: "whatsapp", direction: "out", source: "test" });
    await refreshMoves();
    moves = await listMoves({ horizonHours: 48 });
    expect(moves.map((m) => m.kind)).not.toContain("reply");
  });

  it("runs the follow-up sequence after a first touch with no reply", async () => {
    const id = await createDeal({ title: "Cold one" });
    await logInteraction({ deal_id: id, channel: "linkedin", direction: "out", source: "test", occurred_at: new Date(Date.now() - 4 * 86_400_000) });
    await refreshMoves();
    const m = (await listMoves({ horizonHours: 48 })).find((x) => x.deal_id === id);
    expect(m?.kind).toBe("follow_up");
    expect(m?.title).toMatch(/Follow-up 1/);
  });

  it("marks a deal Ghosted when the whole sequence gets no reply", async () => {
    const id = await createDeal({ title: "Silent" });
    for (const daysAgo of [30, 26, 22, 15]) {
      await logInteraction({ deal_id: id, channel: "email", direction: "out", source: "test", occurred_at: new Date(Date.now() - daysAgo * 86_400_000) });
    }
    await refreshMoves();
    expect(await role(id)).toBe("ghosted");
    expect((await getDeal(id))?.revisit_on).not.toBeNull();
  });

  it("turns promises into moves", async () => {
    const id = await createDeal({ title: "Promise", stage_role: "engaged" });
    await addCommitment({ deal_id: id, owner: "me", text: "Send the proposal", due_at: new Date(Date.now() + 3_600_000).toISOString() });
    await addCommitment({ deal_id: id, owner: "them", text: "share sample data", due_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await refreshMoves();
    const kinds = (await listMoves({ horizonHours: 48 })).map((m) => m.kind);
    expect(kinds).toContain("commit_mine");
    expect(kinds).toContain("commit_theirs");
  });
});

describe("tracked quotes", () => {
  it("sends, revises, counts real opens and accepts", async () => {
    const id = await createDeal({ title: "Quote deal", stage_role: "discovery", value_amount: 4000, currency: "USD" });
    const docId = await createQuote(id);
    await saveRevision(docId, { items: [{ name: "Build", qty: 1, unit_price: 4000 }], payment_plan: [{ label: "Advance", percent: 50, when: "on acceptance" }, { label: "Final", percent: 50, when: "on delivery" }] });
    await markDocSent(docId);
    expect(await role(id)).toBe("proposal");
    await expect(saveRevision(docId, { discount: 100 })).rejects.toThrow(/new revision/);
    await newRevision(docId, "10% off");
    await saveRevision(docId, { discount: 400 });
    await markDocSent(docId);
    expect(await role(id)).toBe("negotiation");
    const doc = (await getDoc(docId))!;
    expect(await recordView(doc, { ua: "WhatsApp/2.23", visitor: "x" })).toBeNull();
    expect(await recordView(doc, { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", visitor: "y", country: "AE" })).not.toBeNull();
    expect((await getDoc(docId))?.view_count).toBe(1);
    await acceptQuote(doc.slug, "Rahul Mehta");
    expect(await role(id)).toBe("won");
    const pays = await q<{ amount: number }>("select amount from sales_payments where deal_id = $1 order by id", [id]);
    expect(pays.map((p) => Number(p.amount))).toEqual([1800, 1800]);
    expect((await docBySlug(doc.slug))?.status).toBe("accepted");
  });
});

describe("capture pipeline", () => {
  it("files a WhatsApp export to a new lead, with promises, and only adds what is new next time", async () => {
    aiAnswer.value = {
      kind: "conversation", is_sales_related: true,
      people: [{ name: "Rahul Mehta", company: "Acme Jewels", phone: "+971501234567" }],
      company: { name: "Acme Jewels", country: "United Arab Emirates" },
      channel: "whatsapp", summary: "Rahul wants an inventory app.", deal_summary: "Wants an inventory app, budget 5k.",
      commitments: [{ owner: "them", text: "share stock sheet", due: "2026-11-10" }, { owner: "me", text: "send a rough plan", due: null }],
      requirements: "Inventory app", budget: "$5k", stage_signal: "replied", next_step: "Send the plan",
    };
    const chat = "[06/11/26, 10:15:32 PM] Rahul Mehta: Hi, need an inventory app\n[06/11/26, 10:16:01 PM] Akshat: Sure, tell me more\n[06/11/26, 10:20:01 PM] Rahul Mehta: Will share the stock sheet Monday";
    const c1 = await capture({ source: "telegram", text: chat, hints: { file_name: "WhatsApp Chat - Rahul Mehta.txt" } }, { now: true });
    const r1 = await processCapture(c1);
    expect(r1.created_deal).toBeTruthy();
    expect(r1.message_count).toBe(3);
    const deal = (await getDeal(r1.deal_id!))!;
    expect(deal.person_name).toBe("Rahul Mehta");
    expect(deal.summary).toMatch(/inventory/);
    expect(await role(deal.id)).toBe("engaged");
    const commits = await q("select owner from sales_commitments where deal_id = $1", [deal.id]);
    expect(commits).toHaveLength(2);
    // the same export again: nothing new
    const c2 = await capture({ source: "telegram", text: chat, hints: { file_name: "WhatsApp Chat - Rahul Mehta.txt" } }, { now: true });
    expect((await processCapture(c2)).skipped).toMatch(/Nothing new/);
    // undo takes it all back
    await undoCapture(c1);
    expect(await getDeal(deal.id)).toBeNull();
  });

  it("files a debrief to the deal it was asked about and suggests closing moves instead of making them", async () => {
    const id = await createDeal({ title: "Debrief deal", stage_role: "discovery" });
    aiAnswer.value = {
      kind: "meeting_notes", is_sales_related: true, people: [], summary: "They will come back in March.", stage_signal: "not_now", revisit_on: "2027-03-01",
    };
    const c = await capture({ source: "telegram", text: "call done, not now, maybe March", hints: { deal_id: id } }, { now: true });
    const r = await processCapture(c);
    expect(r.deal_id).toBe(id);
    expect(r.suggestion?.role).toBe("nurture");
    expect(await role(id)).toBe("discovery");
  });
});

describe("email and radar", () => {
  it("routes alert emails to the radar and known people to their deal", async () => {
    await q(`insert into sales_radar_sources (key, name, kind, category, config) values ('email_upwork','Upwork','email','requirement','{"domains":["upwork.com"]}')`);
    expect(await emailToRadar("donotreply@upwork.com", "New job: AI agent for clinic", "Looking for...", "m1")).toBe(true);
    expect(await one("select 1 from sales_radar_items where title like 'New job%'")).toBeTruthy();
    const pid = await upsertPerson({ name: "Meera", email: "meera@brand.com" });
    await createDeal({ person_id: pid, title: "Brand" });
    const r = await ingestGmail([{ id: "g1", from: "Meera <meera@brand.com>", to: "akshat.shah@aivaura.com", subject: "Re: plan", body: "Looks good\n\nOn Mon, Akshat wrote:\n> old" }]);
    expect(r.logged).toBe(1);
    const cap = await one<{ hints: { person_id: number } }>("select hints from sales_captures where hints->>'gmail_id' = 'g1'");
    expect(cap?.hints.person_id).toBe(pid);
    // the same message is never logged twice
    expect((await ingestGmail([{ id: "g1", from: "meera@brand.com", subject: "x", body: "y" }])).skipped).toBe(1);
    expect(stripQuoted("Looks good\n\nOn Mon, 6 Nov, Akshat wrote:\n> old")).toBe("Looks good");
  });

  it("stores each radar item once", async () => {
    const items = [{ title: "Need app", url: "https://x.com/a?utm=1", body: "b" }, { title: "Need app", url: "https://x.com/a", body: "b" }];
    expect(await storeItems(null, items)).toBe(1);
  });
});

describe("links and markdown", () => {
  it("signs go-links and builds channel links", () => {
    expect(verify("12.whatsapp", sign("12.whatsapp"))).toBe(true);
    expect(verify("13.whatsapp", sign("12.whatsapp"))).toBe(false);
    expect(channelUrl("whatsapp", { phone: "98765 43210" }, "hi there")).toBe("https://wa.me/919876543210?text=hi%20there");
  });
  it("escapes HTML in client-facing markdown", () => {
    const html = mdToHtml("## Scope\n- **Build** the app\n<script>alert(1)</script>");
    expect(html).toContain("<h3>Scope</h3>");
    expect(html).toContain("<strong>Build</strong>");
    expect(html).not.toContain("<script>");
  });
});

describe("priority", () => {
  const base = {
    id: 1, category: "open", role: "engaged", probability: 20, value_usd: 10_000, company: "Acme", last_in: null, company_last_in: null, company_other_in: null,
    first_recent: null, before_recent: null, in_14: 0, in_prev_14: 0, views_48h: 0, meeting_soon: null, overdue_moves: 0, promises_due: 0, priority: 0, priority_on: null,
  };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  it("is hot when they just replied and are reading the quote, and cools with silence", async () => {
    const { scoreDeal } = await import("@/lib/sales/priority");
    const hot = scoreDeal({ ...base, last_in: hoursAgo(2), company_last_in: hoursAgo(2), in_14: 3, views_48h: 3, role: "proposal", probability: 50 });
    expect(hot.score).toBeGreaterThanOrEqual(70);
    expect(hot.why.join(" ")).toMatch(/Quote opened 3x/);
    const cold = scoreDeal({ ...base, last_in: hoursAgo(24 * 30), company_last_in: hoursAgo(24 * 30) });
    expect(cold.score).toBeLessThan(hot.score - 30);
  });

  it("brings a parked deal back to the top when they return after months", async () => {
    const { scoreDeal } = await import("@/lib/sales/priority");
    const parked = scoreDeal({ ...base, category: "parked", role: "nurture", last_in: hoursAgo(24 * 200), company_last_in: hoursAgo(24 * 200) });
    expect(parked.score).toBeLessThanOrEqual(15);
    const back = scoreDeal({ ...base, category: "parked", role: "nurture", last_in: hoursAgo(5), company_last_in: hoursAgo(5), first_recent: hoursAgo(30), before_recent: hoursAgo(24 * 200), in_14: 2 });
    expect(back.score).toBeGreaterThanOrEqual(60);
    expect(back.why.join(" ")).toMatch(/Back after 7 months of silence/);
  });

  it("counts someone else at the same company writing", async () => {
    const { scoreDeal } = await import("@/lib/sales/priority");
    const r = scoreDeal({ ...base, last_in: hoursAgo(24 * 90), company_last_in: hoursAgo(3), company_other_in: hoursAgo(3), in_14: 1 });
    expect(r.why[0]).toMatch(/Someone else at Acme wrote/);
    expect(r.score).toBeGreaterThan(40);
  });

  it("stores priority with yesterday's value for the trend", async () => {
    const id = await createDeal({ title: "Trend", stage_role: "engaged", value_amount: 5000, currency: "USD" });
    await q("update sales_deals set priority = 10, priority_on = current_date - 1 where id = $1", [id]);
    await logInteraction({ deal_id: id, channel: "whatsapp", direction: "in", source: "test" });
    await refreshMoves(id);
    const d = await one<{ priority: number; priority_prev: number; heat: number; priority_why: string[] }>("select priority, priority_prev, heat, priority_why from sales_deals where id = $1", [id]);
    expect(d!.priority_prev).toBe(10);
    expect(d!.priority).toBeGreaterThan(40);
    expect(d!.heat).toBe(d!.priority);
    expect(d!.priority_why[0]).toMatch(/They engaged/);
  });
});
