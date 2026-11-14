// Every qualified lead is prepared on its own: brief, business behind it, company research, decision maker and
// contacts, a draft. Each step notes what happened and the chain always ends ready.
import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts: string[] = [];
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real, llmConfigured: () => true,
    llmJson: vi.fn(async (system: string, user: string) => {
      prompts.push(system.slice(0, 60));
      if (/brief .* on a lead/i.test(system)) return { need: "A clinic group wants WhatsApp booking for 3 branches.", deliverables: ["Booking bot"], help: ["Pilot one branch"], offers: ["AI agents"], questions: ["Which booking software?"], opener: "Saw you want WhatsApp booking." };
      if (/business behind a posted requirement/i.test(system)) {
        return /Kothrud/.test(user)
          ? { kind: "business", company: "Shah Dental Clinics", website: "shahdental.in", person: "Dr Ravi Shah", title: "Founder", emails: ["contact@shahdental.in"], phones: [], confidence: "high", evidence: [], note: "Same post on LinkedIn." }
          : { kind: "unclear", confidence: "low", note: "Nothing ties a business to this post." };
      }
      if (/write sales messages/i.test(system)) return { subject: "WhatsApp booking for your 3 branches", message: "Hi Ravi, saw you want WhatsApp booking for your three branches. We can pilot it in one branch in two weeks." };
      return {};
    }),
  };
});
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real, geminiSearchReady: () => false, fetchPage: vi.fn(async () => null),
    webSearch: vi.fn(async (query: string) => (query.includes("three dental clinics")
      ? [{ title: "Shah Dental Clinics Kothrud", url: "https://www.linkedin.com/posts/ravishah_x", snippet: "Dr Ravi Shah, founder of Shah Dental Clinics (shahdental.in). contact@shahdental.in" }]
      : [])),
  };
});

import { one, q } from "@/lib/db";
import { buildPack, radarPrepStep, scheduleRadarPrep, type Prep } from "@/lib/sales/radar-prep";

const BODY = "Our three dental clinics in Kothrud miss around thirty calls every single day during peak hours.";
const lead = (title: string, body: string, extra = "") =>
  one<{ id: number }>(`insert into sales_radar_items (url, url_hash, title, body, status, score, found_at, posted_at, fit) values ($1, md5($1), $2, $3, 'qualified', 75, now(), now(), '{"country":"India"}') ${extra} returning id`,
    [`https://www.freelancer.com/projects/${title.replace(/\W+/g, "-")}`, title, body]);
const prep = async (id: number) => (await one<{ prep: Prep }>("select prep from sales_radar_items where id = $1", [id]))!.prep;
const jobsFor = async (id: number) => (await q<{ payload: { step: string } }>("select payload from sales_jobs where kind = 'radar_prep' and payload->>'id' = $1 and status = 'queued' order by id", [String(id)])).map((j) => j.payload.step);

