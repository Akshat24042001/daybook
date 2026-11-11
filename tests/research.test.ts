import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = { failSynth: false, calls: [] as string[] };
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real,
    llmConfigured: () => true,
    llmJson: vi.fn(async (system: string, user: unknown) => {
      ai.calls.push(system.slice(0, 40));
      if (/qualify sales leads/.test(system)) return [{ i: 1, score: 90, buyer: "direct_client", why: "fits", angle: "demo", company: "Acme Freight" }];
      if (/extract the real people/i.test(system)) {
        return { people: [
          { name: "Aisha Khan", title: "Founder and CEO", linkedin: "https://www.linkedin.com/in/aishakhan?trk=x", is_decision_maker: true, why: "owns the decision" },
          { name: "Omar Saeed", title: "Head of Operations", linkedin: "https://www.linkedin.com/in/omar-saeed-invented", is_decision_maker: true, why: "runs dispatch" },
          { name: "Bob", title: "Driver", is_decision_maker: false },
          { name: "Acme Freight", title: "n/a" },
          { name: "Sara Lee", title: "Customer (testimonial)", is_decision_maker: false },
        ] };
      }
      if (/B2B research analyst/.test(system)) {
        if (ai.failSynth) throw new Error("model overloaded");
        return {
          summary: { v: "A Dubai freight forwarder with about 85 staff.", src: "website", conf: "high" },
          revenue_usd: { v: 9_000_000, src: "estimate", conf: "low", est: true },
          employees: { v: 85, src: "website", conf: "medium" },
          public_emails: { v: "made-up@invented.com", src: "AI" }, // must be overwritten by what the site really says
          best_entry_offer: { v: "WhatsApp order intake agent", src: "analysis", conf: "medium" },
        };
      }
      // a person profile
      return { current_title: { v: "CEO", src: "search" }, opener: { v: "Saw your Dubai expansion.", src: "search" }, email_guess: { v: "invented@x.com", src: "AI" } };
    }),
  };
});

const PAGES: Record<string, string> = {
  "https://acmefreight.com": `<html><title>Acme Freight</title><body>${"Acme Freight moves cargo across the Gulf. ".repeat(20)}
    <a href="/about">About</a><a href="/contact">Contact</a><a href="/team">Team</a><a href="/careers">Careers</a>
    <a href="https://www.linkedin.com/company/acme-freight">in</a></body></html>`,
  "https://acmefreight.com/about": `<html><body>${"Founded in 2012 by Aisha Khan. ".repeat(15)}</body></html>`,
  "https://acmefreight.com/contact": `<html><body>${"Contact us. ".repeat(40)}<a href="mailto:info@acmefreight.com">info@acmefreight.com</a> aisha.khan@acmefreight.com <a href="tel:+97145550100">call</a></body></html>`,
  // the CEO's profile is on the team page, so research may keep it; nobody else's profile appears anywhere
  "https://acmefreight.com/team": `<html><body>${"Our leadership team. Aisha Khan, CEO (linkedin.com/in/aishakhan). Omar Saeed, Operations. ".repeat(10)}</body></html>`,
  "https://acmefreight.com/careers": `<html><body>${"We are hiring dispatchers. ".repeat(20)}</body></html>`,
};
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real,
    webSearch: vi.fn(async (query: string) =>
      /official website/.test(query)
        ? [{ title: "Acme Freight", url: "https://acmefreight.com", snippet: "Gulf freight" }]
        : [{ title: `Result for ${query.slice(0, 30)}`, url: `https://news.example/${encodeURIComponent(query.slice(0, 20))}`, snippet: "snippet" }]),
    fetchPage: vi.fn(async (url: string) => {
      const key = url.replace(/\/+$/, "");
      const html = PAGES[key];
      return html ? { url: key, status: 200, html, text: html.replace(/<[^>]+>/g, " "), title: "Acme" } : null;
    }),
  };
});

