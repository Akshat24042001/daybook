// Research is pinned to the lead: what the owner entered (city, phone, contact, email, industry) picks the right
// business and keeps namesakes out. The case that broke it: "Bliss" in Dubai was profiled as Bliss Club in Bangalore.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ systems: [] as string[], users: [] as string[], hqCountry: "United Arab Emirates" as string | null }));
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real,
    llmConfigured: () => true,
    llmJson: vi.fn(async (system: string, user: string) => {
      ai.systems.push(system);
      ai.users.push(user);
      if (/extract the real people/i.test(system)) return { people: [] };
      if (/B2B research analyst/.test(system)) {
        return {
          summary: { v: "A business.", src: "search", conf: "medium" },
          hq_country: ai.hqCountry ? { v: ai.hqCountry, src: "search", conf: "high" } : { v: null },
          revenue_usd: { v: 12_000_000, src: "estimate", conf: "low", est: true },
          founders: { v: "Mrigya Jain", src: "search", conf: "medium" },
        };
      }
      return {};
    }),
  };
});

const BANGALORE = `<html><title>Bliss Club | Activewear for women</title><body>${"Bliss Club makes activewear for women. ".repeat(15)}
  Registered office: Koramangala, Bengaluru, Karnataka 560034. Call +91 80 4567 8900. <a href="/about">About</a></body></html>`;
const DUBAI = `<html><title>Bliss Beauty Lounge</title><body>${"Bliss is a beauty lounge for hair, nails and skin. ".repeat(12)}
  <a href="/contact">Contact</a></body></html>`;
const DUBAI_CONTACT = `<html><body>${"Visit us. ".repeat(30)} Bliss Beauty Lounge, Jumeirah 1, Dubai. WhatsApp +971 50 123 4567. Ask for Sara Khan.</body></html>`;
const PAGES: Record<string, string> = {
  "https://blissclub.com": BANGALORE,
  "https://blissclub.com/about": `<html><body>${"Founded in Bengaluru in 2020. ".repeat(20)}</body></html>`,
  "https://blissbeauty.ae": DUBAI,
  "https://blissbeauty.ae/contact": DUBAI_CONTACT,
};
const searches: string[] = [];
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real,
    geminiSearchReady: () => false,
    webSearch: vi.fn(async (query: string) => {
      searches.push(query);
      // the namesake ranks first, as it did for real
      return [
        { title: "Bliss Club: activewear for women, Bengaluru", url: "https://blissclub.com", snippet: "Bliss Club Fitness Private Limited, Bengaluru, Karnataka. Raised Series A." },
        { title: "Bliss Beauty Lounge Jumeirah", url: "https://blissbeauty.ae", snippet: "Hair, nails and skin in Jumeirah, Dubai." },
        { title: "Bliss Club revenue FY24", url: "https://tofler.in/bliss-club", snippet: "Bliss Club Fitness Pvt Ltd, Bangalore, revenue Rs 92 crore." },
      ];
    }),
    fetchPage: vi.fn(async (url: string) => {
      const key = url.replace(/\/+$/, "");
      const html = PAGES[key];
      return html ? { url: key, status: 200, html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), title: html.match(/<title>(.*?)<\/title>/)?.[1] ?? "" } : null;
    }),
  };
});

import { one, q } from "@/lib/db";
import {
  acceptSite, applyAnchors, companyBrief, companyQueries, deepStage, gatherAnchors, resolveWebsite, searchStage, siteStage, startResearch, synthStage,
} from "@/lib/sales/research";
import {
  anchorLines, businessDomain, countryOfCity, dialCountry, knownCountry, matchLead, normCountry, placeOf, type Anchors,
} from "@/lib/sales/anchors";
import { ensureCompany } from "@/lib/sales/identity";

beforeEach(async () => {
  await q("truncate sales_research_runs, sales_radar_items, sales_jobs, sales_people, sales_companies, sales_deals restart identity cascade");
  ai.systems = [];
  ai.users = [];
  ai.hqCountry = "United Arab Emirates";
  searches.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))); // DNS, RDAP, Wikidata: nothing
});
afterEach(() => vi.unstubAllGlobals());

