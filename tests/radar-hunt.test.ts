// "Find them directly": a plan from every hint, a wide search, then a second round that checks each candidate and
// collects its published contacts. The button only queues it, so the page is never held up.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ systems: [] as string[], users: [] as string[] }));
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real,
    llmConfigured: () => true,
    llmJson: vi.fn(async (system: string, user: string) => {
      ai.systems.push(system);
      ai.users.push(user);
      if (/plan how to find the business/.test(system)) {
        return { hooks: ["Smile Arc", "Kothrud", "3 clinics"], place: "Pune, India", queries: ['"Smile Arc" dental Kothrud'] };
      }
      if (/second, checking round/.test(system)) {
        return { kind: "business", company: "Smile Arc Dental", website: "smilearc.in", person: "Dr Neha Joshi", title: "Founder", emails: ["hello@smilearc.in"], phones: ["+91 98220 11223"], confidence: "high",
          evidence: [{ url: "https://smilearc.in/contact", says: "Three clinics in Kothrud, Pune" }], note: "The clinics, place and need match.", candidates: [] };
      }
      return { kind: "business", company: "Smile Arc Dental", website: "smilearc.in", person: null, confidence: "medium", evidence: [], note: "Likely.",
        candidates: [{ company: "Smile Studio", website: null, location: "Mumbai", why: "same need", confidence: "low" }] };
    }),
  };
});
const web = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real,
    geminiSearchReady: () => false,
    webSearch: vi.fn(async (query: string) => {
      web.queries.push(query);
      return /Smile Arc/.test(query) ? [{ title: "Smile Arc Dental, Kothrud", url: "https://smilearc.in", snippet: "Smile Arc Dental: three clinics in Kothrud, Pune. Smile Studio" }] : [];
    }),
    fetchPage: vi.fn(async (url: string) => /smilearc\.in\/contact/.test(url)
      ? { url, status: 200, html: "<a href='mailto:hello@smilearc.in'>hello@smilearc.in</a> +91 98220 11223 Dr Neha Joshi, Founder", text: "Contact Smile Arc Dental. hello@smilearc.in +91 98220 11223. Dr Neha Joshi, Founder", title: "Contact" }
      : null),
  };
});

import { one, q } from "@/lib/db";
import { findBehindPost, findBehindStep, startFindBehind } from "@/lib/sales/behind-post";

beforeEach(async () => {
  await q("truncate sales_radar_items, sales_jobs, sales_research_runs, sales_companies, sales_people restart identity cascade");
  ai.systems = [];
  ai.users = [];
  web.queries = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

const post = async () => (await one<{ id: number }>(
  `insert into sales_radar_items (url, url_hash, title, body, status, score, poster, fit) values ($1, md5($1), 'Missed call bot for dental clinics',
    'Our three Smile Arc clinics in Kothrud miss around thirty calls every single day during peak hours and we lose patients.', 'qualified', 80, $2, $3) returning id`,
  [`https://www.freelancer.com/projects/hunt-${Math.random()}`, JSON.stringify({ name: "Neha J.", username: "smilearc", city: "Pune", country: "India" }), JSON.stringify({ country: "India", industry: "dental" })]))!.id;

describe("finding who is behind a post", () => {
  it("plans from every hint, searches with them, then checks the candidate and keeps its published contacts", async () => {
    const id = await post();
    const r = await findBehindPost(id, 60_000);
    expect(ai.systems[0]).toMatch(/plan how to find the business/);
    expect(web.queries).toContain('"Smile Arc" dental Kothrud'); // the plan's own search ran
    expect(web.queries.some((x) => x.startsWith('"Smile Arc Dental"') && x.includes("Pune, India"))).toBe(true); // round two checked it, with the place
    expect(r).toMatchObject({ status: "found", company: "Smile Arc Dental", person: "Dr Neha Joshi", confidence: "high" });
    expect(r.emails).toEqual(["hello@smilearc.in"]);
    expect(r.phones).toEqual(["+91 98220 11223"]);
  });

  it("the button queues it and returns at once; the rounds then run as background steps", async () => {
    const id = await post();
    const job = await startFindBehind(id);
    expect(job).toBeTruthy();
    const mid = (await one<{ identity: { status: string; stage: string } }>("select identity from sales_radar_items where id = $1", [id]))!.identity;
    expect(mid).toMatchObject({ status: "running", stage: "planning" });
    await findBehindStep(id, 1);
    const after1 = (await one<{ identity: { status: string; stage: string; note: string }; hunt_work: unknown }>("select identity, hunt_work from sales_radar_items where id = $1", [id]))!;
    expect(after1.identity).toMatchObject({ status: "running", stage: "checking" });
    expect(after1.identity.note).toMatch(/Checking 2 possible businesses/);
    expect(after1.hunt_work).toBeTruthy();
    expect(await one("select 1 from sales_jobs where kind = 'find_behind' and payload->>'round' = '2'")).toBeTruthy();
    await findBehindStep(id, 2);
    const done = (await one<{ identity: { status: string; company: string }; hunt_work: unknown }>("select identity, hunt_work from sales_radar_items where id = $1", [id]))!;
    expect(done.identity).toMatchObject({ status: "found", company: "Smile Arc Dental" });
    expect(done.hunt_work).toBeNull();
    // the company research follows
    expect(await one("select 1 from sales_research_runs where radar_item_id = $1", [id])).toBeTruthy();
  });
});