import { one, q } from "@/lib/db";
import { qualifyPending } from "@/lib/sales/radar";
import {
  companyQueries, deepStage, identifyLead, personStage, personSynthStage, pickLinks, researchRadarItem, researchView, searchStage, siteStage, startResearch, synthStage,
} from "@/lib/sales/research";

const rdap = { events: [{ eventAction: "registration", eventDate: "2014-03-02T00:00:00Z" }], entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "GoDaddy.com, LLC"]]] }], nameservers: [{ ldhName: "ns1.example.com" }] };
function stubNetwork() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes("rdap.org")) return json(rdap);
    if (u.includes("cloudflare-dns") && u.includes("type=MX")) return json({ Answer: [{ data: "10 aspmx.l.google.com." }] });
    if (u.includes("cloudflare-dns") && u.includes("type=TXT")) return json({ Answer: [{ data: '"v=spf1 include:_spf.google.com include:sendgrid.net ~all"' }] });
    if (u.includes("wikidata")) return json({ search: [] });
    return new Response("nope", { status: 404 });
  }));
}

beforeEach(async () => {
  await q("truncate sales_research_runs, sales_radar_items, sales_jobs, sales_people, sales_companies restart identity cascade");
  ai.failSynth = false;
  ai.calls = [];
  stubNetwork();
});
afterEach(() => vi.unstubAllGlobals());

const jobs = async () => (await q<{ kind: string }>("select kind from sales_jobs order by id")).map((j) => j.kind);

describe("picking the pages worth reading", () => {
  it("takes about, team, contact, careers first and ignores other sites and files", () => {
    const html = `<a href="/blog/post-1">b</a><a href="/about-us">a</a><a href="https://other.com/about">x</a><a href="/files/brochure.pdf">p</a><a href="/our-team">t</a><a href="/contact-us">c</a><a href="/careers">j</a><a href="/services">s</a>`;
    expect(pickLinks("https://acme.com", html)).toEqual([
      "https://acme.com/about-us", "https://acme.com/our-team", "https://acme.com/contact-us", "https://acme.com/careers", "https://acme.com/services", "https://acme.com/blog/post-1",
    ]);
    expect(companyQueries("Acme", 2026)).toHaveLength(15);
  });
});

describe("working out who a radar lead is about", () => {
  it("uses the company the scorer saw, ignores platforms, and uses a company's own page", () => {
    expect(identifyLead({ url: "https://reddit.com/r/x/1", fit: { company: "Acme Freight", website: "linkedin.com/company/acme", country: "UAE" } })).toMatchObject({ name: "Acme Freight", website: null, country: "UAE" });
    expect(identifyLead({ url: "https://reddit.com/r/x/1", fit: null })).toMatchObject({ name: null, website: null });
    expect(identifyLead({ url: "https://acmefreight.com/tender", fit: null })).toMatchObject({ website: "https://acmefreight.com" });
    expect(identifyLead({ url: null, fit: { company: "unknown", website: "acme.io" } })).toMatchObject({ name: null, website: "https://acme.io" });
  });
});