beforeEach(async () => {
  await q(`truncate sales_radar_items, sales_moves, sales_people, sales_companies, sales_identities, sales_deals, sales_jobs, sales_research_runs restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
  prompts.length = 0;
});

describe("picking what to prepare", () => {
  it("takes qualified recent leads, newest first, once each, within the daily cap; 101 turns it off", async () => {
    const a = (await lead("A clinic bot", BODY))!;
    await lead("Old one", BODY).then((x) => q("update sales_radar_items set found_at = now() - interval '6 days' where id = $1", [x!.id]));
    await lead("Rejected", BODY).then((x) => q("update sales_radar_items set status = 'rejected' where id = $1", [x!.id]));
    await lead("Hidden", BODY).then((x) => q("update sales_radar_items set hidden = true where id = $1", [x!.id]));
    expect(await scheduleRadarPrep()).toBe(1);
    expect(await jobsFor(a.id)).toEqual(["brief"]);
    expect(await scheduleRadarPrep()).toBe(0); // never twice
    await q("update sales_settings set config = '{\"radar\":{\"auto_prep_daily\":1}}'::jsonb");
    await lead("Another", BODY);
    expect(await scheduleRadarPrep()).toBe(0); // the day's one is used
    await q("update sales_settings set config = '{\"radar\":{\"auto_research_score\":101}}'::jsonb");
    expect(await scheduleRadarPrep()).toBe(0);
  });
});

describe("the chain", () => {
  it("brief, business behind it, decision maker and contacts, a draft: ready with nothing clicked", async () => {
    const it0 = (await lead("WhatsApp booking bot for clinics", BODY))!;
    await scheduleRadarPrep();
    await radarPrepStep(it0.id, "brief");
    expect((await prep(it0.id)).steps.brief?.ok).toBe(true);
    expect(await jobsFor(it0.id)).toContain("behind");

    await radarPrepStep(it0.id, "behind");
    const p1 = await prep(it0.id);
    expect(p1.steps.behind).toMatchObject({ ok: true });
    expect(p1.steps.behind!.note).toContain("Dr Ravi Shah");
    // the company research was started for the business found
    const co = (await one<{ company_id: number }>("select company_id from sales_radar_items where id = $1", [it0.id]))!.company_id;
    expect(co).toBeTruthy();

    // the research finishes: a profile, the founder marked as deciding, a public phone
    await q("update sales_research_runs set status = 'done' where radar_item_id = $1", [it0.id]);
    await q(`update sales_companies set enrichment = $2 where id = $1`, [co, JSON.stringify({
      summary: { v: "Three dental clinics in Pune." }, products_services: { v: "Dental care, implants" }, employee_range: { v: "20-50" }, hq_city: { v: "Pune" },
      public_phones: { v: "+91 20 2545 0000" }, pain_points: { v: "Missed calls at peak hours" }, best_entry_offer: { v: "WhatsApp booking pilot" },
    })]);
    await q("update sales_people set is_decision_maker = true, title = 'Founder' where company_id = $1 and full_name = 'Dr Ravi Shah'", [co]);

    await radarPrepStep(it0.id, "pack");
    const p2 = await prep(it0.id);
    expect(p2.pack?.decision_maker).toMatchObject({ name: "Dr Ravi Shah", title: "Founder" });
    expect(p2.pack?.company).toMatchObject({ name: "Shah Dental Clinics", size: "20-50", what_they_do: "Dental care, implants" });
    expect(p2.pack?.contacts.emails).toContain("contact@shahdental.in");
    expect(p2.pack?.contacts.phones).toContain("+91 20 2545 0000");
    expect(p2.pack?.insights.map((x) => x.label)).toEqual(expect.arrayContaining(["Their likely pain", "Best first offer"]));
    // the phone the research found joins the lead's contacts
    expect((await one<{ identity: { phones: string[] } }>("select identity from sales_radar_items where id = $1", [it0.id]))!.identity.phones).toContain("+91 20 2545 0000");

    await radarPrepStep(it0.id, "draft");
    const p3 = await prep(it0.id);
    expect(p3.stage).toBe("ready");
    expect(p3.ready_at).toBeTruthy();
    expect(p3.steps.draft?.ok).toBe(true);
    const mv = (await one<{ draft: string; channel: string }>("select draft, channel from sales_moves where dedupe_key = $1", [`radar:${it0.id}`]))!;
    expect(mv.draft).toContain("three branches");
    expect(mv.channel).toBe("email"); // written to their inbox, not as a bid
  });

  it("waits for a running research before gathering, but not forever", async () => {
    const it0 = (await lead("WhatsApp booking bot for clinics", BODY))!;
    await q("insert into sales_research_runs (subject, radar_item_id, status, stage) values ('company', $1, 'running', 'site')", [it0.id]);
    await radarPrepStep(it0.id, "pack");
    expect((await prep(it0.id)).waits).toBe(1);
    await q("update sales_radar_items set prep = jsonb_set(prep, '{waits}', '6') where id = $1", [it0.id]);
    await radarPrepStep(it0.id, "pack");
    expect((await prep(it0.id)).stage).toBe("draft");
  });

  it("no business behind it: says so, still ends ready with a reply draft", async () => {
    const it0 = (await lead("Fix my script", "Need a quick fix to a python script, nothing else to say here really."))!;
    await radarPrepStep(it0.id, "brief");
    await radarPrepStep(it0.id, "behind");
    expect((await prep(it0.id)).steps.behind).toMatchObject({ ok: false });
    await radarPrepStep(it0.id, "pack");
    expect((await prep(it0.id)).steps.pack).toMatchObject({ ok: false, note: "No company to profile" });
    await radarPrepStep(it0.id, "draft");
    expect((await prep(it0.id)).stage).toBe("ready");
  });

  it("stops once you have dealt with the lead yourself", async () => {
    const it0 = (await lead("WhatsApp booking bot for clinics", BODY))!;
    await q("update sales_radar_items set status = 'skipped' where id = $1", [it0.id]);
    await radarPrepStep(it0.id, "brief");
    expect(await one("select prep from sales_radar_items where id = $1 and prep is not null", [it0.id])).toBeNull();
    expect(await buildPack(999999)).toBeNull();
  });
});
