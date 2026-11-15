// Sharing a radar lead: everything known in one go, four ways (full, WhatsApp, for Claude, data), to Telegram in parts,
// and to Claude through the connector. Facts keep their sources; no long dashes; contacts once.
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushed: string[] = [];
vi.mock("@/lib/sales/notify", () => ({ push: vi.fn(async (t: string) => { pushed.push(t); }) }));

import { one, q } from "@/lib/db";
import { allContacts, claudeText, dossierText, leadDossier, leadShare, sendLeadToTelegram, whatsappText } from "@/lib/sales/lead-share";
import { TOOLS } from "@/lib/mcp/tools";

const DASH = /[‒–—―]/;

async function makeLead(): Promise<number> {
  const co = (await one<{ id: number }>(
    `insert into sales_companies (name, website, enrichment) values ('Shah Dental Clinics', 'https://shahdental.in', $1) returning id`,
    [JSON.stringify({ employees: { v: 40, src: "https://linkedin.com/company/shahdental" }, revenue_usd: { v: "1.2M", est: true }, hq_city: { v: "Pune", src: "https://shahdental.in/contact" } })]))!;
  await q(`insert into sales_people (full_name, title, company_id, emails, phones, linkedin, is_decision_maker) values ('Dr Ravi Shah', 'Founder', $1, '{ravi@shahdental.in}', '{+91 98200 11111}', 'https://linkedin.com/in/ravishah', true)`, [co.id]);
  const it = (await one<{ id: number }>(
    `insert into sales_radar_items (url, url_hash, title, body, status, score, posted_at, company_id, poster, identity, brief, fit, prep) values
      ('https://www.freelancer.com/projects/booking-bot', 'share1', 'WhatsApp booking bot for 3 dental clinics', 'Our three clinics in Kothrud miss thirty calls a day — we need booking on WhatsApp.', 'qualified', 82, now(), $1,
      '{"name":"Ravi S.","username":"ravis","city":"Pune","country":"India","history":"4 projects completed"}',
      $2, $3, '{"country":"India","industry":"Healthcare","why":"Clear need, three branches","budget":"INR 60,000"}', $4) returning id`,
    [co.id,
      JSON.stringify({ status: "found", company: "Shah Dental Clinics", website: "https://shahdental.in", person: "Dr Ravi Shah", title: "Founder", emails: ["Ravi@shahdental.in"], phones: [], confidence: "high", evidence: [{ url: "https://shahdental.in", says: "Three clinics in Pune" }], note: "Same post on LinkedIn", checked_at: "x", candidates: [{ company: "Smile Care Pune", website: null, location: "Baner", person: null, why: "Also three clinics", confidence: "low", evidence_url: "https://x.example" }] }),
      JSON.stringify({ need: "Book appointments on WhatsApp for three clinics.", deliverables: ["WhatsApp booking"], help: ["Pilot one clinic"], offers: ["AI agents"], questions: ["Which booking software?"], opener: "Saw your three clinics miss calls.", size: "medium", budget: null, timing: "this month", watch_out: null }),
      JSON.stringify({ stage: "ready", started_at: "x", steps: { brief: { ok: true, note: "Requirement understood", at: "x" } }, pack: { company: { name: "Shah Dental Clinics", website: "https://shahdental.in", summary: "Dental chain", what_they_do: "Dental care", size: "40 people", location: "Pune, India", revenue: null, budget: null, founded: null }, decision_maker: { name: "Dr Ravi Shah", title: "Founder", email: "ravi@shahdental.in", phone: "+91 98200 11111", linkedin: null, why: "Posted it" }, others: [], contacts: { emails: ["contact@shahdental.in"], phones: [], whatsapp: null, contact_page: null, linkedin: null }, insights: [{ label: "Their likely pain", text: "Missed calls at peak hours" }] } })]))!;
  await q("insert into sales_moves (radar_item_id, kind, title, dedupe_key, draft, draft_subject, channel) values ($1, 'radar', 'x', $2, 'Hi Ravi, saw your clinics miss calls.', 'WhatsApp booking', 'email')", [it.id, `radar:${it.id}`]);
  return it.id;
}