describe("the research pipeline", () => {
  async function company() {
    return (await one<{ id: number }>("insert into sales_companies (name, country) values ('Acme Freight', 'United Arab Emirates') returning id"))!.id;
  }

  it("reads the site, searches the web, writes the profile, finds the people and researches the decision makers", async () => {
    const cid = await company();
    const runId = await startResearch({ subject: "company", id: cid, trigger: "manual" });
    expect(await startResearch({ subject: "company", id: cid })).toBe(runId); // joins the run already in flight
    expect(await jobs()).toEqual(["research_company"]);

    await siteStage(runId);
    let run = (await one<{ status: string; stage: string; log: string[]; sources: { label: string; kind: string }[] }>("select * from sales_research_runs where id = $1", [runId]))!;
    expect(run.stage).toBe("search");
    expect(run.log.join("\n")).toMatch(/Found their website: https:\/\/acmefreight\.com/);
    expect(run.log.join("\n")).toMatch(/Read 5 pages/);
    expect(run.log.join("\n")).toMatch(/2 emails, 1 phone and 1 social profile/);
    expect(run.log.join("\n")).toMatch(/registered 2014-03-02.*email runs on Google Workspace/);
    expect(run.sources.some((s) => s.label === "Their website: /team")).toBe(true);
    expect((await one<{ website: string; domain: string }>("select website, domain from sales_companies where id = $1", [cid]))).toEqual({ website: "https://acmefreight.com", domain: "acmefreight.com" });

    await searchStage(runId);
    run = (await one("select * from sales_research_runs where id = $1", [runId]))!;
    expect(run.stage).toBe("deep");
    expect(run.log.join("\n")).toMatch(/Ran 15 web searches/);
    // no Gemini key in tests: the Google pass is skipped with a tip, and the profile is still written
    await deepStage(runId);
    run = (await one("select * from sales_research_runs where id = $1", [runId]))!;
    expect(run.stage).toBe("synth");
    expect(run.log.join("\n")).toMatch(/GEMINI_API_KEY/);

    await synthStage(runId);
    run = (await one("select * from sales_research_runs where id = $1", [runId]))!;
    expect(run.status).toBe("done");
    const co = (await one<{ enrichment: Record<string, { v: unknown; src?: string }>; employees: number; revenue_usd: number; enriched_at: string }>("select * from sales_companies where id = $1", [cid]))!;
    expect(co.enriched_at).toBeTruthy();
    expect(co.employees).toBe(85);
    expect(Number(co.revenue_usd)).toBe(9_000_000);
    // contact and domain facts come from the pages and DNS, not from the AI
    expect(co.enrichment.public_emails.v).toBe("info@acmefreight.com, aisha.khan@acmefreight.com");
    expect(co.enrichment.public_emails.src).toBe("their website");
    expect(co.enrichment.public_phones.v).toBe("+97145550100");
    expect(co.enrichment.email_provider.v).toBe("Google Workspace");
    expect(co.enrichment.sending_tools.v).toBe("Google, SendGrid");
    expect(co.enrichment.domain_age_years.v).toBeGreaterThan(11);
    expect(co.enrichment.registrar.v).toBe("GoDaddy.com, LLC");

    // the people: real names kept, the company name, a single word and nothing else invented
    const people = await q<{ full_name: string; title: string; is_decision_maker: boolean; linkedin: string | null }>("select full_name, title, is_decision_maker, linkedin from sales_people where company_id = $1 order by full_name", [cid]);
    expect(people.map((p) => p.full_name)).toEqual(["Aisha Khan", "Omar Saeed", "Sara Lee"]);
    expect(people[0]).toMatchObject({ is_decision_maker: true, linkedin: "https://www.linkedin.com/in/aishakhan" });
    // the AI "found" a profile for Omar that appears nowhere in what was read: it must not be saved
    expect(people.find((p) => p.full_name === "Omar Saeed")?.linkedin).toBeNull();
    const personRuns = await q<{ id: number; subject_id: number }>("select id, subject_id from sales_research_runs where subject = 'person' order by id");
    expect(personRuns).toHaveLength(2); // only the decision makers

    // a person: the email guess follows how their colleagues' addresses look (aisha.khan@ was on the site)
    const omar = (await one<{ id: number }>("select id from sales_people where full_name = 'Omar Saeed'"))!;
    const omarRun = personRuns.find((r) => r.subject_id === omar.id)!;
    await personStage(omarRun.id);
    await personSynthStage(omarRun.id);
    const p = (await one<{ enrichment: Record<string, { v: unknown; est?: boolean; conf?: string }> }>("select enrichment from sales_people where id = $1", [omar.id]))!;
    expect(p.enrichment.email_guess).toMatchObject({ v: "omar.saeed@acmefreight.com", est: true, conf: "medium" }); // not the AI's "invented@x.com"
    expect(String(p.enrichment.email_pattern_basis.v)).toMatch(/first\.last@acmefreight\.com/);
    expect(p.enrichment.opener.v).toBe("Saw your Dubai expansion.");
    expect((await one<{ status: string }>("select status from sales_research_runs where id = $1", [omarRun.id]))!.status).toBe("done");

    // read it all back at any time
    const view = await researchView({ companyId: cid });
    expect(view.company?.name).toBe("Acme Freight");
    expect(view.people.map((x) => x.full_name)).toContain("Aisha Khan");
    expect(view.people[0].is_decision_maker).toBe(true);
    expect(view.runs.length).toBeGreaterThan(0);
    expect(view.groups.company.map((g) => g.group)).toEqual(expect.arrayContaining(["Contact and location", "Reputation", "Domain and email"]));
  });

  it("marks the run as failed, with the reason, when a stage breaks", async () => {
    const cid = await company();
    const runId = await startResearch({ subject: "company", id: cid });
    await siteStage(runId);
    await searchStage(runId);
    await deepStage(runId);
    ai.failSynth = true;
    await expect(synthStage(runId)).rejects.toThrow("model overloaded");
    const run = (await one<{ status: string; error: string }>("select status, error from sales_research_runs where id = $1", [runId]))!;
    expect(run).toEqual({ status: "error", error: "model overloaded" });
    // a failed run does not block a new one
    expect(await startResearch({ subject: "company", id: cid })).not.toBe(runId);
  });
});