/** The lead as the owner added it: "Bliss", city Dubai, contact Sara Khan with a UAE mobile. */
async function blissLead(o: { website?: string; websiteSource?: string | null; companyCountry?: string } = {}) {
  const cid = (await one<{ id: number }>("insert into sales_companies (name, website, domain, website_source, country) values ('Bliss', $1, $2, $3, $4) returning id",
    [o.website ?? null, o.website ? o.website.replace(/^https?:\/\//, "") : null, o.websiteSource ?? null, o.companyCountry ?? null]))!.id;
  const pid = (await one<{ id: number }>("insert into sales_people (full_name, phones, emails, company_id) values ('Sara Khan', '{+971 50 123 4567}', '{sara.bliss@gmail.com}', $1) returning id", [cid]))!.id;
  const stage = (await one<{ id: number }>("select id from sales_stages where category = 'open' order by sort limit 1"))!.id;
  await q("insert into sales_deals (title, company_id, person_id, stage_id, city, industry) values ('Bliss: booking bot', $1, $2, $3, 'Dubai', 'Beauty salon')", [cid, pid, stage]);
  return cid;
}
const log = async (runId: number) => (await one<{ log: string[] }>("select log from sales_research_runs where id = $1", [runId]))!.log.join("\n");

describe("reading what the owner entered", () => {
  it("knows countries from phones, cities and words, and never takes a state for a country", () => {
    expect(dialCountry("+971 50 123 4567")).toBe("United Arab Emirates");
    expect(dialCountry("00971501234567")).toBe("United Arab Emirates");
    expect(dialCountry("+91 98765 43210")).toBe("India");
    expect(dialCountry("98765 43210")).toBeNull(); // no international code: unknown, not guessed
    expect(countryOfCity("Dubai")).toBe("United Arab Emirates");
    expect(countryOfCity("Bengaluru")).toBe("India");
    expect(normCountry("UAE")).toBe("United Arab Emirates");
    expect(knownCountry("Gujarat")).toBeNull();
    expect(businessDomain("sara@gmail.com")).toBeNull();
    expect(businessDomain("sara@blissbeauty.ae")).toBe("blissbeauty.ae");
  });

  it("gathers the lead: the deal's city beats a country an earlier run put on the company", async () => {
    const cid = await blissLead({ companyCountry: "India" });
    const a = (await gatherAnchors(cid))!;
    expect(a.city).toBe("Dubai");
    expect(a.country).toBe("United Arab Emirates");
    expect(a.countryFrom).toBe("from the city Dubai");
    expect(a.industry).toBe("Beauty salon");
    expect(a.phones).toEqual(["+971 50 123 4567"]);
    expect(a.emailDomains).toEqual([]); // gmail tells us nothing about their website
    expect(anchorLines(a)).toContain("Contact: Sara Khan, phone +971 50 123 4567");
  });
});

describe("telling the business from its namesakes", () => {
  const a = (): Anchors => ({
    companyId: 1, name: "Bliss", website: null, domain: null, websiteSource: null, emailDomains: [], city: "Dubai", region: null, country: "United Arab Emirates",
    countryFrom: "from the city Dubai", industry: "Beauty salon", services: null, people: [{ name: "Sara Khan", title: null, phones: ["+971 50 123 4567"], emails: [], linkedin: null }],
    phones: ["+971 50 123 4567"], socials: [], notes: null,
  });

  it("rejects the Bangalore namesake and accepts the Dubai lounge", () => {
    const bangalore = matchLead({ url: "https://blissclub.com", text: BANGALORE.replace(/<[^>]+>/g, " ") }, a());
    expect(bangalore.conflict).toBe(true);
    expect(bangalore.reasons.join(" ")).toMatch(/India.*not Dubai/);
    expect(acceptSite(bangalore, a())).toBe(false);
    const dubai = matchLead({ url: "https://blissbeauty.ae", text: DUBAI_CONTACT.replace(/<[^>]+>/g, " ") }, a());
    expect(dubai.conflict).toBe(false);
    expect(dubai.reasons.join(" ")).toMatch(/your contact's number/);
    expect(acceptSite(dubai, a())).toBe(true);
    // the name alone is not enough when we know where they are
    expect(acceptSite(matchLead({ url: "https://bliss.com", text: "Bliss. Welcome to our site." }, a()), a())).toBe(false);
  });

  it("puts the place, the phone and the contact into every search, and tells Google the whole lead", () => {
    const qs = companyQueries("Bliss", 2026, a());
    expect(qs.filter((x) => x.includes('"Bliss"')).every((x) => x.includes("Dubai"))).toBe(true);
    expect(qs).toContain('"+971 50 123 4567"');
    expect(qs.some((x) => x.includes('"Sara Khan"'))).toBe(true);
    const brief = companyBrief("Bliss", { year: 2026, lead: anchorLines(a()), place: placeOf(a()) });
    expect(brief).toContain("in Dubai, United Arab Emirates");
    expect(brief).toContain("+971 50 123 4567");
    expect(brief).toMatch(/MATCH:/);
    expect(brief).toMatch(/another city or country is a different business/);
  });

  it("a profile that drifted to another country is wiped, and the lead's place is kept", () => {
    const out = applyAnchors({ hq_country: { v: "India" }, revenue_usd: { v: 12_000_000 }, founders: { v: "Mrigya Jain" }, public_phones: { v: "+971 50 123 4567" } }, a());
    expect(out.identity_match.v).toBe("not found");
    expect(String(out.identity_basis.v)).toMatch(/India.*Dubai/);
    expect(out.revenue_usd.v).toBeNull();
    expect(out.founders.v).toBeNull();
    expect(out.public_phones.v).toBe("+971 50 123 4567"); // read off their own site: kept
    expect(out.hq_country.v).toBe("United Arab Emirates");
    expect(out.hq_city.v).toBe("Dubai");
  });
});

describe("the research run on the Bliss lead", () => {
  it("finds the Dubai website, says why the namesake was rejected, and filters namesake results", async () => {
    const cid = await blissLead();
    const runId = await startResearch({ subject: "company", id: cid, trigger: "manual" });
    await siteStage(runId);
    const l = await log(runId);
    expect(l).toMatch(/Starting research on Bliss in Dubai, United Arab Emirates/);
    expect(l).toMatch(/Matching everything to what you entered: .*Sara Khan.*\+971 50 123 4567/);
    expect(l).toMatch(/Not their website: blissclub\.com \(it is about India/);
    expect(l).toMatch(/Their website: https:\/\/blissbeauty\.ae/);
    const co = (await one<{ website: string; website_source: string; country: string }>("select website, website_source, country from sales_companies where id = $1", [cid]))!;
    expect(co).toMatchObject({ website: "https://blissbeauty.ae", website_source: "research", country: "United Arab Emirates" });

    await searchStage(runId);
    expect(searches.some((x) => x.includes('"+971 50 123 4567"'))).toBe(true);
    expect(await log(runId)).toMatch(/Left out \d+ results? about other businesses with the same name/);
    const ev = (await one<{ evidence: { search: string[] } }>("select evidence from sales_research_runs where id = $1", [runId]))!.evidence;
    expect(ev.search.join("\n")).not.toMatch(/Bengaluru|Bangalore/);

    await deepStage(runId);
    await synthStage(runId);
    const system = ai.systems.find((s) => /B2B research analyst/.test(s))!;
    expect(system).toContain("THE LEAD");
    expect(system).toContain("Location: Dubai, United Arab Emirates");
    expect(system).toMatch(/NAMESAKE: ignore it completely/);
    const done = (await one<{ enrichment: Record<string, { v: unknown }> }>("select enrichment from sales_companies where id = $1", [cid]))!.enrichment;
    expect(done.identity_match.v).toBe("confirmed");
    expect(String(done.identity_basis.v)).toMatch(/your contact's number/);
    expect(done.hq_city.v).toBe("Dubai");
  });

  it("replaces a namesake's website an earlier run saved, and wipes a profile that drifted", async () => {
    const cid = await blissLead({ website: "https://blissclub.com", companyCountry: "India" });
    const runId = await startResearch({ subject: "company", id: cid, trigger: "recheck" });
    await siteStage(runId);
    expect(await log(runId)).toMatch(/Removed the website an earlier run had picked \(blissclub\.com\)/);
    expect((await one<{ website: string }>("select website from sales_companies where id = $1", [cid]))!.website).toBe("https://blissbeauty.ae");
    await searchStage(runId);
    await deepStage(runId);
    ai.hqCountry = "India"; // the AI still slips to the namesake
    await synthStage(runId);
    const co = (await one<{ enrichment: Record<string, { v: unknown }>; country: string }>("select enrichment, country from sales_companies where id = $1", [cid]))!;
    expect(co.enrichment.identity_match.v).toBe("not found");
    expect(co.enrichment.founders.v).toBeNull();
    expect(co.enrichment.hq_country.v).toBe("United Arab Emirates");
    expect(co.country).toBe("United Arab Emirates");
  });

  it("never second-guesses a website you typed", async () => {
    const cid = await blissLead({ website: "https://blissclub.com", websiteSource: "you" });
    const a = (await gatherAnchors(cid))!;
    expect((await resolveWebsite(a)).url).toBe("https://blissclub.com");
  });
});

describe("a new lead never joins a namesake in another place", () => {
  it("Bliss in Dubai is a new company; Bliss in Bengaluru joins the Bengaluru one", async () => {
    const blr = (await one<{ id: number }>("insert into sales_companies (name, country, city) values ('Bliss', 'India', 'Bengaluru') returning id"))!.id;
    const dxb = await ensureCompany("Bliss", { city: "Dubai" });
    expect(dxb).not.toBe(blr);
    expect(await ensureCompany("Bliss", { city: "Bangalore" })).toBe(blr);
    expect(await ensureCompany("Bliss", { country: "UAE" })).toBe(dxb);
    expect(await ensureCompany("Bliss", { country: "Gujarat" })).toBe(blr); // a state is not a country: no split
  });
});