describe("sharing a lead", () => {
  beforeEach(async () => {
    pushed.length = 0;
    await q("truncate sales_radar_items, sales_moves, sales_people, sales_companies restart identity cascade");
  });

  it("the full version has every section, the sources and the estimates, and no long dashes", async () => {
    const id = await makeLead();
    const t = dossierText(await leadDossier(id));
    for (const s of ["# WhatsApp booking bot for 3 dental clinics", "Fit score: 82/100", "## Reach them", "## Who posted it", "Ravi S.", "## The business behind it",
      "Other businesses it could be:", "Smile Care Pune", "## Decision maker", "## Company research: Shah Dental Clinics", "Employees: 40 [source: https://linkedin.com/company/shahdental]",
      "Revenue (USD / yr): 1.2M (estimate)", "## People found", "Dr Ravi Shah, Founder (decision maker)", "## What they need", "## How we can help", "1. Pilot one clinic",
      "## Ask them", "## Drafted message", "Hi Ravi, saw your clinics miss calls.", "## Their post, word for word", "From Daybook radar, lead #"]) expect(t).toContain(s);
    expect(DASH.test(t)).toBe(false);
  });

  it("every contact once, from everywhere it was found", async () => {
    const c = allContacts(await leadDossier(await makeLead()));
    expect(c.emails).toEqual(["ravi@shahdental.in", "contact@shahdental.in"]);
    expect(c.phones).toEqual(["+91 98200 11111"]);
    expect(c.linkedin).toEqual(["https://linkedin.com/in/ravishah"]);
  });

  it("WhatsApp: the essentials in its formatting, short enough to send", async () => {
    const d = await leadDossier(await makeLead());
    const w = whatsappText({ ...d, post: "x".repeat(9000) });
    expect(w).toMatch(/^\*WhatsApp booking bot/);
    expect(w).toMatch(/\*Who:\* Dr Ravi Shah \(Founder\), Shah Dental Clinics/);
    expect(w).toMatch(/\*Reach:\* ravi@shahdental.in · contact@shahdental.in · \+91 98200 11111/);
    expect(w.length).toBeLessThanOrEqual(3500);
  });

  it("for Claude: what to do, never invent, then everything", async () => {
    const d = await leadDossier(await makeLead());
    const c = claudeText(d, { name: "Akshat Shah", title: "CEO", company: "Aivaura", website: "aivaura.com", offers: ["AI agents"] });
    expect(c).toMatch(/^I am Akshat Shah, CEO of Aivaura/);
    expect(c).toContain("Never invent names, emails, phone numbers or facts");
    expect(c).toContain("Write a short first message for email");
    expect(c).toContain("## Company research");
    const all = await leadShare(d.id);
    expect(JSON.parse(all.json).identity.company).toBe("Shah Dental Clinics");
    expect(all.filename).toBe(`lead-${d.id}-whatsapp-booking-bot-for-3-dental-clinics.md`);
  });

  it("to Telegram in parts, and to Claude through the connector", async () => {
    const id = await makeLead();
    expect(await sendLeadToTelegram(id)).toBeGreaterThanOrEqual(1);
    expect(pushed.join("\n")).toContain("Shah Dental Clinics");
    const tool = TOOLS.find((x) => x.name === "sales_radar_lead")!;
    const r = await tool.run({ id }) as { text: string; data: { id: number } };
    expect(r.text).toContain("## Decision maker");
    expect(r.data.id).toBe(id);
    const list = await TOOLS.find((x) => x.name === "sales_radar_leads")!.run({}) as { id: number; company: string }[];
    expect(list[0]).toMatchObject({ id, company: "Shah Dental Clinics" });
  });
});