describe("researching a radar lead", () => {
  async function lead(fit: object | null, url = "https://reddit.com/r/smallbusiness/1") {
    return (await one<{ id: number }>("insert into sales_radar_items (url_hash, title, url, status, score, fit) values ($1, 'Need help with WhatsApp orders', $2, 'qualified', 88, $3) returning id", [String(Math.random()), url, fit ? JSON.stringify(fit) : null]))!.id;
  }

  it("links the lead to its company and contact and starts the research, without making a deal", async () => {
    const id = await lead({ company: "Acme Freight", website: "acmefreight.com", contact: "Aisha Khan", country: "United Arab Emirates", industry: "Logistics" });
    const runId = await researchRadarItem(id, {}, "manual");
    const item = (await one<{ company_id: number; person_id: number; deal_id: number | null }>("select company_id, person_id, deal_id from sales_radar_items where id = $1", [id]))!;
    expect(item.company_id).toBeTruthy();
    expect(item.person_id).toBeTruthy();
    expect(item.deal_id).toBeNull();
    expect((await one<{ website: string }>("select website from sales_companies where id = $1", [item.company_id]))!.website).toBe("https://acmefreight.com");
    expect((await one<{ radar_item_id: number }>("select radar_item_id from sales_research_runs where id = $1", [runId]))!.radar_item_id).toBe(id);
    expect(await q("select 1 from sales_research_runs where subject = 'person'")).toHaveLength(1);
    const view = await researchView({ radarItemId: id });
    expect(view.company?.name).toBe("Acme Freight");
    expect(view.running).toBe(true);
  });

  it("says plainly when the lead names no company, and lets you supply one", async () => {
    const id = await lead(null);
    const runId = await researchRadarItem(id);
    const run = (await one<{ status: string; error: string }>("select status, error from sales_research_runs where id = $1", [runId]))!;
    expect(run.status).toBe("error");
    expect(run.error).toMatch(/does not name a company/);
    expect((await researchView({ radarItemId: id })).running).toBe(false);
    await researchRadarItem(id, { company: "Acme Freight", website: "https://acmefreight.com" }, "manual");
    expect((await one<{ company_id: number | null }>("select company_id from sales_radar_items where id = $1", [id]))!.company_id).not.toBeNull();
  });

  it("researches a strong lead on its own as soon as it is scored", async () => {
    await q("insert into sales_radar_items (url_hash, title, body, url) values ('z1', 'Acme Freight needs a WhatsApp order bot', 'We are a freight company', 'https://reddit.com/r/x/9')");
    await qualifyPending(30_000);
    expect(await jobs()).toContain("radar_research");
  });
});
